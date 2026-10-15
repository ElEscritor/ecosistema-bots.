'use strict';

const express = require('express');
const path = require('path');
const crypto = require('crypto');
const database = require('../database.js');

const app = express();
const PUERTO = Number(process.env.PORT) || 3000;

// Prioriza variables de entorno manteniendo fallback compatible con tu configuración actual
const USUARIO_MAESTRO = process.env.PANEL_USER || 'Admin';
const PASSWORD_MAESTRA = process.env.PANEL_PASSWORD || '1930';

// Almacén de sesiones activas y control anti-fuerza bruta en memoria
const sesionesActivas = new Map(); // Map<token, expirationTimestamp>
const intentosFallidosIP = new Map(); // Map<ip, { count, lockUntil }>

const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 horas
const MAX_INTENTOS_LOGIN = 8;
const BLOQUEO_LOGIN_MS = 5 * 60 * 1000; // 5 minutos

let estadoEnjambre = [];

// Cabeceras de seguridad básicas y desactivación de huella del servidor
app.disable('x-powered-by');
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
});

app.use(express.json({ limit: '25mb' }));

// BLOQUEO CRÍTICO DE SEGURIDAD: Impedir que los scripts de backend sean descargados como archivos estáticos
app.use((req, res, next) => {
    const rutaMinuscula = req.path.toLowerCase();
    if (rutaMinuscula.endsWith('/servidor.js') || rutaMinuscula.endsWith('/transmisor.js')) {
        return res.status(403).json({ error: 'Acceso denegado a recursos internos del servidor.' });
    }
    next();
});

app.use(express.static(path.join(__dirname), { index: false }));

/**
 * Comparación en tiempo constante para evitar ataques de timing.
 */
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

/**
 * Endpoint de autenticación con protección contra fuerza bruta.
 */
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

/**
 * Middleware de autenticación compatible con token de sesión y con clave directa (retrocompatibilidad).
 */
function autenticar(req, res, next) {
    const headerKey = req.headers['x-auth-key'];
    if (!headerKey) {
        return res.status(403).json({ error: 'No autorizado' });
    }

    const ahora = Date.now();
    // 1. Verificar si es un token de sesión emitido por /api/login
    if (sesionesActivas.has(headerKey)) {
        const expira = sesionesActivas.get(headerKey);
        if (ahora < expira) {
            return next();
        }
        sesionesActivas.delete(headerKey);
    }

    // 2. Fallback de retrocompatibilidad si el cliente envió la clave maestra directamente
    if (compararSeguro(headerKey, PASSWORD_MAESTRA)) {
        return next();
    }

    return res.status(403).json({ error: 'Sesión expirada o clave incorrecta' });
}

/**
 * Endpoint central de telemetría y sincronización de vistas.
 */
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
            expedientes: expedientes // Disponible íntegro para las vistas que requieran el historial completo
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

                // A. Clasificación para Radar de Alianzas (LinksPortal)
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

            // B. Clasificación para Blacklist y Expedientes (Sin perder perfiles de solo-OSINT o manuales)
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
                // Incluye perfiles OSINT, o de Links, o inyectados manualmente para que no desaparezcan de Expedientes
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

/**
 * Exportación mediante streaming para evitar desbordar la memoria RAM en bases de datos grandes.
 */
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

module.exports = { iniciar, actualizarEnjambre };
