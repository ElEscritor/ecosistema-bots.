'use strict';

const { MongoClient } = require('mongodb');

const MONGO_URI = process.env.MONGO_URI;
const DB_NAME = process.env.MONGO_DB_NAME || 'panoptico_db';
const COLLECTION_NAME = 'blacklist';
const MAX_HISTORIAL_SLICE = -50;
const MAX_PAGINATION_LIMIT = 200;

if (!MONGO_URI) {
    console.error('[ERROR CRÍTICO] Variable de entorno MONGO_URI no definida. Abortando inicio.');
    process.exit(1);
}

// Configuración de Pool de Conexiones de nivel producción
const client = new MongoClient(MONGO_URI, {
    maxPoolSize: 20,
    minPoolSize: 2,
    connectTimeoutMS: 10000,
    socketTimeoutMS: 45000,
    retryWrites: true,
    retryReads: true
});

let dbCollection = null;
let connectionPromise = null;

/**
 * Sincroniza un índice de forma segura. Si ya existe en MongoDB con opciones
 * heredadas distintas (IndexOptionsConflict / código 85 o 86), conserva el existente
 * o lo recrea si es seguro, sin tumbar jamás el despliegue en producción.
 */
async function asegurarIndiceSeguro(collection, keySpec, options = {}) {
    try {
        await collection.createIndex(keySpec, options);
    } catch (error) {
        // Códigos 85 (IndexOptionsConflict) y 86 (IndexKeySpecsConflict) en MongoDB
        if (error.code === 85 || error.code === 86 || error.message.includes('existing index')) {
            console.warn(`[AVISO BD] Índice existente detectado para ${JSON.stringify(keySpec)}. Conservando índice actual del clúster.`);
        } else {
            console.warn(`[AVISO BD] No se pudo optimizar el índice ${JSON.stringify(keySpec)}: ${error.message}`);
        }
    }
}

/**
 * Inicializa la conexión a MongoDB garantizando una única instancia (Singleton)
 * y deteniendo el proceso únicamente si el clúster es inalcanzable en red.
 */
async function conectarBaseDatos() {
    if (dbCollection) return dbCollection;
    if (connectionPromise) return connectionPromise;

    connectionPromise = (async () => {
        try {
            await client.connect();
            const db = client.db(DB_NAME);
            dbCollection = db.collection(COLLECTION_NAME);
        } catch (error) {
            connectionPromise = null;
            console.error('[ERROR CRÍTICO BD] Fallo de red al conectar con el clúster MongoDB:', error.message);
            process.exit(1);
        }

        // Sincronización tolerante de índices (compatible con bases de datos ya pobladas)
        await Promise.all([
            asegurarIndiceSeguro(dbCollection, { userId: 1 }, { background: true }),
            asegurarIndiceSeguro(dbCollection, { ultimoAlias: 'text' }, { background: true }),
            asegurarIndiceSeguro(dbCollection, { totalInfracciones: -1 }, { background: true }),
            asegurarIndiceSeguro(dbCollection, { primerFichaje: -1 }, { background: true })
        ]);

        console.log('[SISTEMA] Clúster MongoDB enlazado e índices verificados correctamente.');
        return dbCollection;
    })();

    return connectionPromise;
}

/**
 * Valida que la colección esté activa antes de operar.
 */
function verificarConexion() {
    if (!dbCollection) {
        throw new Error('La conexión a la base de datos no ha sido inicializada.');
    }
}

/**
 * Registra o actualiza el expediente de un infractor de forma atómica.
 * Mantiene el formato de retorno esperado por los módulos.
 */
