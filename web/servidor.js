'use strict';

const express = require('express');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');
const database = require('../database.js');
const intelExterna = require('../modulos/modulo_intel_externa.js');

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
let callbackDesplegarToken = null;
let estadoEnjambre = [];
let estadoRadarRed = {
    servidores: [],
    usuarios: [],
    interacciones: [],
    pulsos: [],
    bitacoraDvr: []
};

const memoriaInvitaciones = new Map();
const etiquetasServidores = new Map();
const watchlistUsuarios = new Set();
const colaResolucionInvites = [];
let resolviendoInvites = false;

const REGEX_INVITE_STRICT = /(?:https?:\/\/)?(?:www\.)?(?:discord\.(?:gg|io|me|li)|discordapp\.com\/invite|discord\.com\/invite)\/([a-zA-Z0-9-]{2,32})/gi;
const RUTAS_DISCORD_RESERVADAS = new Set([
    'events', 'channels', 'assets', 'developers', 'oauth2', 'login',
    'register', 'download', 'nitro', 'safety', 'terms', 'privacy',
    'guidelines', 'billing', 'store', 'template', 'gifts'
]);

function registrarCallbackNuevoToken(fn) {
    if (typeof fn === 'function') {
        callbackDesplegarToken = fn;
    }
}

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

function restaurarEtiquetasServidores(obj) {
    if (!obj || typeof obj !== 'object') return;
    for (const [k, val] of Object.entries(obj)) {
        if (val && typeof val === 'object') {
            etiquetasServidores.set(k, val);
        }
    }
}

function exportarEtiquetasServidores() {
    return Object.fromEntries(etiquetasServidores.entries());
}

function restaurarWatchlist(arr) {
    if (!Array.isArray(arr)) return;
    for (const id of arr) {
        if (id) watchlistUsuarios.add(String(id));
    }
}

function exportarWatchlist() {
    return Array.from(watchlistUsuarios);
}

function esObjetivoWatchlist(userId) {
    return watchlistUsuarios.has(String(userId));
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

    return res.status(403).json({ error: 'Credenciales invalidas' });
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

    return res.status(403).json({ error: 'Sesion expirada o clave incorrecta' });
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
                    historialAliases: Array.isArray(exp.historialAliases) ? exp.historialAliases : [],
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
                    historialAliases: Array.isArray(exp.historialAliases) ? exp.historialAliases : [],
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
        res.status(500).json({ error: 'Desincronizacion de Base de Datos' });
    }
});

