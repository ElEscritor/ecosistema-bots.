'use strict';

/* ==========================================================================
   MÓDULO DE INTELIGENCIA Y PERFILADO OSINT (PRODUCCIÓN / BLINDADO CONTRA XSS)
   Archivo: modulos/modulo_osint.js
   ========================================================================== */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const database = require('../database.js');

const MAX_COLA_OSINT = 500;
const MAX_REINTENTOS_DB = 5;

const LISTA_NEGACIONES = [
    'no soy', 'no me llamo', 'no vivo en', 'nunca fui', 'imagina que',
    'broma', 'sarcasmo', 'mentira', 'ni que fuera', 'no tengo', 'ojalá tener', 'ojala tener'
];

/**
 * Carga y valida las reglas OSINT desde reglas_osint.json.
 */
function cargarReglasOsint() {
    const reglasOsintPath = path.join(__dirname, '../reglas_osint.json');
    try {
        const raw = fs.readFileSync(reglasOsintPath, 'utf8');
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter(r => r && r.etiqueta && r.patron);
    } catch (error) {
        console.error('[ERROR MÓDULO OSINT] No se pudo cargar reglas_osint.json:', error.message);
        return [];
    }
}

const reglasOsint = cargarReglasOsint();

/* --- INFRAESTRUCTURA DE COLA ASÍNCRONA CON LÍMITE Y REINTENTO REAL --- */
const colaTrabajosOSINT = [];
let procesandoCola = false;

/**
 * Procesa la cola verificando el resultado real de database.ficharInfractor().
 */
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
                trabajo.servidorOrigen
            );

            // Verificamos si database.js devolvió sus cadenas de fallo en lugar de lanzar excepción
            if (respuestaBD === 'BD Inactiva' || respuestaBD.startsWith('Error de escritura')) {
                throw new Error(respuestaBD);
            }

            // Éxito confirmado: removemos el trabajo de la cola
            colaTrabajosOSINT.shift();
        } catch (error) {
            trabajo.reintentos++;
            if (trabajo.reintentos > MAX_REINTENTOS_DB) {
                console.error(`[MÓDULO OSINT] Descarte de paquete tras ${MAX_REINTENTOS_DB} fallos (${trabajo.casoId}): ${error.message}`);
                colaTrabajosOSINT.shift();
            } else {
                const esperaMs = Math.min(30000, Math.pow(2, trabajo.reintentos) * 1000);
                console.warn(`[MÓDULO OSINT] Fallo de escritura para ${trabajo.authorId}. Reintento #${trabajo.reintentos} en ${esperaMs}ms...`);
                await new Promise(resolve => setTimeout(resolve, esperaMs));
            }
        }
    }

    procesandoCola = false;
}

/* --- FUNCIONES DE SANITIZACIÓN Y ESCAPADO --- */

/**
 * Escapa estrictamente caracteres HTML para erradicar vulnerabilidades Stored XSS en el panel web.
 */
