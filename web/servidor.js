'use strict';

const express = require('express');
const path = require('path');
const crypto = require('crypto');
const database = require('../database.js');

const app = express();
const PUERTO = Number(process.env.PORT) || 3000;

const USUARIO_MAESTRO = process.env.PANEL_USER || 'Admin';
const PASSWORD_MAESTRA = process.env.PANEL_PASSWORD || '1930';

const sesionesActivas = new Map();
const intentosFallidosIP = new Map();
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_INTENTOS_LOGIN = 8;
const BLOQUEO_LOGIN_MS = 5 * 60 * 1000;

let estadoEnjambre = [];
let estadoRadarRed = {
    servidores: [],
    usuarios: [],
    interacciones: [],
    pulsos: []
};

app.disable('x-powered-by');
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
});

app.use(express.json({ limit: '25mb' }));

app.use((req, res, next) => {
    const rutaMinuscula = req.path.toLowerCase();
    if (rutaMinuscula.endsWith('/servidor.js') || rutaMinuscula.endsWith('/transmisor.js')) {
        return res.status(403).json({ error: 'Acceso denegado a recursos internos del servidor.' });
    }
    next();
});

app.use(express.static(path.join(__dirname), { index: false }));

function compararSeguro(a, b) {
    const strA = String(a || '');
    const strB = String(b || '');
    const bufA = Buffer.from(strA, 'utf8');
    const bufB = Buffer.from(strB, 'utf8');
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
}

function actualizarEnjambre(datos) {
    if (Array.isArray(datos)) {
        estadoEnjambre = datos;
    }
}

function actualizarRadarRed(datos) {
    if (datos && typeof datos === 'object') {
        estadoRadarRed = datos;
    }
}

app.post('/api/login', (req, res) => {
    const ipCliente = req.ip || req.socket?.remoteAddress || 'unknown';
    const ahora = Date.now();
    const registroIP = intentosFallidosIP.get(ipCliente);

    if (registroIP && registroIP.lockUntil > ahora) {
        const segundosRestantes = Math.ceil((registroIP.lockUntil - ahora) / 1000);
        return res.status(429).json({
            error: `Demasiados intentos. Bloqueado por ${segundosRestantes}s.`
        });
    }

    const { usuario, clave } = req.body || {};
    const usuarioValido = compararSeguro(usuario, USUARIO_MAESTRO);
    const claveValida = compararSeguro(clave, PASSWORD_MAESTRA);

    if (usuarioValido && claveValida) {
        intentosFallidosIP.delete(ipCliente);
        const sessionToken = crypto.randomBytes(32).toString('hex');
        sesionesActivas.set(sessionToken, ahora + SESSION_TTL_MS);
        return res.json({ success: true, token: sessionToken });
    }

    const conteoActual = (registroIP?.count || 0) + 1;
    if (conteoActual >= MAX_INTENTOS_LOGIN) {
        intentosFallidosIP.set(ipCliente, { count: conteoActual, lockUntil: ahora + BLOQUEO_LOGIN_MS });
    } else {
        intentosFallidosIP.set(ipCliente, { count: conteoActual, lockUntil: 0 });
    }

    return res.status(403).json({ error: 'Credenciales inválidas' });
});

function autenticar(req, res, next) {
    const headerKey = req.headers['x-auth-key'];
    if (!headerKey) {
        return res.status(403).json({ error: 'No autorizado' });
    }

    const ahora = Date.now();
    if (sesionesActivas.has(headerKey)) {
        const expira = sesionesActivas.get(headerKey);
        if (ahora < expira) {
            return next();
        }
        sesionesActivas.delete(headerKey);
    }

    if (compararSeguro(headerKey, PASSWORD_MAESTRA)) {
        return next();
    }

    return res.status(403).json({ error: 'Sesión expirada o clave incorrecta' });
}

