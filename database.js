'use strict';

const { MongoClient } = require('mongodb');

const MONGO_URI = process.env.MONGO_URI;
const DB_NAME = process.env.MONGO_DB_NAME || 'panoptico_db';
const COLLECTION_NAME = 'blacklist';
const TOPOLOGY_COLLECTION_NAME = 'topologia_red';
const MAX_HISTORIAL_SLICE = -50;
const MAX_PAGINATION_LIMIT = 200;

if (!MONGO_URI) {
    console.error('[ERROR CRÍTICO] Variable de entorno MONGO_URI no definida. Abortando inicio.');
    process.exit(1);
}

const client = new MongoClient(MONGO_URI, {
    maxPoolSize: 20,
    minPoolSize: 2,
    connectTimeoutMS: 10000,
    socketTimeoutMS: 45000,
    retryWrites: true,
    retryReads: true
});

let dbCollection = null;
let topologyCollection = null;
let connectionPromise = null;

async function asegurarIndiceSeguro(collection, keySpec, options = {}) {
    try {
        await collection.createIndex(keySpec, options);
    } catch (error) {
        const msg = String(error.message || '');
        if (
            error.code === 85 ||
            error.code === 86 ||
            error.code === 67 ||
            msg.includes('existing index') ||
            msg.includes('only one text index')
        ) {
            return;
        }
        console.warn(`[AVISO BD] No se pudo optimizar el índice ${JSON.stringify(keySpec)}: ${msg}`);
    }
}

async function conectarBaseDatos() {
    if (dbCollection && topologyCollection) return dbCollection;
    if (connectionPromise) return connectionPromise;

    connectionPromise = (async () => {
        try {
            await client.connect();
            const db = client.db(DB_NAME);
            dbCollection = db.collection(COLLECTION_NAME);
            topologyCollection = db.collection(TOPOLOGY_COLLECTION_NAME);
        } catch (error) {
            connectionPromise = null;
            console.error('[ERROR CRÍTICO BD] Fallo de red al conectar con el clúster MongoDB:', error.message);
            process.exit(1);
        }

        await Promise.all([
            asegurarIndiceSeguro(dbCollection, { userId: 1 }, { background: true }),
            asegurarIndiceSeguro(dbCollection, { ultimoAlias: 'text' }, { background: true }),
            asegurarIndiceSeguro(dbCollection, { totalInfracciones: -1 }, { background: true }),
            asegurarIndiceSeguro(dbCollection, { primerFichaje: -1 }, { background: true }),
            asegurarIndiceSeguro(dbCollection, { actualizadoEn: -1 }, { background: true })
        ]);

        console.log('[SISTEMA] Clúster MongoDB enlazado (Blacklist + Memoria Estelar + Enjambre Dinámico).');
        return dbCollection;
    })();

    return connectionPromise;
}

function verificarConexion() {
    if (!dbCollection) {
        throw new Error('La conexión a la base de datos no ha sido inicializada.');
    }
}

async function ficharInfractor(
    userId,
    userTag,
    accion,
    casoId,
    mensajeCrudo = 'Evidencia no disponible',
    servidorOrigen = 'Sector Desconocido',
    esSoloOsint = false
) {
    if (!dbCollection) return 'BD Inactiva';
    if (!userId || typeof userId !== 'string') return 'ID de usuario inválido.';

    const timestampActual = new Date().toISOString();
    const aliasLimpio = String(userTag || 'Desconocido').trim();
    const nuevoDelito = {
        fecha: timestampActual,
        accion: String(accion || 'Infracción no especificada').slice(0, 256),
        casoId: String(casoId || 'N/A').slice(0, 64),
        mensajeOriginal: String(mensajeCrudo).slice(0, 4000),
        servidor: String(servidorOrigen).slice(0, 256)
    };

    const incrementoInfraccion = esSoloOsint ? 0 : 1;

    try {
        const resultado = await dbCollection.findOneAndUpdate(
            { userId: userId.trim() },
            {
                $setOnInsert: {
                    primerFichaje: timestampActual,
                    notasAnalista: '',
                    perfiladoAutomatico: []
                },
                $set: {
                    ultimoAlias: aliasLimpio,
                    actualizadoEn: timestampActual
                },
                $addToSet: {
                    historialAliases: aliasLimpio
                },
                $inc: { totalInfracciones: incrementoInfraccion },
                $push: {
                    historial: {
                        $each: [nuevoDelito],
                        $slice: MAX_HISTORIAL_SLICE
                    }
                }
            },
            { upsert: true, returnDocument: 'after' }
        );

        const exp = resultado?.value !== undefined ? resultado.value : resultado;
        if (exp && exp.totalInfracciones <= 1 && !esSoloOsint) {
            return '**Nuevo Ingreso:** Primer delito registrado.';
        }
        return `**Expediente Actualizado:** Registro acumulado (#${exp?.totalInfracciones ?? 1}).`;
    } catch (error) {
        console.error(`[ERROR BD] Fallo al fichar infractor (${userId}):`, error.message);
        return 'Error de escritura en clúster MongoDB.';
    }
}

