'use strict';

const { Client } = require('discord.js-selfbot-v13');
const fs = require('fs');
const path = require('path');

// 1. INFRAESTRUCTURA BASE
const database = require('./database.js');
const servidorWeb = require('./web/servidor.js');

// 2. MÓDULOS DE INTELIGENCIA
const moduloSquads = require('./modulos/modulo_squads.js');
const moduloRaids = require('./modulos/modulo_raids.js');
const moduloLinks = require('./modulos/modulo_links.js');
const moduloOrg = require('./modulos/modulo_org.js');
const moduloOsint = require('./modulos/modulo_osint.js');
const moduloExpedientes = require('./modulos/modulo_expedientes.js');

// 3. CONSTANTES DE CONFIGURACIÓN Y RENDIMIENTO
const MAX_CANALES_EN_CACHE = 1000;
const MAX_MENSAJES_POR_CANAL = 5;
const MAX_USUARIOS_RADAR_RAM = 2500;
const MAX_INTERACCIONES_RAM = 3000;
const MAX_EVENTOS_DVR = 250;
const VENTANA_RESPUESTA_MS = 30000;
const VENTANA_RAFAGA_EVERYONE_MS = 90000; // 90 segundos para medir bombardeo @everyone de un raid real
const UMBRAL_CENIZA_EVERYONE = 15;        // A partir de 15 menciones @everyone en ráfaga (escala hasta 100+) marca Servidor Ceniza
const COOLDOWN_USUARIO_MS = 10000;
const TTL_FIRMA_MENSAJE_MS = 120000;
const TTL_DEDUP_MENSAJE_MS = 30000;
const DELAY_DESPLIEGUE_MS = 45000;
const INTERVALO_PURGA_MEMORIA_MS = 60000;
const INTERVALO_PERSISTENCIA_RED_MS = 60000;

// Patrones de nombres que ponen los raiders al destruir/renombrar un servidor
const REGEX_NOMBRE_SERVIDOR_RAIDEADO = /\b(raid(?:ed)?\s*by|nuked\s*by|pwned\s*by|fucked\s*by|hacked\s*by|domados\s*por|owned\s*by|destroyed\s*by|raideado\s*por)\b/i;

function cargarWhitelist() {
    const whitelistPath = path.join(__dirname, 'whitelist_usuarios.json');
    try {
        const rawData = fs.readFileSync(whitelistPath, 'utf8');
        const parsed = JSON.parse(rawData);
        if (!Array.isArray(parsed)) throw new Error('El formato de whitelist_usuarios.json debe ser un Array.');
        return new Set(parsed.map(id => String(id).trim()));
    } catch (error) {
        console.error(`[ADVERTENCIA] No se pudo cargar whitelist_usuarios.json (${error.message}). Iniciando con lista vacía.`);
        return new Set();
    }
}

const whitelistUsuarios = cargarWhitelist();

// ESTRUCTURAS DE CONTROL EN MEMORIA
const exploradoresActivos = new Map();
const clientesInstanciados = new Set();
const cacheHistorialCanales = new Map();
const memoriaCooldown = new Map();
const hashMensajesRecientes = new Map();
const mensajesProcesadosGlobal = new Map();

// ESTRUCTURAS DE TOPOLOGÍA EN VIVO, SERVIDORES CENIZA Y GRABADORA DVR
const radarServidores = new Map();
const radarUsuarios = new Map();
const radarInteracciones = new Map();
const rafagasEveryoneServidor = new Map(); // Map<guildId, { count, firstTs, lastAttackerTag, lastAttackerId, inviteLink }>
const eventosRecientesPulso = [];
const bitacoraDvr = []; // Grabación tipo cámara de seguridad de saltos entre servidores, raids y objetivos VIP

function registrarEventoDvr(evento) {
    bitacoraDvr.push({
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        ts: Date.now(),
        ...evento
    });
    if (bitacoraDvr.length > MAX_EVENTOS_DVR) {
        bitacoraDvr.shift();
    }
}

