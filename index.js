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
const VENTANA_RESPUESTA_MS = 30000;          // 30 segundos para correlación de diálogo
const COOLDOWN_USUARIO_MS = 10000;           // 10 segundos
const TTL_FIRMA_MENSAJE_MS = 120000;         // 2 minutos
const TTL_DEDUP_MENSAJE_MS = 30000;          // 30 segundos para evitar eco entre bots
const DELAY_DESPLIEGUE_MS = 45000;           // 45 segundos entre logins
const INTERVALO_PURGA_MEMORIA_MS = 60000;    // 1 minuto
const INTERVALO_PERSISTENCIA_RED_MS = 60000; // 1 minuto para guardar memoria en MongoDB

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

// ESTRUCTURAS DE TOPOLOGÍA EN VIVO (NODOS ROJOS = SERVIDORES, NODOS VERDES = USUARIOS)
const radarServidores = new Map();     // Map<guildId, { id, name, icon, memberCount, mensajesSesion, ultimaActividad, exploradores: Array }>
const radarUsuarios = new Map();       // Map<userId, { id, tag, avatar, totalMensajes, ultimaActividad, horasActivas: Array, servidores: Object }>
const radarInteracciones = new Map();  // Map<pairKey, { u1, u2, guildId, weight, lastTs }>
const eventosRecientesPulso = [];      // Últimos 40 impulsos en tiempo real para animar el lienzo web

/**
 * Hidrata la memoria RAM desde el último snapshot guardado en MongoDB al arrancar.
 */
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
    console.log(`[MEMORIA RADAR] Restaurados ${radarServidores.size} servidores y ${radarUsuarios.size} usuarios desde MongoDB.`);
    sincronizarTelemetriaWeb();
}

/**
 * Escanea todos los servidores donde está presente un explorador al conectarse.
 */
function registrarServidoresDeExplorador(explorador) {
    if (!explorador || !explorador.guilds || !explorador.guilds.cache) return;
    const tagExplorador = explorador.user?.tag || 'Unidad';

    for (const [guildId, guild] of explorador.guilds.cache.entries()) {
        const existente = radarServidores.get(guildId) || {
            id: guildId,
            name: guild.name || 'Servidor Desconocido',
            icon: typeof guild.iconURL === 'function' ? guild.iconURL({ format: 'png', size: 64 }) : null,
            memberCount: guild.memberCount || 0,
            mensajesSesion: 0,
            ultimaActividad: 0,
            exploradores: []
        };

        existente.name = guild.name || existente.name;
        existente.memberCount = guild.memberCount || existente.memberCount;
        if (!existente.exploradores.includes(tagExplorador)) {
            existente.exploradores.push(tagExplorador);
        }
        radarServidores.set(guildId, existente);
    }
}

/**
 * Registra en tiempo real la actividad de cualquier usuario y servidor en el radar.
 */
