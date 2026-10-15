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

// 3. CONSTANTES DE CONFIGURACIÓN Y RENDIMIENTO
const MAX_CANALES_EN_CACHE = 1000;
const MAX_MENSAJES_POR_CANAL = 5;
const COOLDOWN_USUARIO_MS = 10000;       // 10 segundos
const TTL_FIRMA_MENSAJE_MS = 120000;     // 2 minutos
const TTL_DEDUP_MENSAJE_MS = 30000;      // 30 segundos para evitar eco entre bots
const DELAY_DESPLIEGUE_MS = 45000;       // 45 segundos entre logins
const INTERVALO_PURGA_MEMORIA_MS = 60000; // 1 minuto

// 4. CARGA SEGURA DE WHITELIST (Complejidad O(1) con Set)
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

// 5. ESTRUCTURAS DE CONTROL EN MEMORIA (Sin fugas de timers)
// Mapa de telemetría de bots activos: Map<botId, { tag, id, avatar }>
const exploradoresActivos = new Map();
// Instancias de clientes para cierre limpio: Set<Client>
const clientesInstanciados = new Set();

// Caché LRU de canales: Map<channelId, Array<MensajeContexto>>
// Aprovecha que Map en JS mantiene el orden de inserción para expulsar siempre el más antiguo
const cacheHistorialCanales = new Map();

// Mapas de control de flujo basados en timestamps (Map<key, expirationTimestamp>)
const memoriaCooldown = new Map();
const hashMensajesRecientes = new Map();
const mensajesProcesadosGlobal = new Map(); // Evita que 2 bots en el mismo servidor procesen el mismo mensaje

/**
 * Registra un mensaje en la caché de contexto manteniendo política LRU.
 */
function registrarEnCacheContexto(channelId, mensajeData) {
    let bufferCanal = cacheHistorialCanales.get(channelId);

    if (bufferCanal) {
        // Refrescar posición LRU reinsertando la clave
        cacheHistorialCanales.delete(channelId);
    } else {
        bufferCanal = [];
        // Si alcanzamos el límite máximo, expulsamos el canal más inactivo (el primero del Map)
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
    return [...bufferCanal]; // Retornamos copia inmutable para los módulos
}

/**
 * Verifica si una clave está activa en un Mapa con TTL.
 */
function tieneBloqueoActivo(mapa, clave, ahora) {
    const expiraEn = mapa.get(clave);
    if (!expiraEn) return false;
    if (ahora < expiraEn) return true;
    mapa.delete(clave);
    return false;
}

/**
 * Recolector de basura determinista para limpiar entradas expiradas de los mapas TTL.
 */
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

// Evitar que el intervalo bloquee el cierre del proceso
if (timerLimpieza.unref) timerLimpieza.unref();

// 6. RECOLECCIÓN Y VALIDACIÓN DE TOKENS
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

/**
 * Sincroniza el estado actual del enjambre con el servidor web.
 */
function sincronizarTelemetriaWeb() {
    try {
        servidorWeb.actualizarEnjambre(Array.from(exploradoresActivos.values()));
    } catch (error) {
        console.error('[ERROR TELEMETRÍA] No se pudo actualizar el estado en el servidor web:', error.message);
    }
}

/**
 * Manejador centralizado de mensajes para todas las unidades del enjambre.
 */
async function procesarMensajeEntrante(explorador, message) {
    // 1. Validaciones defensivas y reglas de inmunidad absoluta
    if (!message || !message.author || !message.channel) return;
    if (message.author.id === explorador.user?.id || message.author.bot || message.system) return;
    if (whitelistUsuarios.has(message.author.id)) return;

    const ahora = Date.now();

    // 2. Deduplicación Global de Enjambre:
    // Si otro selfbot ya interceptó este mismo ID de mensaje en el servidor compartido, abortar inmediatamente.
    if (tieneBloqueoActivo(mensajesProcesadosGlobal, message.id, ahora)) return;
    mensajesProcesadosGlobal.set(message.id, ahora + TTL_DEDUP_MENSAJE_MS);

    // 3. Ingesta en Caché de Contexto Local (LRU)
    const contextoLocal = registrarEnCacheContexto(message.channel.id, {
        authorTag: message.author.tag || 'Usuario Desconocido',
        authorId: message.author.id,
        content: message.content || '',
        createdTimestamp: message.createdTimestamp || ahora
    });

    // 4. Verificación de Cooldown y Firma Anti-Spam
    if (tieneBloqueoActivo(memoriaCooldown, message.author.id, ahora)) return;

    const firmaMensaje = `${message.author.id}:${message.content}`;
    if (tieneBloqueoActivo(hashMensajesRecientes, firmaMensaje, ahora)) return;

    // 5. Evaluación de Módulos en Cascada
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

        // Aplicar restricciones anti-inundación cuando un módulo dispara una alerta
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

/**
 * Inicializa un cliente individual con sus listeners de ciclo de vida.
 */
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
            avatar: explorador.user.displayAvatarURL({ format: 'png', size: 64 })
        });

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

/**
 * Orquesta el inicio de la base de datos, el servidor web y el despliegue escalonado de selfbots.
 */
async function iniciarEnjambre() {
    const tokensConfigurados = obtenerTokensEntorno();

    if (tokensConfigurados.length === 0) {
        console.error('[ERROR CRÍTICO] Matriz de tokens vacía. Defina al menos TOKEN_EXPLORADOR_1.');
        process.exit(1);
    }

    await database.conectarBaseDatos();
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

/**
 * Cierre limpio (Graceful Shutdown) ante señales del sistema operativo.
 */
async function apagarSistema(senal) {
    console.log(`\n[SISTEMA] Señal ${senal} recibida. Cerrando conexiones del enjambre y base de datos...`);
    clearInterval(timerLimpieza);

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