app.get('/api/red', autenticar, async (req, res) => {
    try {
        const expedientes = await database.obtenerExpedientes({});
        const mapaServidores = new Map();
        const indiceNombreServidor = new Map();
        const mapaUsuarios = new Map();
        const conteoServidoresVps = new Map();

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

        for (const srv of (estadoRadarRed.servidores || [])) {
            if (!srv || !srv.id || srv.id === 'DM_SECTOR') continue;
            const etiqueta = etiquetasServidores.get(srv.id) || null;
            mapaServidores.set(srv.id, {
                ...srv,
                usuariosCount: 0,
                infeccionCount: 0,
                infeccionPct: 0,
                inviteUrl: srv.inviteUrl || null,
                etiquetaManual: etiqueta,
                redundancia: Array.isArray(srv.exploradores) ? srv.exploradores.length : 0,
                alianzasSalientes: []
            });
            const norm = normalizarNombreServidor(srv.name);
            if (norm) indiceNombreServidor.set(norm, srv.id);
            if (srv.nombreOriginal) {
                const normOrig = normalizarNombreServidor(srv.nombreOriginal);
                if (normOrig) indiceNombreServidor.set(normOrig, srv.id);
            }
        }

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
                    targetId = inv.guildId;
                    mapaServidores.set(targetId, {
                        id: targetId,
                        name: inv.guildName || 'Servidor Aliado',
                        nombreOriginal: inv.guildName || 'Servidor Aliado',
                        icon: inv.icon || null,
                        memberCount: inv.memberCount || 0,
                        mensajesSesion: 1,
                        ultimaActividad: Date.parse(inv.fecha) || Date.now(),
                        exploradores: ['Radar de Alianzas (Invite Activa)'],
                        redundancia: 0,
                        usuariosCount: 0,
                        infeccionCount: 0,
                        infeccionPct: 0,
                        inviteUrl: inv.url,
                        etiquetaManual: etiquetasServidores.get(targetId) || null,
                        estadoCeniza: null,
                        alianzasSalientes: []
                    });
                    const norm = normalizarNombreServidor(inv.guildName);
                    if (norm) indiceNombreServidor.set(norm, targetId);
                }
            }
        }

        for (const usr of (estadoRadarRed.usuarios || [])) {
            const servidoresLimpiados = {};
            for (const [sId, sData] of Object.entries(usr.servidores || {})) {
                if (sId === 'DM_SECTOR') continue;
                servidoresLimpiados[sId] = { ...sData };
            }
            mapaUsuarios.set(usr.id, {
                ...usr,
                horasActivas: Array.isArray(usr.horasActivas) ? [...usr.horasActivas] : [],
                historialAliases: [usr.tag || 'Usuario'],
                perfilOsint: usr.perfilOsint || null,
                intelExterna: usr.intelExterna || null,
                pasadoVps: [],
                infracciones: 0,
                fichado: false,
                enWatchlist: watchlistUsuarios.has(String(usr.id)),
                servidores: servidoresLimpiados,
                ultimoServidorId: usr.ultimoServidorId !== 'DM_SECTOR' ? usr.ultimoServidorId : null
            });
        }

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
                    historialAliases: Array.isArray(exp.historialAliases) ? exp.historialAliases : [exp.ultimoAlias || 'Objetivo'],
                    perfilOsint: exp.perfilOsint || null,
                    intelExterna: exp.intelExterna || null,
                    pasadoVps: [],
                    servidores: {},
                    ultimoServidorId: null,
                    infracciones: exp.totalInfracciones || 0,
                    fichado: true,
                    enWatchlist: watchlistUsuarios.has(uid)
                };
            } else {
                usr.infracciones = exp.totalInfracciones || 0;
                usr.fichado = true;
                usr.enWatchlist = watchlistUsuarios.has(uid);
                if (exp.perfilOsint) {
                    usr.perfilOsint = { ...(exp.perfilOsint || {}), ...(usr.perfilOsint || {}) };
                }
                if (exp.intelExterna && !usr.intelExterna) {
                    usr.intelExterna = exp.intelExterna;
                }
                if (Array.isArray(exp.historialAliases) && exp.historialAliases.length > 0) {
                    usr.historialAliases = [...new Set([...usr.historialAliases, ...exp.historialAliases])];
                }
            }

            if (usr.intelExterna?.vpsRegistros && Array.isArray(usr.intelExterna.vpsRegistros)) {
                for (const reg of usr.intelExterna.vpsRegistros) {
                    if (reg.servidorExtraidoId && reg.servidorExtraidoNombre) {
                        usr.pasadoVps.push({
                            guildId: reg.servidorExtraidoId,
                            guildName: reg.servidorExtraidoNombre,
                            comando: reg.comandoExtraido || 'cmd',
                            fecha: reg.fecha || ''
                        });
                        if (!conteoServidoresVps.has(reg.servidorExtraidoId)) {
                            conteoServidoresVps.set(reg.servidorExtraidoId, {
                                name: reg.servidorExtraidoNombre,
                                users: new Set(),
                                commands: new Set()
                            });
                        }
                        const entryVps = conteoServidoresVps.get(reg.servidorExtraidoId);
                        entryVps.users.add(uid);
                        if (reg.comandoExtraido) entryVps.commands.add(reg.comandoExtraido);
                    }
                }
            }

            const horasUsuarioSet = new Set(usr.horasActivas);
            const historial = Array.isArray(exp.historial) ? exp.historial : [];
            let maxTsServidor = 0;

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
                            nombreOriginal: nombreSrv,
                            icon: null,
                            memberCount: 0,
                            mensajesSesion: 1,
                            ultimaActividad: !Number.isNaN(eventoTs) ? eventoTs : 0,
                            exploradores: ['Archivo Historico'],
                            redundancia: 0,
                            usuariosCount: 0,
                            infeccionCount: 0,
                            infeccionPct: 0,
                            inviteUrl: null,
                            etiquetaManual: etiquetasServidores.get(srvIdEncontrado) || null,
                            estadoCeniza: null,
                            alianzasSalientes: []
                        });
                        indiceNombreServidor.set(norm, srvIdEncontrado);
                    }
                }

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

                const tsVal = !Number.isNaN(eventoTs) ? eventoTs : Date.now();
                if (!usr.servidores[srvIdEncontrado]) {
                    usr.servidores[srvIdEncontrado] = {
                        name: mapaServidores.get(srvIdEncontrado)?.name || nombreSrv,
                        count: 1,
                        lastSeen: tsVal
                    };
                } else {
                    usr.servidores[srvIdEncontrado].count += 1;
                    if (tsVal > usr.servidores[srvIdEncontrado].lastSeen) {
                        usr.servidores[srvIdEncontrado].lastSeen = tsVal;
                    }
                }

                if (!usr.ultimoServidorId || tsVal >= maxTsServidor) {
                    maxTsServidor = tsVal;
                    usr.ultimoServidorId = srvIdEncontrado;
                }
            }

            usr.horasActivas = Array.from(horasUsuarioSet).sort((a, b) => a - b);
            mapaUsuarios.set(uid, usr);
        }

        for (const [vpsGuildId, infoVps] of conteoServidoresVps.entries()) {
            let targetId = mapaServidores.has(vpsGuildId)
                ? vpsGuildId
                : buscarServidorPorNombre(infoVps.name);

            if (targetId && mapaServidores.has(targetId)) {
                const srv = mapaServidores.get(targetId);
                if (!srv.etiquetaManual) {
                    srv.etiquetaManual = { texto: 'DETECTADO VPS', tipo: 'PROVEEDOR' };
                }
                for (const uid of infoVps.users) {
                    const uObj = mapaUsuarios.get(uid);
                    if (uObj && !uObj.servidores[targetId]) {
                        uObj.servidores[targetId] = { name: srv.name, count: 1, lastSeen: Date.now() };
                    }
                }
            } else if (infoVps.users.size >= 2) {
                mapaServidores.set(vpsGuildId, {
                    id: vpsGuildId,
                    name: infoVps.name,
                    nombreOriginal: infoVps.name,
                    icon: null,
                    memberCount: 0,
                    mensajesSesion: infoVps.users.size,
                    ultimaActividad: Date.now(),
                    exploradores: ['Nido Confirmado VPS-5604'],
                    redundancia: 0,
                    usuariosCount: 0,
                    infeccionCount: 0,
                    infeccionPct: 0,
                    inviteUrl: null,
                    etiquetaManual: { texto: 'NIDO VPS', tipo: 'PROVEEDOR' },
                    estadoCeniza: null,
                    alianzasSalientes: []
                });
                for (const uid of infoVps.users) {
                    const uObj = mapaUsuarios.get(uid);
                    if (uObj) {
                        uObj.servidores[vpsGuildId] = { name: infoVps.name, count: 1, lastSeen: Date.now() };
                    }
                }
            }
        }

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
                    sourceNode.inviteUrl = inv.url;
                    continue;
                }

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

        for (const usr of mapaUsuarios.values()) {
            const esUsuarioHostil = (usr.infracciones > 0) || Boolean(usr.intelExterna?.amenazaConfirmada);
            for (const sId of Object.keys(usr.servidores || {})) {
                const srvObj = mapaServidores.get(sId);
                if (srvObj) {
                    srvObj.usuariosCount = (srvObj.usuariosCount || 0) + 1;
                    if (esUsuarioHostil) {
                        srvObj.infeccionCount = (srvObj.infeccionCount || 0) + 1;
                    }
                }
            }
        }

        for (const srvObj of mapaServidores.values()) {
            if (srvObj.usuariosCount > 0) {
                srvObj.infeccionPct = Math.round((srvObj.infeccionCount / srvObj.usuariosCount) * 100);
            }
        }

        res.json({
            enjambre: estadoEnjambre,
            servidores: Array.from(mapaServidores.values()),
            usuarios: Array.from(mapaUsuarios.values()),
            interacciones: estadoRadarRed.interacciones || [],
            alianzas: alianzas,
            pulsos: estadoRadarRed.pulsos || [],
            bitacoraDvr: estadoRadarRed.bitacoraDvr || [],
            watchlist: Array.from(watchlistUsuarios)
        });
    } catch (error) {
        console.error('[ERROR API /api/red]:', error.message);
        res.status(500).json({ error: 'Error al compilar la matriz de red.' });
    }
});

