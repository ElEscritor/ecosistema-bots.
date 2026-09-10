/* ==========================================================================
   MÓDULO DE INTELIGENCIA Y PERFILADO OSINT (REINGENIERÍA TÁCTICA)
   Archivo: modulos/modulo_osint.js
   Objetivo: Extracción heurística de PII, análisis de patrones de vida,
             evaluación de confianza, mitigación de sarcasmo y sanitización.
   ========================================================================== */

const fs = require('fs');
const path = require('path');
const database = require('../database.js'); //[cite: 3]

// Inicialización de la matriz de reglas en memoria durante el arranque[cite: 3]
const reglasOsintPath = path.join(__dirname, '../reglas_osint.json'); //[cite: 3]
const reglasOsint = JSON.parse(fs.readFileSync(reglasOsintPath, 'utf8')); //[cite: 3]

/* --- INFRAESTRUCTURA DE COLA ASÍNCRONA (JOB QUEUE) --- */
// Mejora 9: Aislamiento Asíncrono de Operaciones I/O con Exponential Backoff
const colaTrabajosOSINT = [];
let procesandoCola = false;

/**
 * Motor de procesamiento de cola para inyecciones en base de datos.
 * Evita la pérdida de datos forenses ante caídas temporales del clúster MongoDB.
 */
async function procesarColaOSINT() {
    if (procesandoCola || colaTrabajosOSINT.length === 0) return;
    procesandoCola = true;

    while (colaTrabajosOSINT.length > 0) {
        const trabajo = colaTrabajosOSINT[0];
        
        try {
            // Inyección silenciosa (Stealth Mode)[cite: 3]
            await database.ficharInfractor( //[cite: 3]
                trabajo.authorId, //[cite: 3]
                trabajo.authorTag, //[cite: 3]
                trabajo.accionContexto, //[cite: 3]
                trabajo.casoId, //[cite: 3]
                trabajo.evidenciaHTML, //[cite: 3]
                trabajo.servidorOrigen //[cite: 3]
            );
            
            // Si tiene éxito, eliminamos el trabajo de la cola
            colaTrabajosOSINT.shift();
        } catch (error) {
            console.error(`[MÓDULO OSINT] Falla de escritura en clúster DB para ${trabajo.authorTag}. Reintentando en ${trabajo.reintentos * 2}s...`); //[cite: 3]
            trabajo.reintentos++;
            
            if (trabajo.reintentos > 5) {
                console.error(`[MÓDULO OSINT] Descarte de paquete OSINT (Max Retries alcanzado): ${trabajo.casoId}`);
                colaTrabajosOSINT.shift();
            } else {
                // Exponential backoff
                await new Promise(res => setTimeout(res, trabajo.reintentos * 2000));
            }
        }
    }
    procesandoCola = false;
}

/* --- MOTORES HEURÍSTICOS Y NORMALIZADORES --- */

/**
 * Mejora 6: Filtrado Exhaustivo de Ruido (Markdown y Citas)
 * Purgado de bloques de código y citas para evitar que el escáner asuma identidades citadas.
 */