function escaparHTML(texto) {
    if (typeof texto !== 'string') return '';
    return texto
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Purga bloques de código y citas para evitar falsos positivos por texto citado.
 */
function limpiarRuido(textoCrudo) {
    if (typeof textoCrudo !== 'string') return '';
    return textoCrudo
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/`[^`]*`/g, ' ')
        .replace(/^>.*$/gm, ' ')
        .trim();
}

/**
 * Evalúa una ventana de contexto de ±40 caracteres para descartar negaciones o sarcasmo.
 */
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
 * Calcula el nivel de confianza heurístico (0 - 100).
 */
function calcularConfianza(etiqueta, coincidenciaCruda) {
    let score = 70;
    const min = coincidenciaCruda.toLowerCase();

    if (etiqueta === 'DEMOGRAFÍA_EDAD') {
        if (min.includes('cumplo') || min.includes('tengo')) score += 20;
        if (min.includes('creo') || min.includes('como')) score -= 30;
    } else if (etiqueta === 'GEOLOCALIZACIÓN_ORIGEN') {
        if (min.includes('vivo en') || min.includes('soy de')) score += 25;
    } else if (etiqueta === 'IDENTIDAD_NOMBRE_REAL') {
        if (min.includes('mi verdadero nombre')) score += 25;
        if (coincidenciaCruda.toLowerCase() === coincidenciaCruda) score -= 15;
    }

    return Math.min(100, Math.max(0, score));
}

/**
 * Extrae y normaliza el dato limpio a partir de la coincidencia.
 */
function normalizarEntidad(etiqueta, coincidencia) {
    let valor = coincidencia.trim();

    if (etiqueta === 'DEMOGRAFÍA_EDAD') {
        const matchNumerico = valor.match(/\d{2}/);
        if (matchNumerico) return `${matchNumerico[0]} años (Extraído)`;
    } else if (etiqueta === 'VINCULACIÓN_REDES') {
        const matchArroba = valor.match(/@[a-zA-Z0-9_.]+/);
        if (matchArroba) return matchArroba[0];
    } else if (etiqueta === 'GEOLOCALIZACIÓN_ORIGEN' || etiqueta === 'IDENTIDAD_NOMBRE_REAL') {
        valor = valor.replace(/^(soy de|vivo en|viajo a|regreso a|mi país es|me llamo|mi nombre es|mi verdadero nombre es|todos me dicen)\s+/i, '').trim();
        if (valor.length > 0) {
            valor = valor.charAt(0).toUpperCase() + valor.slice(1);
        }
    }

    return valor;
}

/**
 * Enmascara datos sensibles colaterales (emails, teléfonos, IPs) en el contexto.
 */
function sanitizarPII(texto) {
    if (typeof texto !== 'string') return '';
    return texto
        .replace(/[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,6}/g, '[CORREO_OCULTO]')
        .replace(/\+?\d{1,3}[-.\s]?\(?\d{1,3}\)?[-.\s]?\d{3,4}[-.\s]?\d{4}/g, '[TELÉFONO_OCULTO]')
        .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[IP_OCULTA]');
}

/**
 * Clasifica la franja horaria UTC del mensaje.
 */
function extraerPatronVida(timestamp) {
    const fecha = new Date(timestamp || Date.now());
    const hora = fecha.getUTCHours();
    let ciclo = 'Actividad de Madrugada (UTC) - Zona Horaria Alterna';

    if (hora >= 6 && hora < 12) ciclo = 'Actividad Matutina (UTC)';
    else if (hora >= 12 && hora < 18) ciclo = 'Actividad Diurna (UTC)';
    else if (hora >= 18 && hora < 24) ciclo = 'Actividad Vespertina/Nocturna (UTC)';

    return `Hora UTC: ${String(hora).padStart(2, '0')}:00 -${ciclo}`;
}

/**
 * Construye el widget HTML para el panel web escapando todas las variables de usuario.
 */
function empaquetarEvidenciaEstructurada(authorTag, authorId, vectores, entidades, contextoSaneado, metadataVida) {
    const tagSeguro = escaparHTML(authorTag);
    const idSeguro = escaparHTML(authorId);
    const vectoresSeguros = vectores.map(escaparHTML).join(' | ');
    const metadataSegura = escaparHTML(metadataVida);
    const contextoHTMLSeguro = escaparHTML(contextoSaneado);

    const validacionSintactica = entidades.some(e => e.confianza < 50)
        ? '[!] ALERTA DE BAJA FIABILIDAD: Entidades ambiguas detectadas.'
        : 'Sin discrepancias aparentes.';

    let paqueteHTML = `<div style="font-family: var(--font-mono); font-size: 0.85rem; line-height: 1.4;">`;
    paqueteHTML += `<div style="color: var(--accent-rz); font-weight: bold; margin-bottom: 0.5rem; text-transform: uppercase;">[ EVIDENCIA DE PERFILADO OSINT ]</div>`;
    paqueteHTML += `<div style="color: var(--text-main); margin-bottom: 1rem;">`;
    paqueteHTML += `<strong>Sujeto:</strong> ${tagSeguro} <span style="color: var(--text-muted);">(${idSeguro})</span><br>`;
    paqueteHTML += `<strong>Vectores Activos:</strong> <span style="color: var(--accent-amber);">${vectoresSeguros}</span><br>`;
    paqueteHTML += `<strong>Análisis de Patrón de Vida:</strong> <span style="color: var(--accent-cyan);">${metadataSegura}</span><br>`;
    paqueteHTML += `<strong>Evaluación Heurística:</strong> ${validacionSintactica}<br>`;
    paqueteHTML += `</div>`;

    paqueteHTML += `<div style="border-left: 2px solid var(--accent-green); padding-left: 0.8rem; margin-bottom: 1rem; background: rgba(0, 255, 102, 0.05);">`;
    paqueteHTML += `<div style="color: var(--accent-green); font-weight: bold; margin-bottom: 0.3rem;">ENTIDADES PII EXTRAÍDAS:</div>`;

    for (const ent of entidades) {
        const colorConfianza = ent.confianza >= 85
            ? 'var(--accent-green)'
            : (ent.confianza >= 50 ? 'var(--accent-amber)' : 'var(--accent-red)');
        const etiquetaSegura = escaparHTML(ent.etiqueta);
        const valorSeguro = escaparHTML(ent.valorNormalizado);
        paqueteHTML += `<div style="margin-bottom: 0.2rem;">- <strong>${etiquetaSegura}:</strong>${valorSeguro} <span style="color: ${colorConfianza}; font-size: 0.75rem;">[Fiabilidad: ${ent.confianza}%]</span></div>`;
    }

    paqueteHTML += `</div>`;
    paqueteHTML += `<div style="color: var(--text-muted); margin-bottom: 0.5rem; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 0.3rem;">TRANSCRIPCIÓN CRIPTOGRÁFICAMENTE SANEADA:</div>`;
    paqueteHTML += `<div style="white-space: pre-wrap; color: #dbdee1;">${contextoHTMLSeguro}</div>`;
    paqueteHTML += `</div>`;

    return paqueteHTML;
}

/**
 * Punto de entrada del escáner pasivo OSINT.
 */
async function ejecutar(message, contextoCache) {
    if (!message?.content || reglasOsint.length === 0) return false;

    const contenidoSinRuido = limpiarRuido(message.content);
    if (contenidoSinRuido.length === 0) return false;

    const contenidoMinusculas = contenidoSinRuido.toLowerCase();
    const etiquetasDisparadas = new Set();
    const entidadesProcesadas = [];

    for (const regla of reglasOsint) {
        // Búsqueda sobre el texto sin bloques de código ni citas
        const regex = new RegExp(regla.patron, 'gi');
        const coincidencias = contenidoSinRuido.match(regex);

        if (coincidencias && coincidencias.length > 0) {
            for (const coincidencia of coincidencias) {
                if (!evaluarContextoLexico(contenidoMinusculas, coincidencia.toLowerCase())) {
                    continue;
                }

                const scoreConfianza = calcularConfianza(regla.etiqueta, coincidencia);
                const entidadLimpia = normalizarEntidad(regla.etiqueta, coincidencia);

                etiquetasDisparadas.add(regla.etiqueta);
                entidadesProcesadas.push({
                    etiqueta: regla.etiqueta,
                    valorCrudo: coincidencia,
                    valorNormalizado: entidadLimpia,
                    confianza: scoreConfianza
                });
            }
        }
    }

    if (etiquetasDisparadas.size === 0 || entidadesProcesadas.length === 0) {
        return false;
    }

    const servidorOrigen = message.guild?.name || 'Sector Privado (DM)';
    const casoIdGenerado = `PRFL_${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const metadataVida = extraerPatronVida(message.createdTimestamp);

    let lineasContexto = [];
    if (Array.isArray(contextoCache) && contextoCache.length > 0) {
        for (const msg of contextoCache) {
            const horaStr = new Date(msg.createdTimestamp || Date.now()).toISOString().split('T')[1].slice(0, 8);
            const indicador = (msg.authorId === message.author.id && msg.content === message.content)
                ? '(<<< FRAGMENTO EXTRAÍDO)'
                : '';
            lineasContexto.push(`[${horaStr}]${msg.authorTag}: ${msg.content}${indicador}`);
        }
    } else {
        lineasContexto.push(`[SIN CACHÉ] ${message.author.tag}:${message.content}`);
    }

    const contextoSaneado = sanitizarPII(lineasContexto.join('\n'));
    const listaEtiquetas = Array.from(etiquetasDisparadas);

    const evidenciaHTML = empaquetarEvidenciaEstructurada(
        message.author.tag,
        message.author.id,
        listaEtiquetas,
        entidadesProcesadas,
        contextoSaneado,
        metadataVida
    );

    // Protección contra desbordamiento de RAM si la BD está caída prolongadamente
    if (colaTrabajosOSINT.length >= MAX_COLA_OSINT) {
        colaTrabajosOSINT.shift();
    }

    colaTrabajosOSINT.push({
        authorId: message.author.id,
        authorTag: message.author.tag,
        accionContexto: `Perfilado OSINT Heurístico [${listaEtiquetas.join(', ')}]`,
        casoId: casoIdGenerado,
        evidenciaHTML,
        servidorOrigen,
        reintentos: 0
    });

    procesarColaOSINT();
    return true;
}

module.exports = { ejecutar };
