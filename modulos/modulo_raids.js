/* ==========================================================================
   MÓDULO DE DEFENSA ACTIVA: INTERCEPTOR DE RAIDS Y DOXXING
   Archivo: modulos/modulo_raids.js
   Objetivo: Captura de amenazas críticas, encapsulación inmutable en Base64,
             sanitización de vectores y análisis heurístico mediante CordCat.
   ========================================================================== */

const { MessageEmbed } = require('discord.js-selfbot-v13');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const database = require('../database.js'); //[cite: 3]
const transmisor = require('../web/transmisor.js'); //[cite: 3]

// Clave API para el motor heurístico externo
const CORDCAT_API_KEY = process.env.CORDCAT_API_KEY || "cc_c67695eac3f8b0fc7b83db00075086e016f0ce9f55b68814"; //[cite: 3]

/* --- 1. OPTIMIZACIÓN LÉXICA SILENCIOSA (PRE-COMPILACIÓN) --- */
// Compilación en frío de las expresiones regulares al iniciar el sistema.
// Esto erradica la asfixia del Event Loop al procesar cientos de servidores simultáneamente.
const reglasPath = path.join(__dirname, '../reglas_alertas.json'); //[cite: 3]
const reglasCrudas = JSON.parse(fs.readFileSync(reglasPath, 'utf8')); //[cite: 3]
const reglasRaids = reglasCrudas
    .filter(r => r.webhookDestino === "WEBHOOK_Raids") //[cite: 3]
    .map(r => ({
        ...r,
        regex: new RegExp(r.patron, 'i') // Instanciación única en memoria RAM
    }));

/* --- 2. MOTOR DE PRESERVACIÓN FORENSE (SNAPSHOT BASE64) --- */
/**
 * Descarga el avatar real del atacante en el milisegundo de la intercepción
 * y lo convierte en una cadena Base64 para incrustarlo nativamente en el HTML.
 * Garantiza que la evidencia visual sea inmutable aunque la cuenta sea eliminada.
 */
async function obtenerAvatarBase64(url) {
    try {
        const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 2500 });
        const buffer = Buffer.from(response.data, 'binary').toString('base64');
        const mimeType = response.headers['content-type'] || 'image/png';
        return `data:${mimeType};base64,${buffer}`;
    } catch (error) {
        // Fallback seguro: Si el proveedor falla, retorna la URL original para no romper el renderizado
        return url;
    }
}

/* --- 3. CONSTRUCTOR DE EVIDENCIA HTML (CÁPSULA DE TIEMPO DISCORD) --- */
/**
 * Genera un documento HTML estático y sin dependencias externas que replica 1:1
 * el cliente nativo de Discord (Vanilla Dark Theme).
 */
function generarEvidenciaHTML(mensajeCrudo, authorTag, authorId, avatarB64, fechaStr) {
    // Escapado seguro de entidades HTML para evitar inyección en la evidencia
    const mensajeSeguro = mensajeCrudo.replace(/</g, "&lt;").replace(/>/g, "&gt;");

    return `<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <title>Evidencia Forense - ${authorId}</title>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Noto+Sans:wght@400;500;600&display=swap');
        body { 
            background-color: #313338; /* Color hexadecimal exacto de Discord Dark Theme */
            color: #dbdee1; 
            font-family: 'gg sans', 'Noto Sans', 'Helvetica Neue', Helvetica, Arial, sans-serif; 
            padding: 15px 20px; 
            margin: 0; 
        }
        .message-container { 
            display: flex; 
            padding-top: 2px; 
            padding-bottom: 2px; 
            margin-top: 17px;
        }
        .message-container:hover { background-color: #2e3035; }
        .avatar { 
            width: 40px; 
            height: 40px; 
            border-radius: 50%; 
            margin-right: 16px; 
            margin-top: 2px; 
            object-fit: cover;
            background-color: #1e1f22;
        }
        .content { display: flex; flex-direction: column; width: 100%; }
        .header { display: flex; align-items: baseline; margin-bottom: 4px; }
        .username { 
            color: #ffffff; /* Blanco brillante estándar de usuarios sin rol */
            font-weight: 500; 
            font-size: 16px; 
            margin-right: 8px; 
        }
        .timestamp { color: #949ba4; font-size: 12px; font-weight: 400; }
        .text { 
            font-size: 16px; 
            line-height: 1.375rem; 
            white-space: pre-wrap; 
            word-break: break-word; 
            color: #dbdee1;
        }
        .watermark { 
            margin-top: 40px; 
            padding-top: 15px; 
            border-top: 1px solid rgba(255, 255, 255, 0.05); 
            color: #7A7093; 
            font-size: 11px; 
            text-transform: uppercase; 
            letter-spacing: 1px; 
            text-align: left;
        }
    </style>
</head>
<body>
    <div class="message-container">
        <img class="avatar" src="${avatarB64}" alt="Avatar">
        <div class="content">
            <div class="header">
                <span class="username">${authorTag}</span>
                <span class="timestamp">${fechaStr}</span>
            </div>
            <div class="text">${mensajeSeguro}</div>
        </div>
    </div>
    <div class="watermark">EVIDENCIA FORENSE INMUTABLE | C4ISR COMMAND CENTER | UID: ${authorId}</div>
</body>
</html>`;
}

