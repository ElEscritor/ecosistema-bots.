'use strict';

/* ==========================================================================
   MÓDULO DE INTELIGENCIA Y PERFILADO OSINT 2.0 (DIALECTOS + SNOWFLAKE + PII)
   Archivo: modulos/modulo_osint.js
   ========================================================================== */

const crypto = require('crypto');
const database = require('../database.js');

const MAX_COLA_OSINT = 500;
const MAX_REINTENTOS_DB = 5;
const DISCORD_EPOCH_MS = 1420070400000n;

const LISTA_NEGACIONES = [
    'no soy', 'no me llamo', 'no vivo en', 'nunca fui', 'imagina que',
    'broma', 'sarcasmo', 'mentira', 'ni que fuera', 'no tengo', 'ojalá tener', 'ojala tener'
];

// 1. DICCIONARIO DE HUELLA DIALECTAL POR PAÍS (Inferencia pasiva por modismos)
const DICCIONARIO_DIALECTOS = [
    {
        pais: 'México',
        husosEsperados: [0, 1, 2, 3, 4, 5, 19, 20, 21, 22, 23],
        regex: /\b(wey|weyes|nmms|no mames|chido|alv|neta|carnal|morro|morra|feria|chamba|jalar|pedo|pinche|vato|banda|ahorita|simon|nel)\b/gi
    },
    {
        pais: 'España',
        husosEsperados: [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22],
        regex: /\b(chaval|chavales|ostia|hostia|currar|curro|colega|flipar|flipas|mola|mogollon|gilipollas|capullo|pavo|pavos|guay|pillar|tio|tia)\b/gi
    },
    {
        pais: 'Argentina / Uruguay',
        husosEsperados: [0, 1, 2, 3, 15, 16, 17, 18, 19, 20, 21, 22, 23],
        regex: /\b(boludo|boluda|pelotudo|quilombo|laburo|laburar|bondi|pibe|piba|chabon|guita|morfar|re piola|mal ahi|posta|chamuyo|birra)\b/gi
    },
    {
        pais: 'Chile',
        husosEsperados: [0, 1, 2, 3, 16, 17, 18, 19, 20, 21, 22, 23],
        regex: /\b(weon|weona|wn|qlo|culiao|cachai|fome|pololo|polola|cuatico|bacan|altiro|caleta|paco|filete|piola)\b/gi
    },
    {
        pais: 'Colombia',
        husosEsperados: [0, 1, 2, 3, 4, 17, 18, 19, 20, 21, 22, 23],
        regex: /\b(parce|parcero|gonorrea|chimba|bacano|marica|mk|camello|camellar|pola|rumbear|vaina|pelao|berraco)\b/gi
    },
    {
        pais: 'Perú',
        husosEsperados: [0, 1, 2, 3, 4, 17, 18, 19, 20, 21, 22, 23],
        regex: /\b(causa|causita|pata|jato|chibolo|chibola|palta|que palta|asado|bravazo|chevere|chamba|fercho|jerma)\b/gi
    },
    {
        pais: 'Venezuela',
        husosEsperados: [0, 1, 2, 3, 16, 17, 18, 19, 20, 21, 22, 23],
        regex: /\b(chamo|chama|marico|vaina|arrecho|burda|coroto|ladilla|pajuo|beta|fino|pana|mamaguevo|mmg)\b/gi
    }
];