app.post('/api/enjambre/token', autenticar, async (req, res) => {
    const { token, sector } = req.body || {};
    if (!token || typeof token !== 'string' || token.trim().length < 40) {
        return res.status(400).json({ error: 'Formato de token invalido.' });
    }

    const cleanToken = token.replace(/^(Bot|Bearer)\s+/i, '').trim();
    const sectorLimpio = String(sector || 'General').trim().slice(0, 30);

    try {
        if (typeof callbackDesplegarToken === 'function') {
            const resultado = await callbackDesplegarToken(cleanToken, sectorLimpio);
            if (!resultado.exito) {
                return res.status(400).json({ error: resultado.motivo || 'No se pudo iniciar sesion con ese token.' });
            }
            await database.guardarTokenDinamico(cleanToken, sectorLimpio);
            return res.json({
                success: true,
                tag: resultado.tag,
                guilds: resultado.guilds
            });
        }
        return res.status(503).json({ error: 'El motor de enjambre aun no esta listo.' });
    } catch (error) {
        return res.status(500).json({ error: 'Error interno al desplegar token.' });
    }
});

app.post('/api/red/etiqueta', autenticar, (req, res) => {
    const { serverId, texto, tipo } = req.body || {};
    if (!serverId) return res.status(400).json({ error: 'serverId requerido.' });

    const idLimpio = String(serverId).trim();
    const textoLimpio = String(texto || '').trim().slice(0, 22).toUpperCase();

    if (!textoLimpio) {
        etiquetasServidores.delete(idLimpio);
    } else {
        etiquetasServidores.set(idLimpio, {
            texto: textoLimpio,
            tipo: String(tipo || 'CUSTOM').toUpperCase()
        });
    }

    return res.json({ success: true, etiqueta: etiquetasServidores.get(idLimpio) || null });
});