function registrarActividadRadar(message, contextoLocal) {
    const ahora = Date.now();
    const guildId = message.guild?.id || 'DM_SECTOR';
    const guildName = message.guild?.name || 'Sector Privado (DM)';
    const guildIcon = (message.guild && typeof message.guild.iconURL === 'function')
        ? message.guild.iconURL({ format: 'png', size: 64 })
        : null;

    // 1. Actualizar Nodo Rojo (Servidor)
    let nodoServidor = radarServidores.get(guildId);
    if (!nodoServidor) {
        nodoServidor = {
            id: guildId,
            name: guildName,
            icon: guildIcon,
            memberCount: message.guild?.memberCount || 1,
            mensajesSesion: 0,
            ultimaActividad: ahora,
            exploradores: []
        };
    }
    nodoServidor.name = guildName;
    nodoServidor.mensajesSesion = (nodoServidor.mensajesSesion || 0) + 1;
    nodoServidor.ultimaActividad = ahora;
    radarServidores.set(guildId, nodoServidor);

    // 2. Actualizar Nodo Verde (Usuario) con política LRU para proteger la RAM
    const userId = message.author.id;
    const userTag = message.author.tag || message.author.username || 'Usuario';
    const avatarUrl = typeof message.author.displayAvatarURL === 'function'
        ? message.author.displayAvatarURL({ format: 'png', size: 64 })
        : null;

    let nodoUsuario = radarUsuarios.get(userId);
    if (nodoUsuario) {
        radarUsuarios.delete(userId); // Refrescar posición LRU
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
            horasActivas: [],
            servidores: {}
        };
    }

    nodoUsuario.tag = userTag;
    if (avatarUrl) nodoUsuario.avatar = avatarUrl;
    nodoUsuario.totalMensajes += 1;
    nodoUsuario.ultimaActividad = ahora;

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

    // 3. Correlación Temporal en Canal (< 30s entre dos usuarios distintos)
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

    // 4. Registrar pulso en vivo para la animación de partículas en el navegador
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
    return {
        servidores: Array.from(radarServidores.values()),
        usuarios: Array.from(radarUsuarios.values()),
        interacciones: Array.from(radarInteracciones.values()),
        pulsos: [...eventosRecientesPulso]
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

// Guardado periódico en MongoDB cada 60 segundos para no perder la memoria
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
        servidorWeb.actualizarEnjambre(Array.from(exploradoresActivos.values()));
        if (typeof servidorWeb.actualizarRadarRed === 'function') {
            servidorWeb.actualizarRadarRed(obtenerSnapshotActual());
        }
    } catch (error) {
        console.error('[ERROR TELEMETRÍA] No se pudo actualizar el estado en el servidor web:', error.message);
    }
}

async function procesarMensajeEntrante(explorador, message) {
    if (!message || !message.author || !message.channel) return;
    if (message.author.id === explorador.user?.id || message.author.bot || message.system) return;

    const ahora = Date.now();

    // Deduplicación Global de Enjambre
    if (tieneBloqueoActivo(mensajesProcesadosGlobal, message.id, ahora)) return;
    mensajesProcesadosGlobal.set(message.id, ahora + TTL_DEDUP_MENSAJE_MS);

    // Ingesta en Caché de Contexto Local (LRU)
    const contextoLocal = registrarEnCacheContexto(message.channel.id, {
        authorTag: message.author.tag || 'Usuario Desconocido',
        authorId: message.author.id,
        content: message.content || '',
        createdTimestamp: message.createdTimestamp || ahora
    });

    // Registrar SIEMPRE la actividad en el Radar de Red en Vivo (incluso usuarios normales)
    registrarActividadRadar(message, contextoLocal);

    // Comando de consulta !expediente
    if (await moduloExpedientes.ejecutar(message)) return;

    // Respetar inmunidad de Whitelist para los módulos punitivos
    if (whitelistUsuarios.has(message.author.id)) return;

    if (tieneBloqueoActivo(memoriaCooldown, message.author.id, ahora)) return;
    const firmaMensaje = `${message.author.id}:${message.content}`;
    if (tieneBloqueoActivo(hashMensajesRecientes, firmaMensaje, ahora)) return;

    try {
        let interceptadoPor = null;

        if (await moduloSquads.ejecutar(message, contextoLocal)) {
            interceptadoPor = 'SQUADS';
        } else if (await moduloRaids.ejecutar(message, contextoLocal)) {
            interceptadoPor = 'RAIDS';
        } else if (await moduloLinks.ejecutar(message)) {
            interceptadoPor = 'LINKS';
        } else if (await moduloOrg.ejecutar(message, contextoLocal)) {
            interceptadoPor = 'ORG';
        } else if (await moduloOsint.ejecutar(message, contextoLocal)) {
            interceptadoPor = 'OSINT';
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

    await database.conectarBaseDatos();
    await restaurarMemoriaTopologica();
    servidorWeb.iniciar();

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