app.get('/api/datos', autenticar, async (req, res) => {
    try {
        const expedientes = await database.obtenerExpedientes({});
        const hace24HorasMs = Date.now() - 86400000;

        const datos = {
            total_registros: expedientes.length,
            alertas_recientes: 0,
            enjambre: estadoEnjambre,
            blacklist: [],
            links: [],
            expedientes: expedientes
        };

        const regexUrl = /(https?:\/\/[^\s<>]+|discord\.gg\/[^\s<>]+)/i;

        for (const exp of expedientes) {
            const fechaPrimerFichajeMs = Date.parse(exp.primerFichaje);
            if (!Number.isNaN(fechaPrimerFichajeMs) && fechaPrimerFichajeMs > hace24HorasMs) {
                datos.alertas_recientes++;
            }

            const historial = Array.isArray(exp.historial) ? exp.historial : [];
            const delitosGraves = [];

            for (const delito of historial) {
                if (!delito || typeof delito !== 'object') continue;
                const accionStr = String(delito.accion || '');
                const msgOriginal = String(delito.mensajeOriginal || '');

                if (accionStr.includes('Links')) {
                    const urlMatch = msgOriginal.match(regexUrl);
                    datos.links.push({
                        id: exp.userId,
                        serverName: delito.servidor || 'Sector Desconocido',
                        mensaje: msgOriginal,
                        url: urlMatch ? urlMatch[0] : '#',
                        fecha: delito.fecha || exp.primerFichaje || new Date().toISOString()
                    });
                } else if (!accionStr.includes('OSINT')) {
                    delitosGraves.push(delito);
                }
            }

            if (delitosGraves.length > 0) {
                const ultimoGrave = delitosGraves[delitosGraves.length - 1];
                datos.blacklist.push({
                    id: exp.userId,
                    username: exp.ultimoAlias || 'Desconocido',
                    reincidencia: exp.totalInfracciones || delitosGraves.length,
                    evidencia: ultimoGrave.mensajeOriginal || '[ Sin evidencia ]',
                    fecha: ultimoGrave.fecha || exp.primerFichaje,
                    servidor: ultimoGrave.servidor || 'Sector Desconocido',
                    notas: exp.notasAnalista || '',
                    historial: historial
                });
            } else {
                const ultimoEvento = historial.length > 0 ? historial[historial.length - 1] : null;
                datos.blacklist.push({
                    id: exp.userId,
                    username: exp.ultimoAlias || 'Identidad Desconocida',
                    reincidencia: exp.totalInfracciones || 0,
                    evidencia: ultimoEvento ? ultimoEvento.mensajeOriginal : '[ SIN REGISTROS ACTIVOS ]',
                    fecha: (ultimoEvento && ultimoEvento.fecha) || exp.primerFichaje || new Date().toISOString(),
                    servidor: (ultimoEvento && ultimoEvento.servidor) || 'N/A',
                    notas: exp.notasAnalista || '',
                    historial: historial
                });
            }
        }

        res.json(datos);
    } catch (error) {
        console.error('[ERROR API /api/datos]:', error.message);
        res.status(500).json({ error: 'Desincronización de Base de Datos' });
    }
});

/**
 * Endpoint en tiempo real para el Mapa de Red (Nodos Rojos = Servidores, Nodos Verdes = Usuarios).
 * Combina la actividad viva captada por los exploradores con los expedientes históricos de MongoDB.
 */