async function restaurarMemoriaTopologica() {
    const snapshot = await database.cargarSnapshotRed();
    if (!snapshot) return;

    if (Array.isArray(snapshot.servidores)) {
        for (const srv of snapshot.servidores) {
            if (srv && srv.id) radarServidores.set(srv.id, srv);
        }
    }
    if (Array.isArray(snapshot.usuarios)) {
        for (const usr of snapshot.usuarios) {
            if (usr && usr.id) radarUsuarios.set(usr.id, usr);
        }
    }
    if (Array.isArray(snapshot.interacciones)) {
        for (const rel of snapshot.interacciones) {
            if (rel && rel.u1 && rel.u2) {
                const key = rel.u1 < rel.u2 ? `${rel.u1}:${rel.u2}` : `${rel.u2}:${rel.u1}`;
                radarInteracciones.set(key, rel);
            }
        }
    }
    if (Array.isArray(snapshot.bitacoraDvr)) {
        for (const item of snapshot.bitacoraDvr) {
            if (item) bitacoraDvr.push(item);
        }
    }
    if (Array.isArray(snapshot.invitaciones) && typeof servidorWeb.restaurarCacheInvitaciones === 'function') {
        servidorWeb.restaurarCacheInvitaciones(snapshot.invitaciones);
    }
    if (snapshot.etiquetasServidores && typeof servidorWeb.restaurarEtiquetasServidores === 'function') {
        servidorWeb.restaurarEtiquetasServidores(snapshot.etiquetasServidores);
    }
    if (Array.isArray(snapshot.watchlist) && typeof servidorWeb.restaurarWatchlist === 'function') {
        servidorWeb.restaurarWatchlist(snapshot.watchlist);
    }

    console.log(`[MEMORIA RADAR] Restaurados ${radarServidores.size} servidores, ${radarUsuarios.size} usuarios y ${bitacoraDvr.length} eventos DVR.`);
    sincronizarTelemetriaWeb();
}

function registrarServidoresDeExplorador(explorador) {
    if (!explorador || !explorador.guilds || !explorador.guilds.cache) return;
    const tagExplorador = explorador.user?.tag || 'Unidad';

    for (const [guildId, guild] of explorador.guilds.cache.entries()) {
        const nombreActual = guild.name || 'Servidor Desconocido';
        const existente = radarServidores.get(guildId) || {
            id: guildId,
            name: nombreActual,
            nombreOriginal: nombreActual,
            icon: typeof guild.iconURL === 'function' ? guild.iconURL({ format: 'png', size: 64 }) : null,
            memberCount: guild.memberCount || 0,
            mensajesSesion: 0,
            ultimaActividad: 0,
            exploradores: [],
            estadoCeniza: null
        };

        // Si el servidor ya tiene un nombre típico de haber sido raideado ("Raided by..."), marcar estado Ceniza
        if (REGEX_NOMBRE_SERVIDOR_RAIDEADO.test(nombreActual)) {
            if (!existente.estadoCeniza) {
                existente.estadoCeniza = {
                    raideado: true,
                    motivo: `Servidor renombrado a "${nombreActual}"`,
                    nombreAnterior: existente.nombreOriginal || nombreActual,
                    fecha: new Date().toISOString(),
                    atacanteTag: 'Detectado por nombre de servidor',
                    linkRaid: null,
                    mencionesEveryone: 0
                };
            }
        } else {
            existente.nombreOriginal = nombreActual;
        }

        existente.name = nombreActual;
        existente.memberCount = guild.memberCount || existente.memberCount;
        if (!existente.exploradores.includes(tagExplorador)) {
            existente.exploradores.push(tagExplorador);
        }
        radarServidores.set(guildId, existente);
    }
}

/**
 * Evalúa si un servidor está sufriendo un Raid Real (Bombardeo masivo de @everyone / @here + links),
 * diferenciándolo de los servidores donde simplemente se escriben comandos para pedir bots.
 */
