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
const intelExterna = require('./modulos/modulo_intel_externa.js');

// 3. CONSTANTES DE CONFIGURACIÓN Y RENDIMIENTO
const MAX_CANALES_EN_CACHE = 1000;
const MAX_MENSAJES_POR_CANAL = 5;
const MAX_USUARIOS_RADAR_RAM = 2500;
const MAX_INTERACCIONES_RAM = 3000;
const MAX_EVENTOS_DVR = 250;
const VENTANA_RESPUESTA_MS = 30000;
const VENTANA_COLISION_SIMULTANEA_MS = 15000; // Si 2 cuentas hablan con <15s de diferencia, son 2 personas distintas
const VENTANA_RAFAGA_EVERYONE_MS = 90000;
const UMBRAL_CENIZA_EVERYONE = 15;
const COOLDOWN_USUARIO_MS = 10000;
const TTL_FIRMA_MENSAJE_MS = 120000;
const TTL_DEDUP_MENSAJE_MS = 30000;
const DELAY_DESPLIEGUE_MS = 45000;
const INTERVALO_PURGA_MEMORIA_MS = 60000;
const INTERVALO_PERSISTENCIA_RED_MS = 60000;

const REGEX_NOMBRE_SERVIDOR_RAIDEADO = /\b(raid(?:ed)?\s*by|nuked\s*by|pwned\s*by|fucked\s*by|hacked\s*by|domados\s*por|owned\s*by|destroyed\s*by|raideado\s*por)\b/i;
const REGEX_ROL_ESPECIAL = /\b(owner|founder|fundador|creador|admin|administrador|staff|mod|moderator|moderador|helper|support|raid|raider|squad|gang|vip|premium|buyer|customer|dev|developer|booster|lider|leader|boss|jefe)\b/i;

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
const tokensYaDesplegados = new Set();
const cacheHistorialCanales = new Map();
const memoriaCooldown = new Map();
const hashMensajesRecientes = new Map();
const mensajesProcesadosGlobal = new Map();

// ESTRUCTURAS DE TOPOLOGÍA, LINAJE DE BOTS RAID Y GRABADORA DVR
const radarServidores = new Map();
const radarUsuarios = new Map();
const radarInteracciones = new Map();
const radarLinajeBots = new Map(); // Map<botFirmaNorm, { nombreBase, idsVistos: Array, servidoresAtacados: Array, ultimoAtaqueTs }>
const rafagasEveryoneServidor = new Map();
const eventosRecientesPulso = [];
const bitacoraDvr = [];

let contadorUnidades = 0;