async function obtenerExpedientes(filtro = {}) {
    if (!dbCollection) return [];
    try {
        const queryFiltro = (filtro && typeof filtro === 'object') ? filtro : {};
        return await dbCollection
            .find(queryFiltro)
            .sort({ actualizadoEn: -1, totalInfracciones: -1, primerFichaje: -1 })
            .limit(800)
            .toArray();
    } catch (error) {
        console.error('[ERROR BD] Fallo en obtenerExpedientes:', error.message);
        return [];
    }
}

async function obtenerExpedientesPaginados(filtro = {}, pagina = 1, limite = 50) {
    if (!dbCollection) return { datos: [], total: 0 };
    try {
        const queryFiltro = (filtro && typeof filtro === 'object') ? filtro : {};
        const paginaSegura = Math.max(1, parseInt(pagina, 10) || 1);
        const limiteSeguro = Math.min(MAX_PAGINATION_LIMIT, Math.max(1, parseInt(limite, 10) || 50));
        const skip = (paginaSegura - 1) * limiteSeguro;

        const [datos, total] = await Promise.all([
            dbCollection
                .find(queryFiltro)
                .sort({ totalInfracciones: -1 })
                .skip(skip)
                .limit(limiteSeguro)
                .toArray(),
            dbCollection.countDocuments(queryFiltro)
        ]);

        return { datos, total };
    } catch (error) {
        console.error('[ERROR BD] Fallo en obtenerExpedientesPaginados:', error.message);
        return { datos: [], total: 0 };
    }
}

function obtenerExpedientesCursor(filtro = {}) {
    if (!dbCollection) return null;
    const queryFiltro = (filtro && typeof filtro === 'object') ? filtro : {};
    return dbCollection.find(queryFiltro).sort({ primerFichaje: -1 });
}

async function eliminarExpediente(userId) {
    if (!dbCollection || !userId) return false;
    try {
        const resultado = await dbCollection.deleteOne({ userId: String(userId).trim() });
        return resultado.deletedCount > 0;
    } catch (error) {
        console.error(`[ERROR BD] Fallo al eliminar expediente (${userId}):`, error.message);
        return false;
    }
}

async function actualizarNotaOSINT(userId, nota) {
    if (!dbCollection || !userId) return false;
    try {
        const notaSaneada = typeof nota === 'string' ? nota.slice(0, 10000) : '';
        await dbCollection.updateOne(
            { userId: String(userId).trim() },
            { $set: { notasAnalista: notaSaneada, actualizadoEn: new Date().toISOString() } }
        );
        return true;
    } catch (error) {
        console.error(`[ERROR BD] Fallo al actualizar nota OSINT (${userId}):`, error.message);
        return false;
    }
}

async function inyectarObjetivoManual(userId) {
    if (!dbCollection || !userId) return false;
    const idLimpio = String(userId).trim();
    if (!/^\d{17,20}$/.test(idLimpio)) return false;

    const ahora = new Date().toISOString();
    try {
        await dbCollection.updateOne(
            { userId: idLimpio },
            {
                $set: { actualizadoEn: ahora },
                $setOnInsert: {
                    ultimoAlias: 'Identidad Desconocida',
                    primerFichaje: ahora,
                    notasAnalista: '[ INYECCIÓN MANUAL ] Pendiente de perfilado.',
                    perfiladoAutomatico: [],
                    historialAliases: [],
                    totalInfracciones: 0,
                    historial: []
                }
            },
            { upsert: true }
        );
        return true;
    } catch (error) {
        console.error(`[ERROR BD] Fallo en inyectarObjetivoManual (${userId}):`, error.message);
        return false;
    }
}