function evaluarBombardeoCeniza(message, nodoServidor) {
    if (!message.guild || !nodoServidor) return;
    const contenido = String(message.content || '');
    const mencionaEveryone = Boolean(message.mentionEveryone) ||
        contenido.includes('@everyone') ||
        contenido.includes('@here');

    if (!mencionaEveryone) return;

    const ahora = Date.now();
    const guildId = message.guild.id;

    // Contar cuántas veces aparece @everyone/@here dentro del propio mensaje (a veces meten 5 o 10 en un solo mensaje)
    const matchesPing = contenido.match(/@(everyone|here)/g);
    const pesoPings = matchesPing ? Math.max(1, matchesPing.length) : 1;

    let rafaga = rafagasEveryoneServidor.get(guildId);
    if (!rafaga || (ahora - rafaga.firstTs) > VENTANA_RAFAGA_EVERYONE_MS) {
        rafaga = {
            count: 0,
            firstTs: ahora,
            lastAttackerTag: message.author?.tag || 'Bot/Raider',
            lastAttackerId: message.author?.id || '0',
            inviteLink: null
        };
    }

    rafaga.count += pesoPings;
    rafaga.lastAttackerTag = message.author?.tag || rafaga.lastAttackerTag;
    rafaga.lastAttackerId = message.author?.id || rafaga.lastAttackerId;

    const invs = moduloLinks.extraerInvitacionesValidas(contenido);
    if (invs.length > 0) {
        rafaga.inviteLink = invs[0].url;
    }

    rafagasEveryoneServidor.set(guildId, rafaga);

    // Si alcanza el umbral de bombardeo masivo, declarar Servidor Ceniza (Raideado)
    if (rafaga.count >= UMBRAL_CENIZA_EVERYONE) {
        const yaEstabaEnCeniza = Boolean(nodoServidor.estadoCeniza?.raideado);
        nodoServidor.estadoCeniza = {
            raideado: true,
            motivo: `Bombardeo masivo de @everyone (${rafaga.count} pings acumulados)`,
            nombreAnterior: nodoServidor.nombreOriginal || nodoServidor.name,
            fecha: nodoServidor.estadoCeniza?.fecha || new Date(ahora).toISOString(),
            atacanteTag: rafaga.lastAttackerTag,
            atacanteId: rafaga.lastAttackerId,
            linkRaid: rafaga.inviteLink || nodoServidor.estadoCeniza?.linkRaid || null,
            mencionesEveryone: rafaga.count
        };

        if (!yaEstabaEnCeniza) {
            console.warn(`[ALERTA CENIZA] Servidor "${nodoServidor.name}" está siendo RAIDEADO (${rafaga.count} menciones @everyone por ${rafaga.lastAttackerTag}).`);
            registrarEventoDvr({
                tipo: 'RAID_CENIZA',
                userId: rafaga.lastAttackerId,
                userTag: rafaga.lastAttackerTag,
                fromGuildId: guildId,
                fromGuildName: nodoServidor.nombreOriginal || nodoServidor.name,
                toGuildId: guildId,
                toGuildName: nodoServidor.name,
                detalle: `Servidor reducido a cenizas (${rafaga.count} pings @everyone) ${rafaga.inviteLink ? `-> ${rafaga.inviteLink}` : ''}`
            });
        }
    }
}