async function ficharInfractor(
    userId,
    userTag,
    accion,
    casoId,
    mensajeCrudo = 'Evidencia no disponible',
    servidorOrigen = 'Sector Desconocido'
) {
    if (!dbCollection) return 'BD Inactiva';
    if (!userId || typeof userId !== 'string') return 'ID de usuario inválido.';

    const timestampActual = new Date().toISOString();
    const nuevoDelito = {
        fecha: timestampActual,
        accion: String(accion || 'Infracción no especificada').slice(0, 256),
        casoId: String(casoId || 'N/A').slice(0, 64),
        mensajeOriginal: String(mensajeCrudo).slice(0, 4000),
        servidor: String(servidorOrigen).slice(0, 256)
    };

    try {
        const resultado = await dbCollection.findOneAndUpdate(
            { userId: userId.trim() },
            {
                $setOnInsert: { primerFichaje: timestampActual, notasAnalista: '', perfiladoAutomatico: [] },$set: {
                    ultimoAlias: String(userTag || 'Desconocido').trim()
                },
                $inc: { totalInfracciones: 1 },$push: {
                    historial: {
                        $each: [nuevoDelito],$slice: MAX_HISTORIAL_SLICE
                    }
                }
            },
            { upsert: true, returnDocument: 'after' }
        );

        // Compatibilidad con driver MongoDB v5 y v6+
        const exp = resultado?.value !== undefined ? resultado.value : resultado;

        if (exp && exp.totalInfracciones === 1) {
            return '**Nuevo Ingreso:** Primer delito registrado.';
        }
        return `**Reincidente:** Expediente actualizado (Infracción #${exp?.totalInfracciones ?? 1}).`;
    } catch (error) {
        console.error(`[ERROR BD] Fallo al fichar infractor (${userId}):`, error.message);
        return 'Error de escritura en clúster MongoDB.';
    }
}

/**
 * Obtiene hasta 500 expedientes ordenados por nivel de reincidencia.
 */
async function obtenerExpedientes(filtro = {}) {
    if (!dbCollection) return [];
    try {
        const queryFiltro = (filtro && typeof filtro === 'object') ? filtro : {};
        return await dbCollection
            .find(queryFiltro)
            .sort({ totalInfracciones: -1 })
            .limit(500)
            .toArray();
    } catch (error) {
        console.error('[ERROR BD] Fallo en obtenerExpedientes:', error.message);
        return [];
    }
}

/**
 * Obtiene expedientes paginados ejecutando la búsqueda y el conteo en paralelo.
 */
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

/**
 * Devuelve un cursor de lectura para streaming de datos (ej. exportaciones).
 */
function obtenerExpedientesCursor(filtro = {}) {
    if (!dbCollection) return null;
    const queryFiltro = (filtro && typeof filtro === 'object') ? filtro : {};
    return dbCollection.find(queryFiltro).sort({ primerFichaje: -1 });
}

/**
 * Elimina un expediente por su userId.
 */
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

/**
 * Actualiza las notas manuales del analista OSINT.
 */
async function actualizarNotaOSINT(userId, nota) {
    if (!dbCollection || !userId) return false;
    try {
        const notaSaneada = typeof nota === 'string' ? nota.slice(0, 10000) : '';
        await dbCollection.updateOne(
            { userId: String(userId).trim() },
            { $set: { notasAnalista: notaSaneada } }
        );
        return true;
    } catch (error) {
        console.error(`[ERROR BD] Fallo al actualizar nota OSINT (${userId}):`, error.message);
        return false;
    }
}

/**
 * Inyecta un objetivo de forma manual sin sobrescribir sus datos si ya existía.
 */
async function inyectarObjetivoManual(userId) {
    if (!dbCollection || !userId) return false;
    const idLimpio = String(userId).trim();
    if (!/^\d{17,20}$/.test(idLimpio)) return false;

    try {
        await dbCollection.updateOne(
            { userId: idLimpio },
            {
                $setOnInsert: {
                    ultimoAlias: 'Identidad Desconocida',
                    primerFichaje: new Date().toISOString(),
                    notasAnalista: '[ INYECCIÓN MANUAL ] Pendiente de perfilado.',
                    perfiladoAutomatico: [],
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

/**
 * Importación masiva saneando entradas corruptas antes de ejecutar bulkWrite.
 */
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

/**
 * Cierra limpiamente la conexión al clúster de MongoDB.
 */
async function cerrarBaseDatos() {
    try {
        await client.close();
        dbCollection = null;
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
    cerrarBaseDatos
};