app.post('/api/red/watchlist', autenticar, (req, res) => {
    const { userId } = req.body || {};
    if (!userId) return res.status(400).json({ error: 'userId requerido.' });

    const idLimpio = String(userId).trim();
    if (watchlistUsuarios.has(idLimpio)) {
        watchlistUsuarios.delete(idLimpio);
        return res.json({ success: true, enWatchlist: false });
    } else {
        watchlistUsuarios.add(idLimpio);
        return res.json({ success: true, enWatchlist: true });
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
        if (!res.headersSent) res.status(500).send('Fallo durante la exportacion');
    }
});

app.post('/api/objetivos/manual', autenticar, async (req, res) => {
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ error: 'ID requerido.' });
    try {
        const exito = await database.inyectarObjetivoManual(String(id));
        return exito
            ? res.json({ success: true })
            : res.status(400).json({ error: 'ID invalido (debe ser un Snowflake numerico de 17-20 digitos) o fallo de BD.' });
    } catch (error) {
        return res.status(500).json({ error: 'Error interno BD' });
    }
});

app.post('/api/objetivos/importar', autenticar, async (req, res) => {
    const { matriz } = req.body || {};
    if (!Array.isArray(matriz)) return res.status(400).json({ error: 'Matriz JSON invalida.' });
    try {
        const exito = await database.importarMatriz(matriz);
        return exito
            ? res.json({ success: true })
            : res.status(400).json({ error: 'No se encontraron registros validos para importar.' });
    } catch (error) {
        return res.status(500).json({ error: 'Error interno BD' });
    }
});

app.get('/api/intel/:id', autenticar, async (req, res) => {
    const userId = String(req.params.id || '').trim();
    if (!userId) return res.status(400).json({ error: 'ID requerido.' });

    try {
        const resultado = await intelExterna.consultarPerfilExternoCompleto(userId, true);
        await database.guardarIntelExternaUsuario(userId, null, resultado);

        if (resultado.vpsSquads?.detectado && Array.isArray(resultado.vpsSquads.registros)) {
            for (const reg of resultado.vpsSquads.registros) {
                if (reg.servidorExtraidoId && reg.servidorExtraidoNombre) {
                    const existeSrv = (estadoRadarRed.servidores || []).some(s => s.id === reg.servidorExtraidoId);
                    if (!existeSrv && Array.isArray(estadoRadarRed.servidores)) {
                        estadoRadarRed.servidores.push({
                            id: reg.servidorExtraidoId,
                            name: reg.servidorExtraidoNombre,
                            nombreOriginal: reg.servidorExtraidoNombre,
                            icon: null,
                            memberCount: 0,
                            mensajesSesion: 1,
                            ultimaActividad: Date.now(),
                            exploradores: ['Inteligencia Externa VPS-5604'],
                            estadoCeniza: null
                        });
                    }
                    if (!etiquetasServidores.has(reg.servidorExtraidoId)) {
                        etiquetasServidores.set(reg.servidorExtraidoId, {
                            texto: 'DETECTADO VPS',
                            tipo: 'PROVEEDOR'
                        });
                    }
                }
            }
        }

        return res.json(resultado);
    } catch (error) {
        return res.status(500).json({ error: 'Fallo al consultar las APIs externas.' });
    }
});

app.get('/api/arsenal', autenticar, (req, res) => {
    const { obtenerArsenalDinamico } = intelExterna;
    const data = obtenerArsenalDinamico();
    return res.json({
        comandosSquad: data.comandosSquad,
        palabrasRaid: data.palabrasRaid
    });
});

app.post('/api/arsenal/regla', autenticar, (req, res) => {
    const { tipo, valor, descripcion } = req.body || {};
    const ok = intelExterna.agregarReglaDinamica(tipo, valor, descripcion);
    if (!ok) return res.status(400).json({ error: 'Datos de regla invalidos.' });
    return res.json({ success: true, arsenal: intelExterna.obtenerArsenalDinamico() });
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
    registrarCallbackNuevoToken,
    registrarInvitacionViva,
    restaurarCacheInvitaciones,
    exportarCacheInvitaciones,
    restaurarEtiquetasServidores,
    exportarEtiquetasServidores,
    restaurarWatchlist,
    exportarWatchlist,
    esObjetivoWatchlist
};