function registrarActividadRadar(message, contextoLocal) {
    const ahora = Date.now();
    const guildId = message.guild?.id || 'DM_SECTOR';
    const guildName = message.guild?.name || 'Sector Privado (DM)';
    const guildIcon = (message.guild && typeof message.guild.iconURL === 'function')
        ? message.guild.iconURL({ format: 'png', size: 64 })
        : null;

    // 1. Actualizar Nodo Rojo (Servidor) y verificar si está siendo reducido a cenizas
    let nodoServidor = radarServidores.get(guildId);
    if (!nodoServidor) {
        nodoServidor = {
            id: guildId,
            name: guildName,
            nombreOriginal: guildName,
            icon: guildIcon,
            memberCount: message.guild?.memberCount || 1,
            mensajesSesion: 0,
            ultimaActividad: ahora,
            exploradores: [],
            estadoCeniza: null
        };
    }
    nodoServidor.name = guildName;
    nodoServidor.mensajesSesion = (nodoServidor.mensajesSesion || 0) + 1;
    nodoServidor.ultimaActividad = ahora;

    evaluarBombardeoCeniza(message, nodoServidor);
    radarServidores.set(guildId, nodoServidor);

    // 2. Actualizar Nodo Verde (Usuario) y detectar Saltos entre Servidores para la Grabadora DVR
    const userId = message.author.id;
    const userTag = message.author.tag || message.author.username || 'Usuario';
    const avatarUrl = typeof message.author.displayAvatarURL === 'function'
        ? message.author.displayAvatarURL({ format: 'png', size: 64 })
        : null;
    const infoSnowflake = moduloOsint.analizarAntiguedadSnowflake(userId);

    let nodoUsuario = radarUsuarios.get(userId);
    const ultimoServerIdPrevio = nodoUsuario?.ultimoServidorId || null;
    const ultimoServerNamePrevio = nodoUsuario?.ultimoServidorNombre || null;

    if (nodoUsuario) {
        radarUsuarios.delete(userId);
    } else {
        if (radarUsuarios.size >= MAX_USUARIOS_RADAR_RAM) {
            const usuarioMasAntiguo = radarUsuarios.keys().next().value;
            radarUsuarios.delete(usuarioMasAntiguo);
        }
        nodoUsuario = {
            id: userId,
            tag: userTag,
            avatar: avatarUrl,
            totalMensajes: 0,
            ultimaActividad: ahora,
            fechaCreacionCuenta: infoSnowflake?.fechaCreacion || null,
            diasAntiguedad: infoSnowflake?.diasAntiguedad ?? null,
            esBurner: Boolean(infoSnowflake?.esBurner),
            horasActivas: [],
            servidores: {},
            ultimoServidorId: guildId,
            ultimoServidorNombre: guildName
        };
    }

    // Si el usuario acaba de saltar de un servidor A a un servidor B distinto, grabarlo en la cámara DVR
    if (
        ultimoServerIdPrevio &&
        ultimoServerIdPrevio !== guildId &&
        ultimoServerIdPrevio !== 'DM_SECTOR' &&
        guildId !== 'DM_SECTOR'
    ) {
        registrarEventoDvr({
            tipo: 'SALTO_SERVER',
            userId,
            userTag,
            fromGuildId: ultimoServerIdPrevio,
            fromGuildName: ultimoServerNamePrevio || 'Servidor Previo',
            toGuildId: guildId,
            toGuildName: guildName,
            detalle: `${userTag} se desplazó de "${ultimoServerNamePrevio}" hacia "${guildName}"`
        });
    } else if (typeof servidorWeb.esObjetivoWatchlist === 'function' && servidorWeb.esObjetivoWatchlist(userId)) {
        // Si es un objetivo VIP en seguimiento, registrar su actividad aunque no haya cambiado de servidor
        registrarEventoDvr({
            tipo: 'MOVIMIENTO_VIP',
            userId,
            userTag,
            fromGuildId: guildId,
            fromGuildName: guildName,
            toGuildId: guildId,
            toGuildName: guildName,
            detalle: `[VIP] ${userTag} activo en "${guildName}"`
        });
    }

    nodoUsuario.tag = userTag;
    if (avatarUrl) nodoUsuario.avatar = avatarUrl;
    nodoUsuario.totalMensajes += 1;
    nodoUsuario.ultimaActividad = ahora;
    nodoUsuario.ultimoServidorId = guildId;
    nodoUsuario.ultimoServidorNombre = guildName;
    if (infoSnowflake) {
        nodoUsuario.fechaCreacionCuenta = infoSnowflake.fechaCreacion;
        nodoUsuario.diasAntiguedad = infoSnowflake.diasAntiguedad;
        nodoUsuario.esBurner = infoSnowflake.esBurner;
    }

    const horaUtc = new Date(ahora).getUTCHours();
    if (!nodoUsuario.horasActivas.includes(horaUtc)) {
        nodoUsuario.horasActivas.push(horaUtc);
    }

    if (!nodoUsuario.servidores[guildId]) {
        nodoUsuario.servidores[guildId] = {
            name: guildName,
            count: 0,
            lastSeen: ahora
        };
    }
    nodoUsuario.servidores[guildId].name = guildName;
    nodoUsuario.servidores[guildId].count += 1;
    nodoUsuario.servidores[guildId].lastSeen = ahora;

    radarUsuarios.set(userId, nodoUsuario);

    // 3. Correlación Temporal en Canal (< 30s)
    if (Array.isArray(contextoLocal) && contextoLocal.length >= 2) {
        const msgAnterior = contextoLocal[contextoLocal.length - 2];
        if (
            msgAnterior &&
            msgAnterior.authorId &&
            msgAnterior.authorId !== userId &&
            (ahora - (msgAnterior.createdTimestamp || 0)) <= VENTANA_RESPUESTA_MS
        ) {
            const u1 = userId < msgAnterior.authorId ? userId : msgAnterior.authorId;
            const u2 = userId < msgAnterior.authorId ? msgAnterior.authorId : userId;
            const pairKey = `${u1}:${u2}`;

            let interaccion = radarInteracciones.get(pairKey);
            if (interaccion) {
                radarInteracciones.delete(pairKey);
                interaccion.weight += 1;
                interaccion.lastTs = ahora;
                interaccion.guildId = guildId;
            } else {
                if (radarInteracciones.size >= MAX_INTERACCIONES_RAM) {
                    const relAntigua = radarInteracciones.keys().next().value;
                    radarInteracciones.delete(relAntigua);
                }
                interaccion = { u1, u2, guildId, weight: 1, lastTs: ahora };
            }
            radarInteracciones.set(pairKey, interaccion);
        }
    }

    eventosRecientesPulso.push({
        userId,
        userTag,
        guildId,
        guildName,
        ts: ahora
    });
    if (eventosRecientesPulso.length > 40) {
        eventosRecientesPulso.shift();
    }

    sincronizarTelemetriaWeb();
}

