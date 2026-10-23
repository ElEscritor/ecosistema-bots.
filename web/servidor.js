'use strict';

const express = require('express');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');
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

let servidorIniciado = false;
let estadoEnjambre = [];
let estadoRadarRed = {
    servidores: [],
    usuarios: [],
    interacciones: [],
    pulsos: []
};

// Memoria persistente de invitaciones resueltas: Map<codeLower, { code, url, status, guildId, guildName, icon, memberCount, origenes: Array, emisores: Array, fecha }>
const memoriaInvitaciones = new Map();
const colaResolucionInvites = [];
let resolviendoInvites = false;

// Regex estricto para limpiar plantillas históricas y aislar solo invitaciones reales de Discord
const REGEX_INVITE_STRICT = /(?:https?:\/\/)?(?:www\.)?(?:discord\.(?:gg|io|me|li)|discordapp\.com\/invite|discord\.com\/invite)\/([a-zA-Z0-9-]{2,32})/gi;
const RUTAS_DISCORD_RESERVADAS = new Set([
    'events', 'channels', 'assets', 'developers', 'oauth2', 'login',
    'register', 'download', 'nitro', 'safety', 'terms', 'privacy',
    'guidelines', 'billing', 'store', 'template', 'gifts'
]);

function extraerInvitacionesDeTexto(texto) {
    if (typeof texto !== 'string' || texto.length === 0) return [];
    const codigos = new Set();
    let match;
    const regex = new RegExp(REGEX_INVITE_STRICT.source, 'gi');

    while ((match = regex.exec(texto)) !== null) {
        const codigo = String(match[1] || '').trim();
        if (!codigo) continue;
        if (RUTAS_DISCORD_RESERVADAS.has(codigo.toLowerCase())) continue;
        codigos.add(codigo);
    }

    return Array.from(codigos).map(code => ({
        code,
        url: `https://discord.gg/${code}`
    }));
}

/**
 * Normaliza nombres de servidores quitando emojis, símbolos y espacios extra
 * para emparejar servidores históricos con los servidores reales y evitar falsas burbujas.
 */
function normalizarNombreServidor(nombre) {
    if (!nombre || typeof nombre !== 'string') return '';
    return nombre
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, '')
        .trim();
}

function registrarInvitacionViva(info) {
    if (!info || !info.code) return;
    const key = String(info.code).toLowerCase();
    let entry = memoriaInvitaciones.get(key);

    if (!entry) {
        entry = {
            code: info.code,
            url: `https://discord.gg/${info.code}`,
            status: 'PENDING',
            guildId: null,
            guildName: null,
            icon: null,
            memberCount: 0,
            origenes: [],
            emisores: [],
            fecha: info.fecha || new Date().toISOString()
        };
        memoriaInvitaciones.set(key, entry);
        encolarResolucionInvite(key);
    }

    if (info.origenServerName && info.origenServerName !== 'Sector Privado (DM)' && !entry.origenes.includes(info.origenServerName)) {
        entry.origenes.push(info.origenServerName);
    }
    if (info.emisorId && !entry.emisores.includes(info.emisorId)) {
        entry.emisores.push(info.emisorId);
    }
    if (info.fecha && info.fecha > entry.fecha) {
        entry.fecha = info.fecha;
    }
}

function encolarResolucionInvite(key) {
    if (!colaResolucionInvites.includes(key)) {
        colaResolucionInvites.push(key);
        procesarColaInvites();
    }
}