function normalizarFirmaBot(botTag) {
    return String(botTag || 'bot')
        .replace(/#\d{4}$/, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '')
        .slice(0, 18) || 'botraid';
}

/**
 * Extrae el rango/permiso especial de un usuario dentro del servidor actual
 * analizando primero los bits matemáticos de permisos y luego los nombres de rol.
 */
function extraerRangoEnServidor(message) {
    if (!message || !message.member) return null;
    try {
        const member = message.member;
        let nivelPermiso = null;

        // 1. Verificar bitfield de permisos de Discord (100% fiable aunque cambien el nombre del rol)
        const perms = member.permissions;
        if (perms && typeof perms.has === 'function') {
            if (perms.has('ADMINISTRATOR')) {
                nivelPermiso = 'ADMIN (Permiso Total)';
            } else if (perms.has('MANAGE_GUILD') || perms.has('BAN_MEMBERS') || perms.has('MANAGE_ROLES')) {
                nivelPermiso = 'STAFF / GESTOR';
            } else if (perms.has('MANAGE_CHANNELS') || perms.has('MANAGE_WEBHOOKS') || perms.has('MANAGE_MESSAGES')) {
                nivelPermiso = 'MOD / OPERADOR';
            }
        }

        // 2. Extraer nombres de roles relevantes
        const rolesDestacados = [];
        if (member.roles && member.roles.cache) {
            for (const [, role] of member.roles.cache.entries()) {
                if (!role || role.name === '@everyone') continue;
                if (REGEX_ROL_ESPECIAL.test(role.name)) {
                    rolesDestacados.push(role.name.slice(0, 24));
                }
            }
        }

        if (!nivelPermiso && rolesDestacados.length === 0) return null;
        const rolStr = rolesDestacados.slice(0, 2).join(', ');
        if (nivelPermiso && rolStr) return `${nivelPermiso} [${rolStr}]`;
        return nivelPermiso || `ROL: ${rolStr}`;
    } catch (_) {
        return null;
    }
}

/**
 * Actualiza el perfil estilométrico (patrón de habla) de un usuario en memoria RAM
 * para detectar cuentas espejo (Alts) por su forma de escribir y no solo por su zona horaria.
 */
function actualizarEstilometriaHabla(nodoUsuario, textoMensaje) {
    if (typeof textoMensaje !== 'string') return;
    const texto = textoMensaje.trim();
    if (texto.length < 2) return;

    if (!nodoUsuario.estilometria) {
        nodoUsuario.estilometria = {
            muestras: 0,
            sumaLongitud: 0,
            iniciaMayuscula: 0,
            usaPuntoFinal: 0,
            usaComas: 0,
            usaSignos: 0,
            usaAlargamiento: 0,
            usaEmojis: 0,
            vocabulario: {}
        };
    }

    const st = nodoUsuario.estilometria;
    st.muestras += 1;
    st.sumaLongitud += Math.min(300, texto.length);

    if (/^[A-ZÁÉÍÓÚÑ]/.test(texto)) st.iniciaMayuscula += 1;
    if (/\.$/.test(texto)) st.usaPuntoFinal += 1;
    if (texto.includes(',')) st.usaComas += 1;
    if (/[!?¿¡]/.test(texto)) st.usaSignos += 1;
    if (/([a-záéíóú])\1{2,}/i.test(texto)) st.usaAlargamiento += 1;
    if (/[\u{1F300}-\u{1F9FF}]|<a?:[a-zA-Z0-9_]+:\d+>/u.test(texto)) st.usaEmojis += 1;

    // Capturar muletillas cortas y jerga (palabras de 3 a 10 letras)
    const palabras = texto
        .toLowerCase()
        .replace(/https?:\/\/[^\s]+/g, '')
        .match(/\b[a-záéíóúñ]{3,10}\b/g);

    if (palabras) {
        for (const w of palabras.slice(0, 12)) {
            st.vocabulario[w] = (st.vocabulario[w] || 0) + 1;
        }
        // Mantener solo las 25 palabras más frecuentes por usuario para no gastar RAM
        const keys = Object.keys(st.vocabulario);
        if (keys.length > 35) {
            const topEntries = Object.entries(st.vocabulario)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 25);
            st.vocabulario = Object.fromEntries(topEntries);
        }
    }
}

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

        if (REGEX_NOMBRE_SERVIDOR_RAIDEADO.test(nombreActual)) {
            if (!existente.estadoCeniza) {
                existente.estadoCeniza = {
                    raideado: true,
                    motivo: `Servidor renombrado a "${nombreActual}"`,
                    nombreAnterior: existente.nombreOriginal || nombreActual,
                    fecha: new Date().toISOString(),
                    atacanteTag: 'Detectado por nombre de servidor',
                    linkRaid: null,
                    mencionesEveryone: 0,
                    servidoresPreviosBot: []
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
 * Evalúa si un servidor está sufriendo un Raid Real (@everyone masivo + links)
 * y rastrea el linaje del bot atacante aunque haya cambiado de cuenta.
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
    const attackerTag = message.author?.tag || message.author?.username || 'Bot/Raider';
    const attackerId = message.author?.id || '0';

    const matchesPing = contenido.match(/@(everyone|here)/g);
    const pesoPings = matchesPing ? Math.max(1, matchesPing.length) : 1;

    let rafaga = rafagasEveryoneServidor.get(guildId);
    if (!rafaga || (ahora - rafaga.firstTs) > VENTANA_RAFAGA_EVERYONE_MS) {
        rafaga = {
            count: 0,
            firstTs: ahora,
            lastAttackerTag: attackerTag,
            lastAttackerId: attackerId,
            inviteLink: null
        };
    }

    rafaga.count += pesoPings;
    rafaga.lastAttackerTag = attackerTag;
    rafaga.lastAttackerId = attackerId;

    const invs = moduloLinks.extraerInvitacionesValidas(contenido);
    if (invs.length > 0) {
        rafaga.inviteLink = invs[0].url;
    }

    rafagasEveryoneServidor.set(guildId, rafaga);

    if (rafaga.count >= UMBRAL_CENIZA_EVERYONE) {
        const yaEstabaEnCeniza = Boolean(nodoServidor.estadoCeniza?.raideado);

        // Rastrear linaje del Bot de Raid por su nombre base (aunque cambie de cuenta/token)
        const firmaBot = normalizarFirmaBot(attackerTag);
        let linaje = radarLinajeBots.get(firmaBot);
        if (!linaje) {
            linaje = {
                nombreBase: attackerTag,
                idsVistos: [],
                servidoresAtacados: [],
                ultimoAtaqueTs: ahora
            };
        }
        if (!linaje.idsVistos.includes(attackerId)) linaje.idsVistos.push(attackerId);
        const nombreSrvOriginal = nodoServidor.nombreOriginal || nodoServidor.name;
        if (!linaje.servidoresAtacados.includes(nombreSrvOriginal)) {
            linaje.servidoresAtacados.push(nombreSrvOriginal);
        }
        linaje.ultimoAtaqueTs = ahora;
        radarLinajeBots.set(firmaBot, linaje);

        nodoServidor.estadoCeniza = {
            raideado: true,
            motivo: `Bombardeo masivo de @everyone (${rafaga.count} pings acumulados)`,
            nombreAnterior: nombreSrvOriginal,
            fecha: nodoServidor.estadoCeniza?.fecha || new Date(ahora).toISOString(),
            atacanteTag: `${attackerTag} (${linaje.idsVistos.length} cuenta(s) asociadas)`,
            atacanteId: attackerId,
            linkRaid: rafaga.inviteLink || nodoServidor.estadoCeniza?.linkRaid || null,
            mencionesEveryone: rafaga.count,
            servidoresPreviosBot: linaje.servidoresAtacados.filter(s => s !== nombreSrvOriginal)
        };

        if (!yaEstabaEnCeniza) {
            console.warn(`[ALERTA CENIZA] Servidor "${nodoServidor.name}" RAIDEADO (${rafaga.count} pings @everyone por ${attackerTag}).`);
            registrarEventoDvr({
                tipo: 'RAID_CENIZA',
                userId: attackerId,
                userTag: attackerTag,
                fromGuildId: guildId,
                fromGuildName: nombreSrvOriginal,
                toGuildId: guildId,
                toGuildName: nodoServidor.name,
                detalle: `Servidor reducido a cenizas por ${attackerTag} (${rafaga.count} pings @everyone)`
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

    const userId = message.author.id;
    const userTag = message.author.tag || message.author.username || 'Usuario';
    const avatarUrl = typeof message.author.displayAvatarURL === 'function'
        ? message.author.displayAvatarURL({ format: 'png', size: 64 })
        : null;
    const infoSnowflake = moduloOsint.analizarAntiguedadSnowflake(userId);
    const rangoDetectado = extraerRangoEnServidor(message);

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
            ultimosTimestamps: [],
            estilometria: null,
            servidores: {},
            ultimoServidorId: guildId,
            ultimoServidorNombre: guildName
        };
    }

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
            detalle: `${userTag} saltó de "${ultimoServerNamePrevio}" a "${guildName}"`
        });
    } else if (typeof servidorWeb.esObjetivoWatchlist === 'function' && servidorWeb.esObjetivoWatchlist(userId)) {
        registrarEventoDvr({
            tipo: 'MOVIMIENTO_VIP',
            userId,
            userTag,
            fromGuildId: guildId,
            fromGuildName: guildName,
            toGuildId: guildId,
            toGuildName: guildName,
            detalle: `[VIP] ${userTag} escribió en "${guildName}"`
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

    // Guardar muestra de los últimos 25 timestamps exactos para evaluar Exclusión Mutua / Alternancia
    if (!Array.isArray(nodoUsuario.ultimosTimestamps)) {
        nodoUsuario.ultimosTimestamps = [];
    }
    nodoUsuario.ultimosTimestamps.push(ahora);
    if (nodoUsuario.ultimosTimestamps.length > 25) {
        nodoUsuario.ultimosTimestamps.shift();
    }

    // Actualizar perfil estilométrico de habla
    actualizarEstilometriaHabla(nodoUsuario, message.content || '');

    const horaUtc = new Date(ahora).getUTCHours();
    if (!nodoUsuario.horasActivas.includes(horaUtc)) {
        nodoUsuario.horasActivas.push(horaUtc);
    }

    if (!nodoUsuario.servidores[guildId]) {
        nodoUsuario.servidores[guildId] = {
            name: guildName,
            count: 0,
            lastSeen: ahora,
            rango: rangoDetectado || null
        };
    }
    nodoUsuario.servidores[guildId].name = guildName;
    nodoUsuario.servidores[guildId].count += 1;
    nodoUsuario.servidores[guildId].lastSeen = ahora;
    if (rangoDetectado) {
        nodoUsuario.servidores[guildId].rango = rangoDetectado;
    }

    radarUsuarios.set(userId, nodoUsuario);

    // Correlación Temporal en Canal (< 30s) y Detector de Colisión Simultánea (< 15s)
    if (Array.isArray(contextoLocal) && contextoLocal.length >= 2) {
        const msgAnterior = contextoLocal[contextoLocal.length - 2];
        const gapMs = ahora - (msgAnterior?.createdTimestamp || 0);
        if (
            msgAnterior &&
            msgAnterior.authorId &&
            msgAnterior.authorId !== userId &&
            gapMs <= VENTANA_RESPUESTA_MS
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
                if (gapMs <= VENTANA_COLISION_SIMULTANEA_MS) {
                    interaccion.simultaneousCollisions = (interaccion.simultaneousCollisions || 0) + 1;
                }
            } else {
                if (radarInteracciones.size >= MAX_INTERACCIONES_RAM) {
                    const relAntigua = radarInteracciones.keys().next().value;
                    radarInteracciones.delete(relAntigua);
                }
                interaccion = {
                    u1,
                    u2,
                    guildId,
                    weight: 1,
                    lastTs: ahora,
                    simultaneousCollisions: gapMs <= VENTANA_COLISION_SIMULTANEA_MS ? 1 : 0
                };
            }
            radarInteracciones.set(pairKey, interaccion);
        }
    }

    eventosRecientesPulso.push({
        userId,
        userTag,
        guildId,
        guildName,
        fromGuildId: ultimoServerIdPrevio && ultimoServerIdPrevio !== guildId ? ultimoServerIdPrevio : null,
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
    for (let i = 1; i <= 40; i++) {
        const rawToken = process.env[`TOKEN_EXPLORADOR_${i}`];
        if (rawToken && rawToken.trim().length > 0) {
            listaTokens.push({ token: rawToken.trim(), sector: `ENV_#${i}` });
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

    if (message.author.bot) {
        if (message.guild && (message.mentionEveryone || String(message.content || '').includes('@everyone'))) {
            const srv = radarServidores.get(message.guild.id);
            if (srv) {
                evaluarBombardeoCeniza(message, srv);
                sincronizarTelemetriaWeb();
            }
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

    moduloOsint.ejecutar(message, contextoLocal).catch(err => {
        console.error('[ERROR OSINT PARALELO]:', err.message);
    });

    if (tieneBloqueoActivo(memoriaCooldown, message.author.id, ahora)) return;
    const firmaMensaje = `${message.author.id}:${message.content}`;
    if (tieneBloqueoActivo(hashMensajesRecientes, firmaMensaje, ahora)) return;

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

function crearUnidadExploradora(indiceUnidad, sectorAsignado = 'General') {
    const explorador = new Client({
        checkUpdate: false,
        presence: { status: 'invisible' }
    });

    explorador.on('ready', () => {
        console.log(`[PANÓPTICO-${indiceUnidad}] Infiltración activa: ${explorador.user.tag} (Sector: ${sectorAsignado})`);
        exploradoresActivos.set(explorador.user.id, {
            tag: explorador.user.tag,
            id: explorador.user.id,
            sector: sectorAsignado,
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
                    mencionesEveryone: srv.estadoCeniza?.mencionesEveryone || 0,
                    servidoresPreviosBot: srv.estadoCeniza?.servidoresPreviosBot || []
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

async function desplegarUnidadEnCaliente(rawToken, sector = 'General') {
    const cleanToken = String(rawToken || '').replace(/^(Bot|Bearer)\s+/i, '').trim();
    if (!cleanToken || tokensYaDesplegados.has(cleanToken)) {
        return { exito: false, motivo: 'El token ya está desplegado o es inválido.' };
    }

    tokensYaDesplegados.add(cleanToken);
    const numUnidad = ++contadorUnidades;
    const explorador = crearUnidadExploradora(numUnidad, sector);
    clientesInstanciados.add(explorador);

    try {
        await explorador.login(cleanToken);
        return {
            exito: true,
            tag: explorador.user?.tag || `Unidad #${numUnidad}`,
            guilds: explorador.guilds?.cache?.size || 0
        };
    } catch (error) {
        console.error(`[FALLO DE INFILTRACIÓN] Token inválido en la unidad #${numUnidad}: ${error.message}`);
        tokensYaDesplegados.delete(cleanToken);
        clientesInstanciados.delete(explorador);
        try { explorador.destroy(); } catch (_) {}
        return { exito: false, motivo: 'Token rechazado por Discord (inválido o revocado).' };
    }
}

async function iniciarEnjambre() {
    if (typeof servidorWeb.iniciar === 'function') {
        servidorWeb.iniciar();
    }
    if (typeof servidorWeb.registrarCallbackNuevoToken === 'function') {
        servidorWeb.registrarCallbackNuevoToken(desplegarUnidadEnCaliente);
    }

    await database.conectarBaseDatos();
    await restaurarMemoriaTopologica();

    const tokensEnv = obtenerTokensEntorno();
    const tokensBd = await database.cargarTokensDinamicos();
    const listaUnificada = [...tokensEnv, ...tokensBd];

    if (listaUnificada.length === 0) {
        console.warn('[AVISO] No hay tokens en variables de entorno. Puedes añadirlos desde el Panel Web en Telemetría.');
        return;
    }

    console.log(`[ENJAMBRE] Desplegando ${listaUnificada.length} unidades de reconocimiento (Modo Stealth)...`);

    for (let i = 0; i < listaUnificada.length; i++) {
        const { token, sector } = listaUnificada[i];
        const res = await desplegarUnidadEnCaliente(token, sector || `Explorador #${i + 1}`);
        if (res.exito && i < listaUnificada.length - 1) {
            await delay(DELAY_DESPLIEGUE_MS);
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