function obtenerSnapshotActual() {
    const invCache = typeof servidorWeb.exportarCacheInvitaciones === 'function'
        ? servidorWeb.exportarCacheInvitaciones()
        : [];
    const etiquetas = typeof servidorWeb.exportarEtiquetasServidores === 'function'
        ? servidorWeb.exportarEtiquetasServidores()
        : {};
    const watchlist = typeof servidorWeb.exportarWatchlist === 'function'
        ? servidorWeb.exportarWatchlist()
        : [];

    return {
        servidores: Array.from(radarServidores.values()),
        usuarios: Array.from(radarUsuarios.values()),
        interacciones: Array.from(radarInteracciones.values()),
        pulsos: [...eventosRecientesPulso],
        bitacoraDvr: [...bitacoraDvr],
        invitaciones: invCache,
        etiquetasServidores: etiquetas,
        watchlist: watchlist
    };
}

function registrarEnCacheContexto(channelId, mensajeData) {
    let bufferCanal = cacheHistorialCanales.get(channelId);
    if (bufferCanal) {
        cacheHistorialCanales.delete(channelId);
    } else {
        bufferCanal = [];
        if (cacheHistorialCanales.size >= MAX_CANALES_EN_CACHE) {
            const canalMasAntiguo = cacheHistorialCanales.keys().next().value;
            cacheHistorialCanales.delete(canalMasAntiguo);
        }
    }
    bufferCanal.push(mensajeData);
    if (bufferCanal.length > MAX_MENSAJES_POR_CANAL) {
        bufferCanal.shift();
    }
    cacheHistorialCanales.set(channelId, bufferCanal);
    return [...bufferCanal];
}