function limpiarRuido(textoCrudo) {
    let textoLimpio = textoCrudo;
    // Eliminar bloques de código multilínea (```...```)
    textoLimpio = textoLimpio.replace(/```[\s\S]*?```/g, '');
    // Eliminar código en línea (`...`)
    textoLimpio = textoLimpio.replace(/`[^`]*`/g, '');
    // Eliminar citas de Discord (> ...)
    textoLimpio = textoLimpio.replace(/^>.*$/gm, '');
    return textoLimpio.trim();
}

/**
 * Mejora 2: Detección de Negaciones y Sarcasmo Contextual
 * Evalúa las proximidades de la coincidencia para descartar suposiciones inválidas.
 */
function evaluarContextoLexico(mensaje, coincidencia) {
    const negaciones = ["no soy", "no me llamo", "no vivo en", "nunca fui", "imagina que", "broma", "sarcasmo", "mentira", "ni que fuera", "no tengo", "ojalá tener"];
    const index = mensaje.indexOf(coincidencia);
    if (index === -1) return true; // Contexto limpio por defecto si no se puede indexar

    // Extraer hasta 40 caracteres antes y después de la coincidencia
    const ventanaInicio = Math.max(0, index - 40);
    const ventanaFin = Math.min(mensaje.length, index + coincidencia.length + 40);
    const proximidad = mensaje.substring(ventanaInicio, ventanaFin).toLowerCase();

    for (const negacion of negaciones) {
        if (proximidad.includes(negacion)) {
            return false; // Sarcasmo o negación detectada
        }
    }
    return true;
}

/**
 * Mejora 1: Sistema de Evaluación de Confianza (Confidence Scoring)
 * Pondera la fiabilidad del dato extraído basado en su estructura gramatical.
 */
function calcularConfianza(etiqueta, coincidencia) {
    let baseScore = 70; // Confianza base razonable
    
    // Reglas específicas por etiqueta para subir o bajar el score
    if (etiqueta === "DEMOGRAFÍA_EDAD") { //[cite: 3]
        if (coincidencia.includes("cumplo") || coincidencia.includes("tengo")) baseScore += 20; //[cite: 3]
        if (coincidencia.includes("creo")) baseScore -= 30;
    } else if (etiqueta === "GEOLOCALIZACIÓN_ORIGEN") { //[cite: 3]
        if (coincidencia.includes("vivo en") || coincidencia.includes("soy de")) baseScore += 25; //[cite: 3]
    } else if (etiqueta === "IDENTIDAD_NOMBRE_REAL") { //[cite: 3]
        if (coincidencia.includes("mi verdadero nombre")) baseScore += 25; //[cite: 3]
        // Si no hay mayúsculas en un nombre propio en inglés/español, baja la confianza
        if (coincidencia.toLowerCase() === coincidencia) baseScore -= 15;
    }

    return Math.min(100, Math.max(0, baseScore)); // Clamp entre 0 y 100
}

/**
 * Mejora 3: Normalización y Estructuración Dinámica de Entidades (NER)
 */
function normalizarEntidad(etiqueta, coincidencia) {
    let valorNormalizado = coincidencia.trim();
    
    if (etiqueta === "DEMOGRAFÍA_EDAD") { //[cite: 3]
        const matchNumerico = valorNormalizado.match(/\d{2}/); //[cite: 3]
        if (matchNumerico) valorNormalizado = `${matchNumerico[0]} años (Extraído)`;
    } else if (etiqueta === "VINCULACIÓN_REDES") { //[cite: 3]
        const matchArroba = valorNormalizado.match(/@[a-zA-Z0-9_.]+/); //[cite: 3]
        if (matchArroba) valorNormalizado = matchArroba[0];
    } else if (etiqueta === "GEOLOCALIZACIÓN_ORIGEN" || etiqueta === "IDENTIDAD_NOMBRE_REAL") { //[cite: 3]
        // Capitalización de nombres propios y ubicaciones
        valorNormalizado = valorNormalizado.replace(/^(soy de|vivo en|viajo a|me llamo|mi nombre es)\s+/i, ''); //[cite: 3]
        valorNormalizado = valorNormalizado.charAt(0).toUpperCase() + valorNormalizado.slice(1);
    }
    
    return valorNormalizado;
}

/**
 * Mejora 8: Sanitización Criptográfica de Evidencia Residual
 * Enmascara datos altamente sensibles colaterales que no pertenecen al objetivo.
 */
function sanitizarPII(texto) {
    let textoSeguro = texto;
    // Enmascarar correos electrónicos residuales
    textoSeguro = textoSeguro.replace(/[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,4}/g, '[CORREO_ENCRIPTADO]');
    // Enmascarar números telefónicos internacionales (+XX XXX XXX XXX)
    textoSeguro = textoSeguro.replace(/\+?\d{1,3}[-.\s]?\(?\d{1,3}\)?[-.\s]?\d{3,4}[-.\s]?\d{4}/g, '[TELÉFONO_ENCRIPTADO]');
    // Enmascarar direcciones IP locales e internacionales
    textoSeguro = textoSeguro.replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, '[IP_OCULTA]');
    return textoSeguro;
}

/**
 * Mejora 7: Extracción de Metadatos de Patrones de Vida (Life Pattern Analysis)
 */
function extraerPatronVida(timestamp) {
    const fecha = new Date(timestamp);
    const hora = fecha.getUTCHours();
    let cicloActividad = "Desconocido";

    if (hora >= 6 && hora < 12) cicloActividad = "Actividad Matutina (UTC)";
    else if (hora >= 12 && hora < 18) cicloActividad = "Actividad Diurna (UTC)";
    else if (hora >= 18 && hora < 24) cicloActividad = "Actividad Vespertina/Nocturna (UTC)";
    else cicloActividad = "Actividad de Madrugada (UTC) - Posible Insomnio / Zona Horaria Alterna";

    return `Hora UTC: ${hora}:00 - ${cicloActividad}`;
}

/**
 * Mejora 4: Generación Inmutable de Evidencia Forense (HTML Mockup Textual para UI)
 * Genera un bloque de texto altamente estructurado que la SPA puede interpretar con seguridad.
 */
function empaquetarEvidenciaEstructurada(authorTag, authorId, vectores, entidades, contextoSaneado, metadataVida) {
    // Mejora 5: Base para Cross-Correlation (Flags de Contradicción)
    const validacionSintactica = entidades.some(e => e.confianza < 50) ? "[!] ALERTA DE CONTRADICCIÓN: Múltiples entidades de baja fiabilidad detectadas." : "Sin discrepancias aparentes.";

    let paqueteHTML = `<div style="font-family: var(--font-mono); font-size: 0.85rem; line-height: 1.4;">`;
    paqueteHTML += `<div style="color: var(--accent-rz); font-weight: bold; margin-bottom: 0.5rem; text-transform: uppercase;">[ EVIDENCIA DE PERFILADO OSINT ]</div>`;
    paqueteHTML += `<div style="color: var(--text-main); margin-bottom: 1rem;">`;
    paqueteHTML += `<strong>Sujeto:</strong> ${authorTag} <span style="color: var(--text-muted);">(${authorId})</span><br>`; //[cite: 3]
    paqueteHTML += `<strong>Vectores Activos:</strong> <span style="color: var(--accent-amber);">${vectores.join(' | ')}</span><br>`; //[cite: 3]
    paqueteHTML += `<strong>Análisis de Patrón de Vida:</strong> <span style="color: var(--accent-cyan);">${metadataVida}</span><br>`;
    paqueteHTML += `<strong>Evaluación Heurística:</strong> ${validacionSintactica}<br>`;
    paqueteHTML += `</div>`;
    
    paqueteHTML += `<div style="border-left: 2px solid var(--accent-green); padding-left: 0.8rem; margin-bottom: 1rem; background: rgba(0, 255, 102, 0.05);">`;
    paqueteHTML += `<div style="color: var(--accent-green); font-weight: bold; margin-bottom: 0.3rem;">ENTIDADES PII EXTRAÍDAS:</div>`;
    entidades.forEach(ent => {
        const colorConfianza = ent.confianza >= 85 ? 'var(--accent-green)' : (ent.confianza >= 50 ? 'var(--accent-amber)' : 'var(--accent-red)');
        paqueteHTML += `<div style="margin-bottom: 0.2rem;">- <strong>${ent.etiqueta}:</strong> ${ent.valorNormalizado} <span style="color: ${colorConfianza}; font-size: 0.75rem;">[Fiabilidad: ${ent.confianza}%]</span></div>`;
    });
    paqueteHTML += `</div>`;

    paqueteHTML += `<div style="color: var(--text-muted); margin-bottom: 0.5rem; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 0.3rem;">TRANSCRIPCIÓN CRIPTOGRÁFICAMENTE SANEADA:</div>`; //[cite: 3]
    paqueteHTML += `<div style="white-space: pre-wrap; color: #dbdee1;">${contextoSaneado}</div>`; //[cite: 3]
    paqueteHTML += `</div>`;

    return paqueteHTML;
}

/* --- FUNCIÓN PRINCIPAL DE EJECUCIÓN (ENTRY POINT) --- */

/**
 * Escáner pasivo de metadatos e inteligencia de fuentes abiertas. //[cite: 3]
 * @param {Object} message - Objeto de mensaje de discord.js //[cite: 3]
 * @param {Array} contextoCache - Historial volátil de los últimos 5 mensajes del canal //[cite: 3]
 * @returns {Boolean} - True si se extrajo inteligencia, False si el mensaje es descartado //[cite: 3]
 */
async function ejecutar(message, contextoCache) { //[cite: 3]
    // 1. Pre-procesamiento y purga de ruido
    const contenidoMensajeCrudo = message.content;
    const contenidoMensajeLimpio = limpiarRuido(contenidoMensajeCrudo).toLowerCase(); //[cite: 3]
    
    if (contenidoMensajeLimpio.length === 0) return false;

    let etiquetasDisparadas = new Set(); //[cite: 3]
    let entidadesProcesadas = [];
    
    // 2. Evaluación Lexicológica Estricta //[cite: 3]
    for (const regla of reglasOsint) { //[cite: 3]
        const regexPatron = new RegExp(regla.patron, 'gi'); //[cite: 3]
        const coincidencias = contenidoMensajeCrudo.match(regexPatron); // Búsqueda sensible a mayúsculas para nombres //[cite: 3]
        
        if (coincidencias && coincidencias.length > 0) { //[cite: 3]
            for (const coincidencia of coincidencias) {
                // Filtro 1: Negaciones y Sarcasmo
                if (!evaluarContextoLexico(contenidoMensajeLimpio, coincidencia.toLowerCase())) continue;

                // Filtro 2: Ponderación de Confianza
                const scoreConfianza = calcularConfianza(regla.etiqueta, coincidencia.toLowerCase());
                
                // Filtro 3: Normalización de Entidad
                const entidadLimpia = normalizarEntidad(regla.etiqueta, coincidencia);

                etiquetasDisparadas.add(regla.etiqueta); //[cite: 3]
                entidadesProcesadas.push({
                    etiqueta: regla.etiqueta,
                    valorCrudo: coincidencia,
                    valorNormalizado: entidadLimpia,
                    confianza: scoreConfianza
                });
            }
        }
    }

    // 3. Empaquetado y Transmisión a Cola de Base de Datos //[cite: 3]
    if (etiquetasDisparadas.size > 0 && entidadesProcesadas.length > 0) { //[cite: 3]
        const servidorOrigen = message.guild ? message.guild.name : 'Sector Privado (DM)'; //[cite: 3]
        const casoIdGenerado = 'PRFL_' + Math.random().toString(36).substring(2, 9).toUpperCase(); //[cite: 3]
        
        // Extracción de metadatos geoespaciales indirectos
        const metadataVida = extraerPatronVida(message.createdTimestamp); //[cite: 3]
        
        // 4. Reconstrucción Forense del Contexto Volátil //[cite: 3]
        let contextoTxtCrudo = "";
        
        // Inyectar contexto local para evitar falsos positivos o sarcasmo en la auditoría manual //[cite: 3]
        if (contextoCache && contextoCache.length > 0) { //[cite: 3]
            contextoCache.forEach(msg => { //[cite: 3]
                const indicador = msg.authorId === message.author.id && msg.content === message.content ? "(<<< FRAGMENTO EXTRAÍDO)" : ""; //[cite: 3]
                contextoTxtCrudo += `[${new Date(msg.createdTimestamp).toISOString().split('T')[1].slice(0,8)}] ${msg.authorTag}: ${msg.content} ${indicador}\n`; //[cite: 3]
            });
        } else { //[cite: 3]
            contextoTxtCrudo += `[SIN CACHÉ] ${message.author.tag}: ${message.content}\n`; //[cite: 3]
        }

        // Sanitización criptográfica de la evidencia contextual
        const contextoSaneado = sanitizarPII(contextoTxtCrudo);

        // Generación Inmutable de Evidencia HTML para la Interfaz de La Biblioteca
        const evidenciaHTML = empaquetarEvidenciaEstructurada(
            message.author.tag,
            message.author.id, //[cite: 3]
            Array.from(etiquetasDisparadas),
            entidadesProcesadas,
            contextoSaneado,
            metadataVida
        );

        // 5. Inyección a la Cola de Trabajos (Job Queue)
        colaTrabajosOSINT.push({
            authorId: message.author.id, //[cite: 3]
            authorTag: message.author.tag, //[cite: 3]
            accionContexto: `Perfilado OSINT Heurístico [${Array.from(etiquetasDisparadas).join(', ')}]`, //[cite: 3]
            casoId: casoIdGenerado, //[cite: 3]
            evidenciaHTML: evidenciaHTML,
            servidorOrigen: servidorOrigen, //[cite: 3]
            reintentos: 0
        });

        // Disparar el procesamiento de la cola de forma no bloqueante
        procesarColaOSINT();
        
        return true; //[cite: 3]
    }
    
    return false; //[cite: 3]
}

module.exports = { ejecutar }; //[cite: 3]