// 2. REGLAS FLEXIBLES DE EXTRACCIÓN PII (Sin exigir mayúsculas ni ortografía perfecta)
const REGLAS_PII_AVANZADAS = [
    {
        etiqueta: 'DEMOGRAFÍA_EDAD',
        regex: /(?:^|\s)(?:tengo|cumplo|cumpli|cumplí|voy a cumplir)\s+(1[1-9]|[2-5][0-9])\s*(?:años|añitos|anos|anitos)?(?=\s|[.,;!?]|$)/gi
    },
    {
        etiqueta: 'DEMOGRAFÍA_NACIMIENTO',
        regex: /(?:^|\s)(?:soy del|naci en el|nací en el|naci en|nací en)\s+(200[0-9]|201[0-4]|199[0-9]|0[2-9]|1[0-3])(?=\s|[.,;!?]|$)/gi
    },
    {
        etiqueta: 'GEOLOCALIZACIÓN_DECLARADA',
        regex: /(?:^|\s)(?:soy de|vivo en|aca en|acá en|aqui en|aquí en|mi pais es|mi país es)\s+([a-záéíóúñ]{3,18}(?:\s+[a-záéíóúñ]{3,18})?)(?=\s|[.,;!?]|$)/gi
    },
    {
        etiqueta: 'GENTILICIO_ORIGEN',
        regex: /\b(?:soy|nosotros somos)\s+(mexican[oa]|español[a]?|argentin[oa]|chilen[oa]|colombian[oa]|peruan[oa]|venezolan[oa]|uruguay[oa]|ecuatorian[oa]|bolivian[oa]|paraguay[oa]|dominican[oa]|puertorriqueñ[oa])\b/gi
    },
    {
        etiqueta: 'IDENTIDAD_NOMBRE_REAL',
        regex: /(?:^|\s)(?:me llamo|mi nombre es|mi verdadero nombre es|llamenme|llámenme|diganme|díganme)\s+([a-záéíóúñ]{3,16})(?=\s|[.,;!?]|$)/gi
    },
    {
        etiqueta: 'VINCULACIÓN_REDES',
        regex: /(?:(?:mi\s+)?(?:ig|insta|instagram|tiktok|tt|twitter|x|tg|telegram|github|steam|roblox)\s*(?:es|:)\s*@?([a-zA-Z0-9_.]{3,24})|s[ií]ganme\s+en\s+@([a-zA-Z0-9_.]{3,24}))/gi
    }
];

const PALABRAS_EXCLUIDAS_LUGAR_O_NOMBRE = new Set([
    'aqui', 'aca', 'alla', 'alli', 'casa', 'nadie', 'alguien', 'todos', 'broma',
    'verdad', 'mentira', 'server', 'discord', 'clan', 'squad', 'raid', 'mejor',
    'peor', 'nuevo', 'viejo', 'loco', 'poco', 'mucho', 'todo', 'nada', 'eso', 'esto'
]);

const colaTrabajosOSINT = [];
let procesandoCola = false;
const memoriaHuellaReciente = new Map(); // Evita guardar la misma entidad repetida del mismo usuario cada minuto

async function procesarColaOSINT() {
    if (procesandoCola || colaTrabajosOSINT.length === 0) return;
    procesandoCola = true;

    while (colaTrabajosOSINT.length > 0) {
        const trabajo = colaTrabajosOSINT[0];
        try {
            const respuestaBD = await database.ficharInfractor(
                trabajo.authorId,
                trabajo.authorTag,
                trabajo.accionContexto,
                trabajo.casoId,
                trabajo.evidenciaHTML,
                trabajo.servidorOrigen,
                true // esSoloOsint = true (no infla infracciones de ataques)
            );

            if (respuestaBD === 'BD Inactiva' || respuestaBD.startsWith('Error de escritura')) {
                throw new Error(respuestaBD);
            }
            colaTrabajosOSINT.shift();
        } catch (error) {
            trabajo.reintentos++;
            if (trabajo.reintentos > MAX_REINTENTOS_DB) {
                colaTrabajosOSINT.shift();
            } else {
                const esperaMs = Math.min(30000, Math.pow(2, trabajo.reintentos) * 1000);
                await new Promise(resolve => setTimeout(resolve, esperaMs));
            }
        }
    }

    procesandoCola = false;
}