async function importarMatriz(usuariosArray) {
    if (!dbCollection || !Array.isArray(usuariosArray) || usuariosArray.length === 0) {
        return false;
    }

    try {
        const timestampActual = new Date().toISOString();
        const operaciones = [];

        for (const user of usuariosArray) {
            if (!user || typeof user !== 'object') continue;
            const rawId = user.userId || user.id;
            if (!rawId) continue;
            const cleanId = String(rawId).trim();
            if (!cleanId) continue;

            operaciones.push({
                updateOne: {
                    filter: { userId: cleanId },
                    update: {
                        $set: { actualizadoEn: timestampActual },
                        $setOnInsert: {
                            ultimoAlias: String(user.ultimoAlias || user.username || 'Identidad Desconocida').trim(),
                            primerFichaje: user.primerFichaje || user.fecha || timestampActual,
                            notasAnalista: String(user.notasAnalista || user.notas || '[ IMPORTACIÓN ]'),
                            perfiladoAutomatico: Array.isArray(user.perfiladoAutomatico) ? user.perfiladoAutomatico : [],
                            totalInfracciones: Number.isInteger(user.totalInfracciones)
                                ? user.totalInfracciones
                                : (Number.isInteger(user.reincidencia) ? user.reincidencia : 0),
                            historial: Array.isArray(user.historial) ? user.historial.slice(MAX_HISTORIAL_SLICE) : []
                        }
                    },
                    upsert: true
                }
            });
        }

        if (operaciones.length === 0) return false;
        await dbCollection.bulkWrite(operaciones, { ordered: false });
        return true;
    } catch (error) {
        console.error('[ERROR BD] Fallo en importarMatriz:', error.message);
        return false;
    }
}

async function guardarSnapshotRed(snapshotData) {
    if (!topologyCollection || !snapshotData) return false;
    try {
        const updateDoc = {
            actualizadoEn: new Date().toISOString(),
            servidores: Array.isArray(snapshotData.servidores) ? snapshotData.servidores.slice(0, 800) : [],
            usuarios: Array.isArray(snapshotData.usuarios) ? snapshotData.usuarios.slice(0, 2500) : [],
            interacciones: Array.isArray(snapshotData.interacciones) ? snapshotData.interacciones.slice(0, 3000) : [],
            bitacoraDvr: Array.isArray(snapshotData.bitacoraDvr) ? snapshotData.bitacoraDvr.slice(-250) : []
        };
        if (Array.isArray(snapshotData.invitaciones)) {
            updateDoc.invitaciones = snapshotData.invitaciones.slice(0, 1500);
        }
        if (snapshotData.etiquetasServidores && typeof snapshotData.etiquetasServidores === 'object') {
            updateDoc.etiquetasServidores = snapshotData.etiquetasServidores;
        }
        if (Array.isArray(snapshotData.watchlist)) {
            updateDoc.watchlist = snapshotData.watchlist.slice(0, 200);
        }

        await topologyCollection.updateOne(
            { _id: 'RADAR_STATE_GLOBAL' },
            { $set: updateDoc },
            { upsert: true }
        );
        return true;
    } catch (error) {
        console.error('[ERROR BD] Fallo al guardar snapshot de red:', error.message);
        return false;
    }
}

async function cargarSnapshotRed() {
    if (!topologyCollection) return null;
    try {
        return await topologyCollection.findOne({ _id: 'RADAR_STATE_GLOBAL' });
    } catch (error) {
        console.error('[ERROR BD] Fallo al cargar snapshot de red:', error.message);
        return null;
    }
}

/**
 * Guarda un token explorador añadido desde la interfaz web para que persista en MongoDB.
 */
async function guardarTokenDinamico(tokenStr, etiquetaSector = 'General') {
    if (!topologyCollection || !tokenStr) return false;
    const cleanToken = String(tokenStr).replace(/^(Bot|Bearer)\s+/i, '').trim();
    if (cleanToken.length < 40) return false;

    try {
        await topologyCollection.updateOne(
            { _id: 'SWARM_DYNAMIC_TOKENS' },
            {
                $addToSet: {
                    tokens: {
                        token: cleanToken,
                        sector: String(etiquetaSector || 'General').slice(0, 30),
                        agregadoEn: new Date().toISOString()
                    }
                }
            },
            { upsert: true }
        );
        return true;
    } catch (error) {
        console.error('[ERROR BD] Fallo al guardar token dinámico:', error.message);
        return false;
    }
}

async function cargarTokensDinamicos() {
    if (!topologyCollection) return [];
    try {
        const doc = await topologyCollection.findOne({ _id: 'SWARM_DYNAMIC_TOKENS' });
        return Array.isArray(doc?.tokens) ? doc.tokens : [];
    } catch (_) {
        return [];
    }
}

async function cerrarBaseDatos() {
    try {
        await client.close();
        dbCollection = null;
        topologyCollection = null;
        connectionPromise = null;
        console.log('[SISTEMA] Conexión a MongoDB cerrada correctamente.');
    } catch (error) {
        console.error('[ERROR BD] Error cerrando conexión a MongoDB:', error.message);
    }
}

module.exports = {
    conectarBaseDatos,
    verificarConexion,
    ficharInfractor,
    obtenerExpedientes,
    obtenerExpedientesPaginados,
    obtenerExpedientesCursor,
    eliminarExpediente,
    actualizarNotaOSINT,
    inyectarObjetivoManual,
    importarMatriz,
    guardarSnapshotRed,
    cargarSnapshotRed,
    guardarTokenDinamico,
    cargarTokensDinamicos,
    cerrarBaseDatos
};