function tieneBloqueoActivo(mapa, clave, ahora) {
    const expiraEn = mapa.get(clave);
    if (!expiraEn) return false;
    if (ahora < expiraEn) return true;
    mapa.delete(clave);
    return false;
}

const timerLimpieza = setInterval(() => {
    const ahora = Date.now();
    for (const [key, exp] of mensajesProcesadosGlobal.entries()) {
        if (ahora >= exp) mensajesProcesadosGlobal.delete(key);
    }
    for (const [key, exp] of memoriaCooldown.entries()) {
        if (ahora >= exp) memoriaCooldown.delete(key);
    }
    for (const [key, exp] of hashMensajesRecientes.entries()) {
        if (ahora >= exp) hashMensajesRecientes.delete(key);
    }
}, INTERVALO_PURGA_MEMORIA_MS);

if (timerLimpieza.unref) timerLimpieza.unref();

const timerPersistenciaRed = setInterval(async () => {
    if (radarUsuarios.size > 0 || radarServidores.size > 0) {
        await database.guardarSnapshotRed(obtenerSnapshotActual());
    }
}, INTERVALO_PERSISTENCIA_RED_MS);

if (timerPersistenciaRed.unref) timerPersistenciaRed.unref();

function obtenerTokensEntorno() {
    const listaTokens = [];
    for (let i = 1; i <= 10; i++) {
        const rawToken = process.env[`TOKEN_EXPLORADOR_${i}`];
        if (rawToken && rawToken.trim().length > 0) {
            listaTokens.push({ indice: i, token: rawToken.trim() });
        }
    }
    return listaTokens;
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function sincronizarTelemetriaWeb() {
    try {
        if (typeof servidorWeb.actualizarEnjambre === 'function') {
            servidorWeb.actualizarEnjambre(Array.from(exploradoresActivos.values()));
        }
        if (typeof servidorWeb.actualizarRadarRed === 'function') {
            servidorWeb.actualizarRadarRed(obtenerSnapshotActual());
        }
    } catch (error) {
        console.error('[ERROR TELEMETRÍA] No se pudo actualizar el estado en el servidor web:', error.message);
    }
}

async function procesarMensajeEntrante(explorador, message) {
    if (!message || !message.author || !message.channel) return;
    if (message.author.id === explorador.user?.id || message.system) return;

    const ahora = Date.now();

    if (tieneBloqueoActivo(mensajesProcesadosGlobal, message.id, ahora)) return;
    mensajesProcesadosGlobal.set(message.id, ahora + TTL_DEDUP_MENSAJE_MS);

    // Si es un bot que está lanzando un ataque @everyone masivo en el servidor, evaluar el bombardeo antes de ignorar bots
    if (message.author.bot) {
        if (message.guild && (message.mentionEveryone || String(message.content || '').includes('@everyone'))) {
            const srv = radarServidores.get(message.guild.id);
            if (srv) evaluarBombardeoCeniza(message, srv);
        }
        return;
    }

    const contextoLocal = registrarEnCacheContexto(message.channel.id, {
        authorTag: message.author.tag || 'Usuario Desconocido',
        authorId: message.author.id,
        content: message.content || '',
        createdTimestamp: message.createdTimestamp || ahora
    });

    registrarActividadRadar(message, contextoLocal);

    if (await moduloExpedientes.ejecutar(message)) return;
    if (whitelistUsuarios.has(message.author.id)) return;

    // 1. Ejecutar SIEMPRE en paralelo el Motor OSINT 2.0 (sin bloquearlo detrás de else-if)
    moduloOsint.ejecutar(message, contextoLocal).catch(err => {
        console.error('[ERROR OSINT PARALELO]:', err.message);
    });

    if (tieneBloqueoActivo(memoriaCooldown, message.author.id, ahora)) return;
    const firmaMensaje = `${message.author.id}:${message.content}`;
    if (tieneBloqueoActivo(hashMensajesRecientes, firmaMensaje, ahora)) return;

    // 2. Evaluar módulos tácticos de alertas (Squads, Raids, Links, Org)
    try {
        let interceptadoPor = null;

        if (await moduloSquads.ejecutar(message, contextoLocal)) {
            interceptadoPor = 'SQUADS';
            if (message.guild) {
                registrarEventoDvr({
                    tipo: 'COMANDO_SQUAD',
                    userId: message.author.id,
                    userTag: message.author.tag,
                    fromGuildId: message.guild.id,
                    fromGuildName: message.guild.name,
                    toGuildId: message.guild.id,
                    toGuildName: message.guild.name,
                    detalle: `${message.author.tag} ejecutó comando de squad en "${message.guild.name}"`
                });
            }
        } else if (await moduloRaids.ejecutar(message, contextoLocal)) {
            interceptadoPor = 'RAIDS';
        } else if (await moduloLinks.ejecutar(message)) {
            interceptadoPor = 'LINKS';
        } else if (await moduloOrg.ejecutar(message, contextoLocal)) {
            interceptadoPor = 'ORG';
        }

        if (interceptadoPor) {
            const timestampPostEjecucion = Date.now();
            hashMensajesRecientes.set(firmaMensaje, timestampPostEjecucion + TTL_FIRMA_MENSAJE_MS);
            if (interceptadoPor === 'LINKS' || interceptadoPor === 'SQUADS' || interceptadoPor === 'RAIDS') {
                memoriaCooldown.set(message.author.id, timestampPostEjecucion + COOLDOWN_USUARIO_MS);
            }
        }
    } catch (error) {
        console.error(`[ESCUDO DEFENSIVO] Excepción procesando mensaje ${message.id} en canal ${message.channel.id}:`, error.message);
    }
}

function crearUnidadExploradora(indiceUnidad) {
    const explorador = new Client({
        checkUpdate: false,
        presence: { status: 'invisible' }
    });

    explorador.on('ready', () => {
        console.log(`[PANÓPTICO-${indiceUnidad}] Infiltración activa: ${explorador.user.tag}`);
        exploradoresActivos.set(explorador.user.id, {
            tag: explorador.user.tag,
            id: explorador.user.id,
            avatar: explorador.user.displayAvatarURL({ format: 'png', size: 64 }),
            guildsCount: explorador.guilds?.cache?.size || 0
        });
        registrarServidoresDeExplorador(explorador);
        sincronizarTelemetriaWeb();
    });

    explorador.on('guildCreate', () => {
        registrarServidoresDeExplorador(explorador);
        sincronizarTelemetriaWeb();
    });

    // Detector pasivo de cambio de nombre a "Raided by / Nuked by" (Servidor Ceniza)
    explorador.on('guildUpdate', (oldGuild, newGuild) => {
        if (!newGuild || !newGuild.id) return;
        const srv = radarServidores.get(newGuild.id);
        if (!srv) return;

        const nombreViejo = oldGuild?.name || srv.nombreOriginal || srv.name;
        const nombreNuevo = newGuild.name || srv.name;

        if (nombreViejo !== nombreNuevo) {
            if (REGEX_NOMBRE_SERVIDOR_RAIDEADO.test(nombreNuevo)) {
                srv.estadoCeniza = {
                    raideado: true,
                    motivo: `Nombre cambiado de "${nombreViejo}" a "${nombreNuevo}"`,
                    nombreAnterior: srv.nombreOriginal || nombreViejo,
                    fecha: new Date().toISOString(),
                    atacanteTag: srv.estadoCeniza?.atacanteTag || 'Cambio de Nombre Hostil',
                    linkRaid: srv.estadoCeniza?.linkRaid || null,
                    mencionesEveryone: srv.estadoCeniza?.mencionesEveryone || 0
                };
                registrarEventoDvr({
                    tipo: 'RAID_CENIZA',
                    userId: '0',
                    userTag: 'SISTEMA',
                    fromGuildId: newGuild.id,
                    fromGuildName: nombreViejo,
                    toGuildId: newGuild.id,
                    toGuildName: nombreNuevo,
                    detalle: `Servidor "${nombreViejo}" renombrado a "${nombreNuevo}" (Estado Ceniza)`
                });
            } else if (!srv.estadoCeniza?.raideado) {
                srv.nombreOriginal = nombreNuevo;
            }
            srv.name = nombreNuevo;
            radarServidores.set(newGuild.id, srv);
            sincronizarTelemetriaWeb();
        }
    });

    explorador.on('messageCreate', (message) => {
        procesarMensajeEntrante(explorador, message);
    });

    explorador.on('error', (error) => {
        console.error(`[PANÓPTICO-${indiceUnidad}] Error de socket/cliente:`, error.message);
    });

    explorador.on('disconnect', () => {
        console.warn(`[PANÓPTICO-${indiceUnidad}] Unidad desconectada.`);
        if (explorador.user?.id && exploradoresActivos.has(explorador.user.id)) {
            exploradoresActivos.delete(explorador.user.id);
            sincronizarTelemetriaWeb();
        }
    });

    return explorador;
}

async function iniciarEnjambre() {
    const tokensConfigurados = obtenerTokensEntorno();
    if (tokensConfigurados.length === 0) {
        console.error('[ERROR CRÍTICO] Matriz de tokens vacía. Defina al menos TOKEN_EXPLORADOR_1.');
        process.exit(1);
    }

    if (typeof servidorWeb.iniciar === 'function') {
        servidorWeb.iniciar();
    }

    await database.conectarBaseDatos();
    await restaurarMemoriaTopologica();

    console.log(`[ENJAMBRE] Desplegando ${tokensConfigurados.length} unidades de reconocimiento (Modo Stealth)...`);

    for (let i = 0; i < tokensConfigurados.length; i++) {
        const { indice, token } = tokensConfigurados[i];
        const explorador = crearUnidadExploradora(indice);
        clientesInstanciados.add(explorador);

        try {
            await explorador.login(token);
            if (i < tokensConfigurados.length - 1) {
                await delay(DELAY_DESPLIEGUE_MS);
            }
        } catch (error) {
            console.error(`[FALLO DE INFILTRACIÓN] Token inválido o revocado en la unidad #${indice}: ${error.message}`);
            clientesInstanciados.delete(explorador);
            try { explorador.destroy(); } catch (_) {}
        }
    }
}

async function apagarSistema(senal) {
    console.log(`\n[SISTEMA] Señal ${senal} recibida. Guardando memoria de red y cerrando conexiones...`);
    clearInterval(timerLimpieza);
    clearInterval(timerPersistenciaRed);

    try {
        await database.guardarSnapshotRed(obtenerSnapshotActual());
    } catch (_) {}

    for (const cliente of clientesInstanciados) {
        try {
            cliente.destroy();
        } catch (_) {}
    }
    clientesInstanciados.clear();
    exploradoresActivos.clear();

    if (typeof database.cerrarBaseDatos === 'function') {
        await database.cerrarBaseDatos();
    }

    console.log('[SISTEMA] Apagado completado.');
    process.exit(0);
}

process.on('SIGINT', () => apagarSistema('SIGINT'));
process.on('SIGTERM', () => apagarSistema('SIGTERM'));
process.on('unhandledRejection', (reason) => {
    console.error('[ALERTA GLOBAL] Promesa no manejada detectada:', reason);
});

iniciarEnjambre();
