'use strict';

/* ==========================================================================
   MÓDULO DE INTELIGENCIA EXTERNA FEDERADA Y ARSENAL DINÁMICO
   Integra: XN Protect GlobalBan, Ebixcloud VPS (Squads & Keywords),
            LC Guard Sanctions, Ebixcloud IP Whois y Reglas Dinámicas.
   Archivo: modulos/modulo_intel_externa.js
   ========================================================================== */

const axios = require('axios');

const TIMEOUT_API_MS = 4200;
const TTL_CACHE_INTEL_MS = 15 * 60 * 1000; // 15 minutos en caché para evitar saturar las APIs

// Caché en memoria: Map<userId, { expira, data }>
const cacheIntelUsuarios = new Map();

// Reglas dinámicas añadidas en caliente desde el Panel Web
const arsenalDinamico = {
    comandosSquad: [], // Array<{ comando, descripcion, severidad, regex }>
    palabrasRaid: []   // Array<{ idRegla, patron, regex }>
};

function escaparRegExp(str) {
    return String(str || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function agregarReglaDinamica(tipo, valor, descripcion = 'Regla dinámica C4ISR') {
    const limpio = String(valor || '').trim();
    if (!limpio) return false;

    if (tipo === 'COMANDO_SQUAD') {
        const existe = arsenalDinamico.comandosSquad.some(c => c.comando.toLowerCase() === limpio.toLowerCase());
        if (!existe) {
            arsenalDinamico.comandosSquad.push({
                comando: limpio,
                descripcion: String(descripcion).slice(0, 120),
                severidad: 'CRITICO',
                colorHex: 16711680,
                webhookDestino: 'WEBHOOK_Squads',
                regex: new RegExp(`^${escaparRegExp(limpio)}(?:\\s+|$)`, 'i')
            });
        }
        return true;
    }

    if (tipo === 'PALABRA_RAID') {
        const existe = arsenalDinamico.palabrasRaid.some(p => p.patron.toLowerCase() === limpio.toLowerCase());
        if (!existe) {
            arsenalDinamico.palabrasRaid.push({
                idRegla: `Dinámica: ${limpio.slice(0, 24)}`,
                patron: limpio,
                colorHex: 16711680,
                webhookDestino: 'WEBHOOK_Raids',
                regex: new RegExp(`\\b${escaparRegExp(limpio)}\\b`, 'i')
            });
        }
        return true;
    }

    return false;
}

function obtenerArsenalDinamico() {
    return {
        comandosSquad: arsenalDinamico.comandosSquad.map(c => ({
            comando: c.comando,
            descripcion: c.descripcion
        })),
        palabrasRaid: arsenalDinamico.palabrasRaid.map(p => ({
            idRegla: p.idRegla,
            patron: p.patron
        })),
        rawComandos: arsenalDinamico.comandosSquad,
        rawPalabras: arsenalDinamico.palabrasRaid
    };
}

function restaurarArsenalDinamico(data) {
    if (!data || typeof data !== 'object') return;
    if (Array.isArray(data.comandosSquad)) {
        for (const c of data.comandosSquad) {
            if (c && c.comando) agregarReglaDinamica('COMANDO_SQUAD', c.comando, c.descripcion);
        }
    }
    if (Array.isArray(data.palabrasRaid)) {
        for (const p of data.palabrasRaid) {
            if (p && p.patron) agregarReglaDinamica('PALABRA_RAID', p.patron, p.idRegla);
        }
    }
}

/**
 * 1. Consulta XN Protect GlobalBan API
 */
async function consultarXnProtect(userId) {
    try {
        const url = `https://apis.ebixcloud.com/apis/xnprotect/banglobal?id=${encodeURIComponent(userId)}`;
        const res = await axios.get(url, { timeout: TIMEOUT_API_MS });
        const payload = res.data?.response;
        if (res.data?.success && payload && payload.banglobal === true) {
            return {
                activo: true,
                baneado: true,
                razon: String(payload.reason || 'Baneo Global en XN Protect'),
                pruebaUrl: payload.proof || null,
                desde: payload.dates?.since || null,
                expira: payload.dates?.expires || null
            };
        }
        return { activo: true, baneado: false };
    } catch (_) {
        return { activo: false, baneado: false };
    }
}

/**
 * 2. Consulta VPS Ebixcloud Squad Banned Users (Puerto 5604)
 * Extrae además nombres e IDs de servidores filtrados en el texto de la razón.
 */
async function consultarVpsSquadBans(userId) {
    try {
        const url = `http://vps-7c16b1e2.es.cloud.ebixcloud.com:5604/squad_banned_users/get_by_userid?user_id=${encodeURIComponent(userId)}`;
        const res = await axios.get(url, { timeout: TIMEOUT_API_MS });
        if (res.data?.success && Array.isArray(res.data.records) && res.data.records.length > 0) {
            const registros = res.data.records.map(r => {
                const razonStr = String(r.reason || '');
                // Extraer comando, canal y servidor si siguen el patrón "...comando .X en el canal con identificador Y del servidor Z (ID)"
                const matchCmd = razonStr.match(/comando\s+([^\s]+)\s+en/i);
                const matchSrv = razonStr.match(/del servidor\s+(.+?)\s*\((\d{17,20})\)/i);
                return {
                    actionId: r.action_id || 'N/A',
                    fecha: r.date || '',
                    servicio: r.service_name || 'SquadDB',
                    expira: r.expires_at || '',
                    razon: razonStr,
                    comandoExtraido: matchCmd ? matchCmd[1] : null,
                    servidorExtraidoNombre: matchSrv ? matchSrv[1].trim() : null,
                    servidorExtraidoId: matchSrv ? matchSrv[2] : null
                };
            });
            return { activo: true, detectado: true, registros };
        }
        return { activo: true, detectado: false, registros: [] };
    } catch (_) {
        return { activo: false, detectado: false, registros: [] };
    }
}

/**
 * 3. Consulta VPS Ebixcloud Keywords por UserID (Puerto 5604)
 */
async function consultarVpsKeywords(userId) {
    try {
        const url = `http://vps-7c16b1e2.es.cloud.ebixcloud.com:5604/keywords/get_by_userid?user_id=${encodeURIComponent(userId)}`;
        const res = await axios.get(url, { timeout: TIMEOUT_API_MS });
        const lista = Array.isArray(res.data?.records)
            ? res.data.records
            : (Array.isArray(res.data?.data) ? res.data.data : []);
        if (res.data?.success && lista.length > 0) {
            return { activo: true, detectado: true, registros: lista.slice(0, 15) };
        }
        return { activo: true, detectado: false, registros: [] };
    } catch (_) {
        return { activo: false, detectado: false, registros: [] };
    }
}

/**
 * 4. Consulta LC Guard API (Sanciones)
 */
async function consultarLcGuard(userId) {
    try {
        const url = `https://api.lcgroup.dev/guard/sanctions/get?id=${encodeURIComponent(userId)}&user_id=${encodeURIComponent(userId)}`;
        const res = await axios.get(url, { timeout: TIMEOUT_API_MS });
        const data = res.data;
        if (data && (data.sanctioned === true || data.banned === true || (Array.isArray(data.sanctions) && data.sanctions.length > 0) || (Array.isArray(data.records) && data.records.length > 0))) {
            const lista = data.sanctions || data.records || [data];
            return { activo: true, sancionado: true, detalles: lista.slice(0, 10) };
        }
        return { activo: true, sancionado: false, detalles: [] };
    } catch (_) {
        return { activo: false, sancionado: false, detalles: [] };
    }
}

/**
 * 5. Consulta Whois de IP en Ebixcloud cuando un mensaje contiene una dirección IPv4
 */
async function consultarWhoisIp(ip) {
    if (!ip || typeof ip !== 'string') return null;
    try {
        const url = `https://apis.ebixcloud.com/apis/iptools/whois?ip=${encodeURIComponent(ip.trim())}`;
        const res = await axios.get(url, { timeout: 3500 });
        if (res.data) {
            const info = res.data.response || res.data.data || res.data;
            const pais = info.country || info.country_name || info.pais || 'Desconocido';
            const isp = info.isp || info.org || info.asn || 'ISP Desconocido';
            return `IP ${ip}: ${pais} (${isp})`;
        }
        return null;
    } catch (_) {
        return null;
    }
}

/**
 * Ejecuta todas las consultas de reputación externa en paralelo para un UserID
 * y devuelve tanto el objeto estructurado (para la Web) como un resumen en Markdown (para Webhooks).
 */
async function consultarPerfilExternoCompleto(userId, forzarRefresco = false) {
    const cleanId = String(userId || '').trim();
    const ahora = Date.now();

    if (!forzarRefresco && cacheIntelUsuarios.has(cleanId)) {
        const cached = cacheIntelUsuarios.get(cleanId);
        if (ahora < cached.expira) {
            return cached.data;
        }
    }

    const [xnProtect, vpsSquads, vpsKeywords, lcGuard] = await Promise.all([
        consultarXnProtect(cleanId),
        consultarVpsSquadBans(cleanId),
        consultarVpsKeywords(cleanId),
        consultarLcGuard(cleanId)
    ]);

    const lineasResumen = [];

    if (xnProtect.baneado) {
        lineasResumen.push(`🔴 **XN Protect GlobalBan:** BANEADO — *${xnProtect.razon}*${xnProtect.pruebaUrl ? ` ([Ver Prueba](${xnProtect.pruebaUrl}))` : ''}`);
    } else if (xnProtect.activo) {
        lineasResumen.push(`🟢 **XN Protect GlobalBan:** Sin antecedentes globales`);
    }

    if (vpsSquads.detectado) {
        const primero = vpsSquads.registros[0];
        lineasResumen.push(`🔴 **Base VPS Squads (${vpsSquads.registros.length} reg):** Detectado en servicio \`${primero.servicio}\` — *${primero.razon.slice(0, 180)}*`);
    } else if (vpsSquads.activo) {
        lineasResumen.push(`🟢 **Base VPS Squads:** Sin registros de comandos squad`);
    }

    if (vpsKeywords.detectado) {
        lineasResumen.push(`🟠 **Base VPS Keywords:** ${vpsKeywords.registros.length} coincidencia(s) previa(s)`);
    }

    if (lcGuard.sancionado) {
        lineasResumen.push(`🔴 **LC Guard Sanctions:** SANCIONADO ACTIVO (${lcGuard.detalles.length} registro(s))`);
    }

    if (lineasResumen.length === 0) {
        lineasResumen.push(`⚪ **[Redes Externas sin respuesta temporal o sujeto sin antecedentes]**`);
    }

    const resultado = {
        userId: cleanId,
        consultadoEn: new Date(ahora).toISOString(),
        amenazaConfirmada: Boolean(xnProtect.baneado || vpsSquads.detectado || lcGuard.sancionado),
        xnProtect,
        vpsSquads,
        vpsKeywords,
        lcGuard,
        resumenMarkdown: lineasResumen.join('\n')
    };

    if (cacheIntelUsuarios.size > 1500) {
        cacheIntelUsuarios.clear();
    }
    cacheIntelUsuarios.set(cleanId, { expira: ahora + TTL_CACHE_INTEL_MS, data: resultado });

    return resultado;
}

module.exports = {
    consultarPerfilExternoCompleto,
    consultarWhoisIp,
    agregarReglaDinamica,
    obtenerArsenalDinamico,
    restaurarArsenalDinamico
};