function escaparHTML(texto) {
    if (typeof texto !== 'string') return '';
    return texto
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function limpiarRuido(textoCrudo) {
    if (typeof textoCrudo !== 'string') return '';
    return textoCrudo
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/`[^`]*`/g, ' ')
        .replace(/^>.*$/gm, ' ')
        .trim();
}

function evaluarContextoLexico(mensajeMinusculas, coincidenciaMinusculas) {
    const index = mensajeMinusculas.indexOf(coincidenciaMinusculas);
    if (index === -1) return true;
    const ventanaInicio = Math.max(0, index - 40);
    const ventanaFin = Math.min(mensajeMinusculas.length, index + coincidenciaMinusculas.length + 40);
    const proximidad = mensajeMinusculas.slice(ventanaInicio, ventanaFin);

    for (const negacion of LISTA_NEGACIONES) {
        if (proximidad.includes(negacion)) return false;
    }
    return true;
}

/**
 * Extrae matemáticamente la fecha de creación de la cuenta desde el Snowflake ID de Discord
 * sin realizar ninguna petición HTTP a la API.
 */
function analizarAntiguedadSnowflake(userId) {
    try {
        const cleanId = String(userId || '').replace(/\D/g, '');
        if (cleanId.length < 17) return null;
        const timestampMs = Number((BigInt(cleanId) >> 22n) + DISCORD_EPOCH_MS);
        const diasAntiguedad = Math.floor((Date.now() - timestampMs) / 86400000);
        const fechaCreacion = new Date(timestampMs).toISOString().slice(0, 10);
        return {
            fechaCreacion,
            diasAntiguedad,
            esBurner: diasAntiguedad <= 21
        };
    } catch (_) {
        return null;
    }
}

function sanitizarPII(texto) {
    if (typeof texto !== 'string') return '';
    return texto
        .replace(/[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,6}/g, '[CORREO_OCULTO]')
        .replace(/\+?\d{1,3}[-.\s]?\(?\d{1,3}\)?[-.\s]?\d{3,4}[-.\s]?\d{4}/g, '[TELÉFONO_OCULTO]')
        .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[IP_OCULTA]');
}

function extraerPatronVida(timestamp) {
    const fecha = new Date(timestamp || Date.now());
    const hora = fecha.getUTCHours();
    let ciclo = 'Actividad de Madrugada (UTC) - Latam Nocturno';
    if (hora >= 6 && hora < 12) ciclo = 'Actividad Matutina (UTC) - Europa Mañana';
    else if (hora >= 12 && hora < 18) ciclo = 'Actividad Diurna (UTC) - Europa Tarde / Latam Mañana';
    else if (hora >= 18 && hora < 24) ciclo = 'Actividad Vespertina/Nocturna (UTC) - Hora Punta Global';
    return { hora, texto: `Hora UTC: ${String(hora).padStart(2, '0')}:00 - ${ciclo}` };
}

function empaquetarEvidenciaEstructurada(authorTag, authorId, apodoServidor, infoSnowflake, vectores, entidades, contextoSaneado, metadataVida) {
    const tagSeguro = escaparHTML(authorTag);
    const idSeguro = escaparHTML(authorId);
    const apodoSeguro = escaparHTML(apodoServidor || 'Sin apodo local');
    const vectoresSeguros = vectores.map(escaparHTML).join(' | ');
    const metadataSegura = escaparHTML(metadataVida);
    const contextoHTMLSeguro = escaparHTML(contextoSaneado);

    const textoBurner = infoSnowflake
        ? `${infoSnowflake.fechaCreacion} (${infoSnowflake.diasAntiguedad} días) ${infoSnowflake.esBurner ? '[!] ALERTA CUENTA BURNER RECIENTE' : ''}`
        : 'Desconocida';

    let paqueteHTML = `<div style="font-family: var(--font-mono); font-size: 0.84rem; line-height: 1.45;">`;
    paqueteHTML += `<div style="color: var(--accent-rz); font-weight: bold; margin-bottom: 0.5rem; text-transform: uppercase;">[ DOSSIER DE PERFILADO OSINT 2.0 ]</div>`;
    paqueteHTML += `<div style="color: var(--text-main); margin-bottom: 0.9rem;">`;
    paqueteHTML += `<strong>Sujeto:</strong> ${tagSeguro} <span style="color: var(--text-muted);">(${idSeguro})</span><br>`;
    paqueteHTML += `<strong>Apodo en Servidor:</strong> <span style="color: var(--text-secondary);">${apodoSeguro}</span><br>`;
    paqueteHTML += `<strong>Creación de Cuenta (Snowflake):</strong> <span style="color: ${infoSnowflake?.esBurner ? 'var(--accent-red)' : 'var(--accent-green)'};">${escaparHTML(textoBurner)}</span><br>`;
    paqueteHTML += `<strong>Vectores Detectados:</strong> <span style="color: var(--accent-amber);">${vectoresSeguros}</span><br>`;
    paqueteHTML += `<strong>Patrón Cronobiológico:</strong> <span style="color: var(--accent-info);">${metadataSegura}</span><br>`;
    paqueteHTML += `</div>`;

    paqueteHTML += `<div style="border-left: 2px solid var(--accent-green); padding-left: 0.8rem; margin-bottom: 0.9rem; background: rgba(16, 185, 129, 0.06);">`;
    paqueteHTML += `<div style="color: var(--accent-green); font-weight: bold; margin-bottom: 0.3rem;">INTELIGENCIA Y ENTIDADES EXTRAÍDAS:</div>`;

    for (const ent of entidades) {
        const colorConfianza = ent.confianza >= 85
            ? 'var(--accent-green)'
            : (ent.confianza >= 65 ? 'var(--accent-amber)' : 'var(--accent-red)');
        paqueteHTML += `<div style="margin-bottom: 0.25rem;">&#9679; <strong>${escaparHTML(ent.etiqueta)}:</strong> ${escaparHTML(ent.valorNormalizado)} <span style="color: ${colorConfianza}; font-size: 0.74rem;">[Fiabilidad: ${ent.confianza}%]</span></div>`;
    }
    paqueteHTML += `</div>`;

    paqueteHTML += `<div style="color: var(--text-muted); margin-bottom: 0.4rem; border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 0.25rem;">SEGMENTO DE CHAT CAPTURADO:</div>`;
    paqueteHTML += `<div style="white-space: pre-wrap; color: #dbdee1;">${contextoHTMLSeguro}</div>`;
    paqueteHTML += `</div>`;

    return paqueteHTML;
}