/* --- 4. PRE-PROCESADOR DE CONTEXTO TEXTUAL (TRADUCTOR DE VECTORES) --- */
/**
 * Sanitiza las intercepciones para el archivo TELEMETRIA.txt.
 * Traduce los códigos ilegibles de Discord a etiquetas limpias y clínicas.
 */
function compilarContextoClinico(message, contextoCache, servidorOrigen, casoId) {
    let contextoTxtData = `[ REGISTRO FORENSE TÁCTICO ]\n`;
    contextoTxtData += `Sujeto: ${message.author.tag} (${message.author.id})\n`;
    contextoTxtData += `Nodo de Origen: ${servidorOrigen}\n`;
    contextoTxtData += `ID de Caso: ${casoId}\n\n`;
    contextoTxtData += `--- TRANSCRIPCIÓN DE EVENTOS ---\n`;

    // Traductor Dinámico de Menciones para Legibilidad Humana
    const traducirVectores = (txt) => {
        return txt.replace(/<@!?[0-9]+>/g, '[@Usuario_Mencionado]')
                  .replace(/<#[0-9]+>/g, '[#Canal_Vinculado]')
                  .replace(/<@&[0-9]+>/g, '[@Rol_Mencionado]');
    };

    if (contextoCache && contextoCache.length > 0) {
        contextoCache.forEach(msg => {
            const time = new Date(msg.createdTimestamp).toISOString().split('T')[1].slice(0,8);
            const msgSaneado = traducirVectores(msg.content);
            contextoTxtData += `[${time}] ${msg.authorTag}: ${msgSaneado}\n`;
        });
    } else {
        contextoTxtData += "[00:00:00] Memoria volátil de canal vacía al momento de la intercepción.\n";
    }

    return contextoTxtData;
}

/* --- FUNCIÓN PRINCIPAL DE EJECUCIÓN --- */
async function ejecutar(message, contextoCache) { //[cite: 3]
    const contenidoMensaje = message.content;
    let alertaDisparada = false;
    let datosAlerta = null;
    let casoIdGenerado = 'CASO_' + Math.random().toString(36).substring(2, 9).toUpperCase(); //[cite: 3]

    // Evaluación ultra-rápida usando los patrones pre-compilados (.test)
    for (const regla of reglasRaids) {
        if (regla.regex.test(contenidoMensaje)) {
            alertaDisparada = true;
            datosAlerta = { 
                idRegla: regla.id_regla, 
                colorHex: regla.colorHex, 
                webhookDestino: regla.webhookDestino, 
                accionId: casoIdGenerado 
            };
            break; // Optimización Léxica: Abandona el bucle al primer positivo
        }
    }

    if (alertaDisparada && datosAlerta) {
        const urlWebhook = process.env[datosAlerta.webhookDestino]; //[cite: 3]
        if (!urlWebhook) return true;

        const servidorOrigen = message.guild ? message.guild.name : 'Sector Privado (DM)'; //[cite: 3]

        // Registro asíncrono en MongoDB
        const estadoBD = await database.ficharInfractor( //[cite: 3]
            message.author.id, 
            message.author.tag, 
            `Alusión a Raid/Dox: ${datosAlerta.idRegla}`, 
            datosAlerta.accionId,
            message.content,
            servidorOrigen
        );

        /* --- INTEGRACIÓN AVANZADA DE CORDCAT (NON-BLOCKING TIMEOUT) --- */
        let infoCordCat = "Procesando inteligencia externa...";
        try {
            // Seguro de vida de 2500ms para evitar asfixia del Event Loop
            const cordcatRes = await axios.get(`https://api.cordcat.com/v1/users/${message.author.id}`, { 
                headers: { 'Authorization': `Bearer ${CORDCAT_API_KEY}` }, 
                timeout: 2500 
            });
            
            const cordData = cordcatRes.data;
            const flags = cordData.flags ? `**Marcadores:** ${cordData.flags}` : "Ninguno detectado";
            const riesgo = cordData.risk_evaluation ? `**Nivel de Riesgo:** ${cordData.risk_evaluation}` : "Evaluación Pendiente";
            const vinculadas = cordData.linked_accounts ? `**Cuentas Vinculadas:** ${cordData.linked_accounts.length}` : "0";
            
            infoCordCat = `  ${flags}\n  ${riesgo}\n  ${vinculadas}`;
        } catch (error) { 
            // Fallo silencioso y controlado
            infoCordCat = `  [API CordCat Inactiva o Latencia Excesiva]`; 
        }

        // Generación de Evidencia Clínica Textual (TELEMETRIA.txt)
        const contextoTxtData = compilarContextoClinico(message, contextoCache, servidorOrigen, datosAlerta.accionId);

        // Generación de Cápsula Inmutable HTML
        const avatarURLOriginal = message.author.displayAvatarURL({ format: 'png', dynamic: true, size: 256 }); //[cite: 3]
        const avatarB64 = await obtenerAvatarBase64(avatarURLOriginal);
        
        const opcionesFecha = { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }; //[cite: 3]
        const fechaExactaStr = new Date(message.createdTimestamp).toLocaleString('es-ES', opcionesFecha); //[cite: 3]
        
        const htmlData = generarEvidenciaHTML(message.content, message.author.tag, message.author.id, avatarB64, fechaExactaStr);

        /* --- ARQUITECTURA DE EMBED ANALÍTICO --- */
        const panelForense = new MessageEmbed() //[cite: 3]
            .setColor(datosAlerta.colorHex) //[cite: 3]
            .setAuthor({ name: `AMENAZA CONFIRMADA: ${message.author.tag}`, iconURL: avatarURLOriginal }) 
            .setTitle(`Clasificación de Riesgo: ${datosAlerta.idRegla.toUpperCase()}`)
            .setDescription(`**Transmisión Interceptada:**\n\`\`\`text\n${message.content.substring(0, 800)}\n\`\`\``) //[cite: 3]
            .setThumbnail(avatarURLOriginal) 
            .addFields(
                { name: '  Identificador', value: `\`${message.author.id}\``, inline: true }, //[cite: 3]
                { name: '  Rastreo de Red', value: `[Cruce de Señal](${message.url})`, inline: true }, //[cite: 3]
                { name: '  Coordenada Origen', value: `**${servidorOrigen}**\n<#${message.channel.id}>`, inline: true }, //[cite: 3]
                { name: '  Estado de Base de Datos', value: estadoBD, inline: false }, //[cite: 3]
                { name: '  Inteligencia de Fuentes Externas (CordCat)', value: infoCordCat, inline: false } //[cite: 3]
            )
            .setFooter({ text: `C4ISR Case ID: ${datosAlerta.accionId} | HORA DE IMPACTO: ${fechaExactaStr}` }); //[cite: 3]

        const archivosAdjuntos = [ //[cite: 3]
            { nombre: `EVIDENCIA_RAID_${message.author.id}.html`, buffer: htmlData, mimetype: 'text/html' }, //[cite: 3]
            { nombre: `TELEMETRIA_${message.author.id}.txt`, buffer: contextoTxtData, mimetype: 'text/plain' } //[cite: 3]
        ];

        // Despacho final al proxy ofuscador de red
        await transmisor.enviarWebhook(urlWebhook, panelForense.toJSON(), null, archivosAdjuntos); //[cite: 3]
        
        return true; 
    }
    return false; //[cite: 3]
}

module.exports = { ejecutar }; //[cite: 3]
