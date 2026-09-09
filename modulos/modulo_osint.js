const fs = require('fs');
const path = require('path');
const database = require('../database.js'); //

// Inicialización de la matriz de reglas en memoria durante el arranque
const reglasOsintPath = path.join(__dirname, '../reglas_osint.json');
const reglasOsint = JSON.parse(fs.readFileSync(reglasOsintPath, 'utf8'));

/**
 * Escáner pasivo de metadatos e inteligencia de fuentes abiertas.
 * @param {Object} message - Objeto de mensaje de discord.js
 * @param {Array} contextoCache - Historial volátil de los últimos 5 mensajes del canal
 * @returns {Boolean} - True si se extrajo inteligencia, False si el mensaje es descartado
 */
async function ejecutar(message, contextoCache) {
    const contenidoMensaje = message.content.toLowerCase();
    let etiquetasDisparadas = new Set();
    let datosExtraidos = [];

    // 1. Evaluación Lexicológica
    for (const regla of reglasOsint) {
        const regexPatron = new RegExp(regla.patron, 'gi');
        const coincidencias = message.content.match(regexPatron); // Búsqueda sensible a mayúsculas para nombres
        
        if (coincidencias && coincidencias.length > 0) {
            etiquetasDisparadas.add(regla.etiqueta);
            datosExtraidos.push(...coincidencias);
        }
    }

    // 2. Empaquetado y Transmisión a Base de Datos
    if (etiquetasDisparadas.size > 0) {
        const servidorOrigen = message.guild ? message.guild.name : 'Sector Privado (DM)';
        const casoIdGenerado = 'PRFL_' + Math.random().toString(36).substring(2, 9).toUpperCase();
        
        // 3. Reconstrucción Forense del Contexto Volátil
        let contextoTxtData = `[ EVIDENCIA DE PERFILADO OSINT ]\n` +
                              `>>> Sujeto: ${message.author.tag} (${message.author.id})\n` +
                              `>>> Vectores Identificados: ${Array.from(etiquetasDisparadas).join(' | ')}\n` +
                              `>>> Fragmentos PII: ${datosExtraidos.join(' ; ')}\n\n` +
                              `--- TRANSCRIPCIÓN DEL DIÁLOGO ---\n`;
        
        // Inyectar contexto local para evitar falsos positivos o sarcasmo en la auditoría manual
        if (contextoCache && contextoCache.length > 0) {
            contextoCache.forEach(msg => {
                const indicador = msg.authorId === message.author.id && msg.content === message.content ? "(<<< DATO EXTRAÍDO)" : "";
                contextoTxtData += `[${new Date(msg.createdTimestamp).toISOString().split('T')[1].slice(0,8)}] ${msg.authorTag}: ${msg.content} ${indicador}\n`;
            });
        } else {
            contextoTxtData += `[SIN CACHÉ] ${message.author.tag}: ${message.content}\n`;
        }

        // 4. Inserción Silenciosa (Stealth Mode)
        // Se inyecta directamente mediante la función ficharInfractor, omitiendo transmisor.js para no enviar webhooks.
        try {
            await database.ficharInfractor( //
                message.author.id, 
                message.author.tag, 
                `Perfilado OSINT [${Array.from(etiquetasDisparadas).join(', ')}]`, 
                casoIdGenerado, 
                contextoTxtData, 
                servidorOrigen
            );
            return true; 
        } catch (error) {
            console.error(`[MÓDULO OSINT] Falla de escritura en clúster DB para ${message.author.tag}`);
        }
    }
    return false;
}

module.exports = { ejecutar };