async function ejecutar(message, contextoCache) {
    if (!message?.content) return false;

    const contenidoSinRuido = limpiarRuido(message.content);
    if (contenidoSinRuido.length < 3) return false;

    const contenidoMinusculas = contenidoSinRuido.toLowerCase();
    const patronVida = extraerPatronVida(message.createdTimestamp);
    const etiquetasDisparadas = new Set();
    const entidadesProcesadas = [];

    // 1. Evaluar Reglas PII explícitas (Edad, Nacimiento, Ubicación, Gentilicio, Nombre, Redes)
    for (const regla of REGLAS_PII_AVANZADAS) {
        const regex = new RegExp(regla.regex.source, 'gi');
        let match;
        while ((match = regex.exec(contenidoSinRuido)) !== null) {
            const fullMatch = String(match[0] || '').trim();
            const capturado = String(match[1] || match[2] || '').trim();
            if (!capturado) continue;
            if (!evaluarContextoLexico(contenidoMinusculas, fullMatch.toLowerCase())) continue;

            const capLower = capturado.toLowerCase();
            if (PALABRAS_EXCLUIDAS_LUGAR_O_NOMBRE.has(capLower)) continue;

            const dedupKey = `${message.author.id}:${regla.etiqueta}:${capLower}`;
            if (memoriaHuellaReciente.has(dedupKey)) continue;
            memoriaHuellaReciente.set(dedupKey, Date.now());

            etiquetasDisparadas.add(regla.etiqueta);
            entidadesProcesadas.push({
                etiqueta: regla.etiqueta,
                valorNormalizado: `${capturado} (en "${fullMatch}")`,
                confianza: 88
            });
        }
    }

    // 2. Evaluar Huella Dialectal (Jerga regional + validación de huso horario UTC)
    for (const dialecto of DICCIONARIO_DIALECTOS) {
        const regex = new RegExp(dialecto.regex.source, 'gi');
        const matches = contenidoSinRuido.match(regex);
        if (matches && matches.length > 0) {
            const unicos = [...new Set(matches.map(m => m.toLowerCase()))];
            // Para evitar ruido, exigir al menos 2 modismos en el mensaje o 1 modismo muy específico con horario coherente
            const horarioCoherente = dialecto.husosEsperados.includes(patronVida.hora);
            if (unicos.length >= 2 || (unicos.length === 1 && horarioCoherente)) {
                const dedupKey = `${message.author.id}:DIALECTO:${dialecto.pais}`;
                const ultimoRegistro = memoriaHuellaReciente.get(dedupKey) || 0;
                // Solo registrar huella dialectal del mismo país una vez cada 12 horas por usuario
                if (Date.now() - ultimoRegistro > 43200000) {
                    memoriaHuellaReciente.set(dedupKey, Date.now());
                    etiquetasDisparadas.add('HUELLA_DIALECTAL_PAÍS');
                    entidadesProcesadas.push({
                        etiqueta: 'HUELLA_DIALECTAL_PAÍS',
                        valorNormalizado: `Probable origen ${dialecto.pais} (Modismos: ${unicos.join(', ')})`,
                        confianza: unicos.length >= 2 && horarioCoherente ? 92 : 76
                    });
                }
            }
        }
    }

    if (etiquetasDisparadas.size === 0 || entidadesProcesadas.length === 0) {
        return false;
    }

    // Purga preventiva del mapa de deduplicación
    if (memoriaHuellaReciente.size > 4000) {
        memoriaHuellaReciente.clear();
    }

    const servidorOrigen = message.guild?.name || 'Sector Privado (DM)';
    const apodoServidor = message.member?.nickname || message.author.globalName || message.author.username || '';
    const infoSnowflake = analizarAntiguedadSnowflake(message.author.id);
    const casoIdGenerado = `PRFL_${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

    let lineasContexto = [];
    if (Array.isArray(contextoCache) && contextoCache.length > 0) {
        for (const msg of contextoCache) {
            const horaStr = new Date(msg.createdTimestamp || Date.now()).toISOString().split('T')[1].slice(0, 8);
            const indicador = (msg.authorId === message.author.id && msg.content === message.content)
                ? ' (<<< OBJETIVO)'
                : '';
            lineasContexto.push(`[${horaStr}] ${msg.authorTag}: ${msg.content}${indicador}`);
        }
    } else {
        lineasContexto.push(`[CAPTURA] ${message.author.tag}: ${message.content}`);
    }

    const contextoSaneado = sanitizarPII(lineasContexto.join('\n'));
    const listaEtiquetas = Array.from(etiquetasDisparadas);

    const evidenciaHTML = empaquetarEvidenciaEstructurada(
        message.author.tag,
        message.author.id,
        apodoServidor,
        infoSnowflake,
        listaEtiquetas,
        entidadesProcesadas,
        contextoSaneado,
        patronVida.texto
    );

    if (colaTrabajosOSINT.length >= MAX_COLA_OSINT) {
        colaTrabajosOSINT.shift();
    }

    colaTrabajosOSINT.push({
        authorId: message.author.id,
        authorTag: message.author.tag,
        accionContexto: `Perfilado OSINT 2.0 [${listaEtiquetas.join(', ')}]`,
        casoId: casoIdGenerado,
        evidenciaHTML,
        servidorOrigen,
        reintentos: 0
    });

    procesarColaOSINT();
    return true;
}

module.exports = { ejecutar, analizarAntiguedadSnowflake };