app.get('/api/red', autenticar, async (req, res) => {
    try {
        const expedientes = await database.obtenerExpedientes({});
        const mapaServidores = new Map();
        const mapaUsuarios = new Map();

        // 1. Cargar servidores en vivo (con sus IDs reales)
        for (const srv of (estadoRadarRed.servidores || [])) {
            mapaServidores.set(srv.id, { ...srv });
        }

        // 2. Cargar usuarios activos en vivo
        for (const usr of (estadoRadarRed.usuarios || [])) {
            mapaUsuarios.set(usr.id, {
                ...usr,
                infracciones: 0,
                fichado: false,
                servidores: { ...(usr.servidores || {}) }
            });
        }

        // 3. Enriquecer con los expedientes históricos de MongoDB
        for (const exp of expedientes) {
            const uid = String(exp.userId || '').trim();
            if (!uid) continue;

            let usr = mapaUsuarios.get(uid);
            if (!usr) {
                usr = {
                    id: uid,
                    tag: exp.ultimoAlias || 'Objetivo Fichado',
                    avatar: null,
                    totalMensajes: exp.totalInfracciones || 1,
                    ultimaActividad: Date.parse(exp.primerFichaje) || Date.now(),
                    horasActivas: [],
                    servidores: {},
                    infracciones: exp.totalInfracciones || 0,
                    fichado: true
                };
            } else {
                usr.infracciones = exp.totalInfracciones || 0;
                usr.fichado = true;
            }

            const historial = Array.isArray(exp.historial) ? exp.historial : [];
            for (const h of historial) {
                const nombreSrv = String(h.servidor || '').trim();
                if (!nombreSrv || nombreSrv === 'N/A') continue;

                // Buscar si ese nombre de servidor ya corresponde a un servidor vivo por nombre
                let srvIdEncontrado = null;
                for (const [sId, sObj] of mapaServidores.entries()) {
                    if (sObj.name.toLowerCase() === nombreSrv.toLowerCase()) {
                        srvIdEncontrado = sId;
                        break;
                    }
                }
                if (!srvIdEncontrado) {
                    srvIdEncontrado = `HIST_${nombreSrv.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
                    if (!mapaServidores.has(srvIdEncontrado)) {
                        mapaServidores.set(srvIdEncontrado, {
                            id: srvIdEncontrado,
                            name: nombreSrv,
                            icon: null,
                            memberCount: 0,
                            mensajesSesion: 1,
                            ultimaActividad: Date.parse(h.fecha) || 0,
                            exploradores: ['Archivo Histórico']
                        });
                    }
                }

                if (!usr.servidores[srvIdEncontrado]) {
                    usr.servidores[srvIdEncontrado] = {
                        name: nombreSrv,
                        count: 1,
                        lastSeen: Date.parse(h.fecha) || Date.now()
                    };
                } else {
                    usr.servidores[srvIdEncontrado].count += 1;
                }
            }

            mapaUsuarios.set(uid, usr);
        }

        res.json({
            enjambre: estadoEnjambre,
            servidores: Array.from(mapaServidores.values()),
            usuarios: Array.from(mapaUsuarios.values()),
            interacciones: estadoRadarRed.interacciones || [],
            pulsos: estadoRadarRed.pulsos || []
        });
    } catch (error) {
        console.error('[ERROR API /api/red]:', error.message);
        res.status(500).json({ error: 'Error al compilar la matriz de red.' });
    }
});

app.post('/api/notas', autenticar, async (req, res) => {
    const { id, nota } = req.body || {};
    if (!id) return res.status(400).json({ error: 'Identificador requerido.' });
    try {
        const exito = await database.actualizarNotaOSINT(String(id), String(nota ?? ''));
        return exito
            ? res.json({ success: true })
            : res.status(500).json({ error: 'No se pudo actualizar la nota.' });
    } catch (error) {
        return res.status(500).json({ error: 'Fallo interno en BD' });
    }
});

app.post('/api/eliminar', autenticar, async (req, res) => {
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ error: 'Identificador requerido.' });
    try {
        const exito = await database.eliminarExpediente(String(id));
        return exito
            ? res.json({ success: true })
            : res.status(404).json({ error: 'Expediente no encontrado o ya eliminado.' });
    } catch (error) {
        return res.status(500).json({ error: 'Fallo interno en BD' });
    }
});

app.get('/api/exportar', autenticar, async (req, res) => {
    try {
        const cursor = database.obtenerExpedientesCursor({});
        if (!cursor) return res.status(503).send('Base de datos no disponible');

        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="C4ISR_DATABASE.json"');

        res.write('[\n');
        let primero = true;
        for await (const doc of cursor) {
            if (!primero) res.write(',\n');
            res.write(JSON.stringify(doc, null, 2));
            primero = false;
        }
        res.write('\n]\n');
        res.end();
    } catch (error) {
        console.error('[ERROR API /api/exportar]:', error.message);
        if (!res.headersSent) res.status(500).send('Fallo durante la exportación');
    }
});

app.post('/api/objetivos/manual', autenticar, async (req, res) => {
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ error: 'ID requerido.' });
    try {
        const exito = await database.inyectarObjetivoManual(String(id));
        return exito
            ? res.json({ success: true })
            : res.status(400).json({ error: 'ID inválido (debe ser un Snowflake numérico de 17-20 dígitos) o fallo de BD.' });
    } catch (error) {
        return res.status(500).json({ error: 'Error interno BD' });
    }
});

app.post('/api/objetivos/importar', autenticar, async (req, res) => {
    const { matriz } = req.body || {};
    if (!Array.isArray(matriz)) return res.status(400).json({ error: 'Matriz JSON inválida.' });
    try {
        const exito = await database.importarMatriz(matriz);
        return exito
            ? res.json({ success: true })
            : res.status(400).json({ error: 'No se encontraron registros válidos para importar.' });
    } catch (error) {
        return res.status(500).json({ error: 'Error interno BD' });
    }
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

function iniciar() {
    app.listen(PUERTO, () => {
        console.log(`[LA BIBLIOTECA] Servidor web operativo en puerto ${PUERTO}`);
    });
}

module.exports = { iniciar, actualizarEnjambre, actualizarRadarRed };