async function procesarColaInvites() {
    if (resolviendoInvites || colaResolucionInvites.length === 0) return;
    resolviendoInvites = true;

    while (colaResolucionInvites.length > 0) {
        const key = colaResolucionInvites.shift();
        const entry = memoriaInvitaciones.get(key);
        if (!entry || entry.status === 'VALID' || entry.status === 'EXPIRED') continue;

        try {
            const res = await axios.get(
                `https://discord.com/api/v9/invites/${encodeURIComponent(entry.code)}?with_counts=true`,
                { timeout: 5000 }
            );
            if (res.data && res.data.guild) {
                const g = res.data.guild;
                entry.status = 'VALID';
                entry.guildId = String(g.id);
                entry.guildName = String(g.name || 'Servidor');
                entry.memberCount = res.data.approximate_member_count || 0;
                entry.icon = g.icon
                    ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=64`
                    : null;
            } else {
                entry.status = 'EXPIRED';
            }
        } catch (err) {
            const status = err.response?.status;
            if (status === 404) {
                entry.status = 'EXPIRED';
            } else if (status === 429) {
                const retryMs = Math.ceil((Number(err.response?.data?.retry_after) || 5) * 1000) + 500;
                colaResolucionInvites.push(key);
                await new Promise(r => setTimeout(r, retryMs));
            } else {
                entry.status = 'UNKNOWN';
            }
        }

        await new Promise(r => setTimeout(r, 1600));
    }

    resolviendoInvites = false;
}

function restaurarCacheInvitaciones(lista) {
    if (!Array.isArray(lista)) return;
    for (const item of lista) {
        if (item && item.code) {
            const key = String(item.code).toLowerCase();
            memoriaInvitaciones.set(key, item);
            if (item.status === 'PENDING' || item.status === 'UNKNOWN') {
                encolarResolucionInvite(key);
            }
        }
    }
}

function exportarCacheInvitaciones() {
    return Array.from(memoriaInvitaciones.values());
}

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

        // Mapa para deduplicar links en LinksPortal por código de invitación real
        const linksUnicosPorCodigo = new Map();

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

                // Extraer invitaciones reales de cualquier mensaje histórico (ignora cdn.discordapp.com, events, imgur)
                const invitesEncontradas = extraerInvitacionesDeTexto(msgOriginal);
                if (invitesEncontradas.length > 0) {
                    const fechaDelito = delito.fecha || exp.primerFichaje || new Date().toISOString();
                    for (const inv of invitesEncontradas) {
                        registrarInvitacionViva({
                            code: inv.code,
                            url: inv.url,
                            origenServerName: delito.servidor || 'Sector Desconocido',
                            emisorId: exp.userId,
                            emisorTag: exp.ultimoAlias || 'Usuario',
                            fecha: fechaDelito
                        });

                        const codeKey = inv.code.toLowerCase();
                        const memInfo = memoriaInvitaciones.get(codeKey);
                        const nombreMostrar = (memInfo && memInfo.guildName)
                            ? memInfo.guildName
                            : (delito.servidor || 'Sector Desconocido');

                        const mensajeLimpio = msgOriginal.replace(/^\[INVITE_DETECTADA:[^\]]+\]\n?/i, '');

                        if (!linksUnicosPorCodigo.has(codeKey)) {
                            linksUnicosPorCodigo.set(codeKey, {
                                id: exp.userId,
                                serverName: nombreMostrar,
                                origenName: delito.servidor || 'Sector Desconocido',
                                mensaje: mensajeLimpio,
                                url: inv.url,
                                fecha: fechaDelito
                            });
                        }
                    }
                }

                if (!accionStr.includes('Links') && !accionStr.includes('OSINT')) {
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

        datos.links = Array.from(linksUnicosPorCodigo.values());
        res.json(datos);
    } catch (error) {
        console.error('[ERROR API /api/datos]:', error.message);
        res.status(500).json({ error: 'Desincronización de Base de Datos' });
    }
});

app.get('/api/red', autenticar, async (req, res) => {
    try {
        const expedientes = await database.obtenerExpedientes({});
        const mapaServidores = new Map();
        const indiceNombreServidor = new Map(); // normName -> serverId (evita falsas burbujas duplicadas)
        const mapaUsuarios = new Map();

        const buscarServidorPorNombre = (nombre) => {
            const norm = normalizarNombreServidor(nombre);
            if (!norm) return null;
            if (indiceNombreServidor.has(norm)) return indiceNombreServidor.get(norm);
            for (const [nKey, sId] of indiceNombreServidor.entries()) {
                if (nKey.length >= 4 && norm.length >= 4 && (nKey.includes(norm) || norm.includes(nKey))) {
                    return sId;
                }
            }
            return null;
        };

        // 1. Cargar servidores en vivo (con sus IDs reales)
        for (const srv of (estadoRadarRed.servidores || [])) {
            if (!srv || !srv.id || srv.id === 'DM_SECTOR') continue;
            mapaServidores.set(srv.id, {
                ...srv,
                usuariosCount: 0,
                inviteUrl: srv.inviteUrl || null,
                alianzasSalientes: []
            });
            const norm = normalizarNombreServidor(srv.name);
            if (norm) indiceNombreServidor.set(norm, srv.id);
        }

        // 2. Vincular primero invitaciones ya resueltas (VALID) a los servidores existentes por ID o Nombre
        for (const inv of memoriaInvitaciones.values()) {
            if (inv.status === 'VALID' && inv.guildId) {
                let targetId = mapaServidores.has(inv.guildId)
                    ? inv.guildId
                    : buscarServidorPorNombre(inv.guildName);

                if (targetId && mapaServidores.has(targetId)) {
                    const srvExistente = mapaServidores.get(targetId);
                    srvExistente.inviteUrl = inv.url;
                    if (!srvExistente.memberCount && inv.memberCount) {
                        srvExistente.memberCount = inv.memberCount;
                    }
                    if (!srvExistente.icon && inv.icon) {
                        srvExistente.icon = inv.icon;
                    }
                } else {
                    // Servidor real verificado por Discord API a través de invitación activa
                    targetId = inv.guildId;
                    mapaServidores.set(targetId, {
                        id: targetId,
                        name: inv.guildName || 'Servidor Aliado',
                        icon: inv.icon || null,
                        memberCount: inv.memberCount || 0,
                        mensajesSesion: 1,
                        ultimaActividad: Date.parse(inv.fecha) || Date.now(),
                        exploradores: ['Radar de Alianzas (Invite Activa)'],
                        usuariosCount: 0,
                        inviteUrl: inv.url,
                        alianzasSalientes: []
                    });
                    const norm = normalizarNombreServidor(inv.guildName);
                    if (norm) indiceNombreServidor.set(norm, targetId);
                }
            }
        }

        // 3. Cargar usuarios activos en vivo
        for (const usr of (estadoRadarRed.usuarios || [])) {
            const servidoresLimpiados = {};
            for (const [sId, sData] of Object.entries(usr.servidores || {})) {
                if (sId === 'DM_SECTOR') continue;
                servidoresLimpiados[sId] = { ...sData };
            }
            mapaUsuarios.set(usr.id, {
                ...usr,
                horasActivas: Array.isArray(usr.horasActivas) ? [...usr.horasActivas] : [],
                infracciones: 0,
                fichado: false,
                servidores: servidoresLimpiados
            });
        }

        // 4. Enriquecer con los expedientes históricos de MongoDB y extraer invitaciones ocultas
        for (const exp of expedientes) {
            const uid = String(exp.userId || '').trim();
            if (!uid) continue;

            const primerTs = Date.parse(exp.primerFichaje);
            let usr = mapaUsuarios.get(uid);
            if (!usr) {
                const horasSet = new Set();
                if (!Number.isNaN(primerTs)) {
                    horasSet.add(new Date(primerTs).getUTCHours());
                }
                usr = {
                    id: uid,
                    tag: exp.ultimoAlias || 'Objetivo Fichado',
                    avatar: null,
                    totalMensajes: exp.totalInfracciones || 1,
                    ultimaActividad: !Number.isNaN(primerTs) ? primerTs : Date.now(),
                    horasActivas: Array.from(horasSet),
                    servidores: {},
                    infracciones: exp.totalInfracciones || 0,
                    fichado: true
                };
            } else {
                usr.infracciones = exp.totalInfracciones || 0;
                usr.fichado = true;
            }

            const horasUsuarioSet = new Set(usr.horasActivas);
            const historial = Array.isArray(exp.historial) ? exp.historial : [];

            for (const h of historial) {
                if (!h || typeof h !== 'object') continue;
                const eventoTs = Date.parse(h.fecha);
                if (!Number.isNaN(eventoTs)) {
                    horasUsuarioSet.add(new Date(eventoTs).getUTCHours());
                    if (eventoTs > (usr.ultimaActividad || 0)) {
                        usr.ultimaActividad = eventoTs;
                    }
                }

                const msgCrudo = String(h.mensajeOriginal || '');
                const invitesEnMsg = extraerInvitacionesDeTexto(msgCrudo);
                for (const inv of invitesEnMsg) {
                    registrarInvitacionViva({
                        code: inv.code,
                        url: inv.url,
                        origenServerName: h.servidor || 'Sector Desconocido',
                        emisorId: uid,
                        emisorTag: usr.tag,
                        fecha: h.fecha || exp.primerFichaje
                    });
                }

                const nombreSrv = String(h.servidor || '').trim();
                if (
                    !nombreSrv ||
                    nombreSrv === 'N/A' ||
                    nombreSrv === 'Sector Desconocido' ||
                    nombreSrv.includes('Sector Privado')
                ) {
                    continue;
                }

                let srvIdEncontrado = buscarServidorPorNombre(nombreSrv);
                if (!srvIdEncontrado) {
                    const norm = normalizarNombreServidor(nombreSrv);
                    if (!norm) continue;
                    srvIdEncontrado = `HIST_${norm.toUpperCase()}`;
                    if (!mapaServidores.has(srvIdEncontrado)) {
                        mapaServidores.set(srvIdEncontrado, {
                            id: srvIdEncontrado,
                            name: nombreSrv,
                            icon: null,
                            memberCount: 0,
                            mensajesSesion: 1,
                            ultimaActividad: !Number.isNaN(eventoTs) ? eventoTs : 0,
                            exploradores: ['Archivo Histórico'],
                            usuariosCount: 0,
                            inviteUrl: null,
                            alianzasSalientes: []
                        });
                        indiceNombreServidor.set(norm, srvIdEncontrado);
                    }
                }

                // Si el mensaje en este servidor contenía una invitación cuyo nombre coincide con el propio servidor, o si aún no tiene invite asignada y el mensaje anuncia el servidor
                if (invitesEnMsg.length > 0) {
                    const srvNode = mapaServidores.get(srvIdEncontrado);
                    for (const inv of invitesEnMsg) {
                        const mem = memoriaInvitaciones.get(inv.code.toLowerCase());
                        if (mem && mem.status === 'VALID' && mem.guildName) {
                            if (normalizarNombreServidor(mem.guildName) === normalizarNombreServidor(srvNode.name)) {
                                srvNode.inviteUrl = inv.url;
                            }
                        } else if (!srvNode.inviteUrl && msgCrudo.toLowerCase().includes(srvNode.name.toLowerCase())) {
                            srvNode.inviteUrl = inv.url;
                        }
                    }
                }

                if (!usr.servidores[srvIdEncontrado]) {
                    usr.servidores[srvIdEncontrado] = {
                        name: mapaServidores.get(srvIdEncontrado)?.name || nombreSrv,
                        count: 1,
                        lastSeen: !Number.isNaN(eventoTs) ? eventoTs : Date.now()
                    };
                } else {
                    usr.servidores[srvIdEncontrado].count += 1;
                    if (!Number.isNaN(eventoTs) && eventoTs > usr.servidores[srvIdEncontrado].lastSeen) {
                        usr.servidores[srvIdEncontrado].lastSeen = eventoTs;
                    }
                }
            }

            usr.horasActivas = Array.from(horasUsuarioSet).sort((a, b) => a - b);
            mapaUsuarios.set(uid, usr);
        }

        // 5. Construir Vectores de Alianzas (Flechas Púrpura entre Servidor Emisor -> Servidor Promocionado)
        const alianzas = [];
        for (const inv of memoriaInvitaciones.values()) {
            let targetSrvId = null;
            if (inv.status === 'VALID' && inv.guildId) {
                targetSrvId = mapaServidores.has(inv.guildId)
                    ? inv.guildId
                    : buscarServidorPorNombre(inv.guildName);
            }

            for (const origenNombre of (inv.origenes || [])) {
                const sourceSrvId = buscarServidorPorNombre(origenNombre);
                if (!sourceSrvId || !mapaServidores.has(sourceSrvId)) continue;

                const sourceNode = mapaServidores.get(sourceSrvId);
                if (targetSrvId && targetSrvId === sourceSrvId) {
                    // La invitación publicada pertenece a este mismo servidor: ya tenemos su link oficial
                    sourceNode.inviteUrl = inv.url;
                    continue;
                }

                // Registrar en la lista de alianzas salientes del servidor emisor
                const targetLabel = (targetSrvId && mapaServidores.get(targetSrvId)?.name) || inv.guildName || `discord.gg/${inv.code}`;
                if (!sourceNode.alianzasSalientes.some(a => a.url === inv.url)) {
                    sourceNode.alianzasSalientes.push({
                        code: inv.code,
                        url: inv.url,
                        targetName: targetLabel,
                        targetServerId: targetSrvId,
                        status: inv.status
                    });
                }

                if (targetSrvId && mapaServidores.has(targetSrvId) && sourceSrvId !== targetSrvId) {
                    alianzas.push({
                        sourceServerId: sourceSrvId,
                        targetServerId: targetSrvId,
                        inviteUrl: inv.url,
                        code: inv.code,
                        targetName: targetLabel
                    });
                }
            }
        }

        // 6. Calcular usuarios conectados por cada servidor
        for (const usr of mapaUsuarios.values()) {
            for (const sId of Object.keys(usr.servidores || {})) {
                const srvObj = mapaServidores.get(sId);
                if (srvObj) {
                    srvObj.usuariosCount = (srvObj.usuariosCount || 0) + 1;
                }
            }
        }

        res.json({
            enjambre: estadoEnjambre,
            servidores: Array.from(mapaServidores.values()),
            usuarios: Array.from(mapaUsuarios.values()),
            interacciones: estadoRadarRed.interacciones || [],
            alianzas: alianzas,
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
    if (servidorIniciado) return;
    servidorIniciado = true;
    app.listen(PUERTO, '0.0.0.0', () => {
        console.log(`[LA BIBLIOTECA] Servidor web operativo en puerto ${PUERTO} (0.0.0.0)`);
    });
}

module.exports = {
    iniciar,
    actualizarEnjambre,
    actualizarRadarRed,
    registrarInvitacionViva,
    restaurarCacheInvitaciones,
    exportarCacheInvitaciones
};
