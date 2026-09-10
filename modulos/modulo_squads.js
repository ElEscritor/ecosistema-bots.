/* ==========================================================================
   MÓDULO DE DEFENSA ACTIVA: INTERCEPTOR DE SQUADS Y COMANDOS HOSTILES
   Archivo: modulos/modulo_squads.js
   Objetivo: Captura de comandos de destrucción, blindaje heurístico nativo,
             transcripción clínica y snapshot inmutable de evidencia.
   ========================================================================== */

const { MessageEmbed } = require('discord.js-selfbot-v13');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const database = require('../database.js'); //[cite: 3]
const transmisor = require('../web/transmisor.js'); //[cite: 3]

const CORDCAT_API_KEY = process.env.CORDCAT_API_KEY || "cc_c67695eac3f8b0fc7b83db00075086e016f0ce9f55b68814"; //[cite: 3]

/* --- 1. OPTIMIZACIÓN LÉXICA SILENCIOSA (CACHE DE COMANDOS) --- */
// El catálogo de comandos se carga y estructura una sola vez en el ciclo de vida del proceso
const comandosPath = path.join(__dirname, '../comandos_squads.json'); //[cite: 3]
const comandosSquads = JSON.parse(fs.readFileSync(comandosPath, 'utf8')); //[cite: 3]

/* --- 2. MOTOR DE PRESERVACIÓN FORENSE (SNAPSHOT BASE64) --- */
async function obtenerAvatarBase64(url) {
    try {
        const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 2500 });
        const buffer = Buffer.from(response.data, 'binary').toString('base64');
        const mimeType = response.headers['content-type'] || 'image/png';
        return `data:${mimeType};base64,${buffer}`;
    } catch (error) {
        return url; // Retorno de URL original como salvavidas visual
    }
}

/* --- 3. CONSTRUCTOR DE EVIDENCIA HTML (CÁPSULA DE TIEMPO DISCORD) --- */
function generarEvidenciaHTML(mensajeCrudo, authorTag, authorId, avatarB64, fechaStr) {
    const mensajeSeguro = mensajeCrudo.replace(/</g, "&lt;").replace(/>/g, "&gt;");

    return `<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <title>Evidencia Forense de Comando - ${authorId}</title>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Noto+Sans:wght@400;500;600&display=swap');
        body { 
            background-color: #313338; 
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
        .username { color: #ffffff; font-weight: 500; font-size: 16px; margin-right: 8px; }
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
    <div class="watermark">EVIDENCIA FORENSE COMANDO SQUAD | C4ISR COMMAND CENTER | UID: ${authorId}</div>
</body>
</html>`;
}

/* --- 4. PRE-PROCESADOR DE CONTEXTO TEXTUAL (CLÍNICO) --- */
function compilarContextoClinico(message, contextoCache, servidorOrigen, casoId) {
    let contextoTxtData = `[ REGISTRO FORENSE DE COMANDOS ]\n`;
    contextoTxtData += `Sujeto: ${message.author.tag} (${message.author.id})\n`;
    contextoTxtData += `Servidor Afectado: ${servidorOrigen}\n`;
    contextoTxtData += `ID de Referencia: ${casoId}\n\n`;
    contextoTxtData += `--- TRANSCRIPCIÓN DEL CANAL ---\n`;

    const traducirVectores = (txt) => {
        return txt.replace(/<@!?[0-9]+>/g, '[@Usuario]')
                  .replace(/<#[0-9]+>/g, '[#Canal]')
                  .replace(/<@&[0-9]+>/g, '[@Rol]');
    };

    if (contextoCache && contextoCache.length > 0) {
        contextoCache.forEach(msg => {
            const time = new Date(msg.createdTimestamp).toISOString().split('T')[1].slice(0,8);
            const msgSaneado = traducirVectores(msg.content);
            contextoTxtData += `[${time}] ${msg.authorTag}: ${msgSaneado}\n`;
        });
    } else {
        contextoTxtData += "[00:00:00] No hay datos residuales en la memoria caché del canal.\n";
    }

    return contextoTxtData;
}

/* --- FUNCIÓN PRINCIPAL DE EJECUCIÓN --- */
async function ejecutar(message, contextoCache) { //[cite: 3]
    const contenidoMensaje = message.content.toLowerCase(); //[cite: 3]
    let alertaDisparada = false;
    let datosAlerta = null;
    let casoIdGenerado = 'SQD_' + Math.random().toString(36).substring(2, 9).toUpperCase(); //[cite: 3]

    // Evaluación ultra-rápida de prefijos
    for (const cmd of comandosSquads) { //[cite: 3]
        if (contenidoMensaje.startsWith(cmd.comando.toLowerCase())) { //[cite: 3]
            alertaDisparada = true;
            datosAlerta = { 
                idRegla: cmd.comando, 
                descripcion: cmd.descripcion, 
                colorHex: cmd.colorHex, 
                webhookDestino: cmd.webhookDestino, 
                severidad: cmd.severidad, 
                accionId: casoIdGenerado 
            };
            break; // Optimización de escape rápido
        }
    }

    if (alertaDisparada && datosAlerta) {
        const urlWebhook = process.env[datosAlerta.webhookDestino]; //[cite: 3]
        if (!urlWebhook) return true;

        const servidorOrigen = message.guild ? message.guild.name : 'Sector Privado (DM)'; //[cite: 3]
        let estadoBD = "Registro Táctico Omitido"; //[cite: 3]
        
        // Política de tolerancia cero: Fichaje condicionado a severidad crítica
        if (datosAlerta.severidad === "CRITICO") { //[cite: 3]
            estadoBD = await database.ficharInfractor( //[cite: 3]
                message.author.id, 
                message.author.tag, 
                `Ejecución de Comando Crítico: ${datosAlerta.idRegla} (${datosAlerta.descripcion})`, //[cite: 3]
                datosAlerta.accionId,
                message.content,
                servidorOrigen
            );
        }

        /* --- INTEGRACIÓN AVANZADA DE CORDCAT (TIMEOUT Y FALLBACK) --- */
        let infoCordCat = "Extrayendo metadatos de riesgo...";
        try {
            const cordcatRes = await axios.get(`https://api.cordcat.com/v1/users/${message.author.id}`, { 
                headers: { 'Authorization': `Bearer ${CORDCAT_API_KEY}` }, 
                timeout: 2500 
            });
            const cordData = cordcatRes.data;
            const flags = cordData.flags ? `**Marcadores:** ${cordData.flags}` : "Historial Limpio";
            const riesgo = cordData.risk_evaluation ? `**Perfil de Riesgo:** ${cordData.risk_evaluation}` : "Bajo/Nulo";
            const vinculadas = cordData.linked_accounts ? `**Alt-Accounts Detectadas:** ${cordData.linked_accounts.length}` : "Ninguna";
            
            infoCordCat = `  ${flags}\n  ${riesgo}\n  ${vinculadas}`;
        } catch (error) { 
            infoCordCat = `  [API Externa fuera de línea]`; 
        }

        // Generación de Evidencia Textual (Cero Adornos)
        const contextoTxtData = compilarContextoClinico(message, contextoCache, servidorOrigen, datosAlerta.accionId);

        // Descarga de Avatar y Generación de HTML Inmutable
        const avatarURLOriginal = message.author.displayAvatarURL({ format: 'png', dynamic: true, size: 256 }); //[cite: 3]
        const avatarB64 = await obtenerAvatarBase64(avatarURLOriginal);
        
        const opcionesFecha = { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }; //[cite: 3]
        const fechaExactaStr = new Date(message.createdTimestamp).toLocaleString('es-ES', opcionesFecha); //[cite: 3]

        const htmlData = generarEvidenciaHTML(message.content, message.author.tag, message.author.id, avatarB64, fechaExactaStr);

        /* --- ARQUITECTURA DE EMBED ANALÍTICO DE SQUADS --- */
        const panelForense = new MessageEmbed() //[cite: 3]
            .setColor(datosAlerta.colorHex) //[cite: 3]
            .setAuthor({ name: `INFRACCIÓN DE COMANDO: ${message.author.tag}`, iconURL: avatarURLOriginal }) 
            .setTitle(`Evaluación de Severidad: ${datosAlerta.severidad}`)
            .setDescription(`**Payload Ejecutado:**\n\`\`\`text\n${message.content.substring(0, 800)}\n\`\`\``) 
            .setThumbnail(avatarURLOriginal) 
            .addFields(
                { name: '  Identificador Único', value: `\`${message.author.id}\``, inline: true }, //[cite: 3]
                { name: '  Localización Exacta', value: `[Rastrear Nodo](${message.url})`, inline: true }, //[cite: 3]
                { name: '  Sistema Comprometido', value: `**${servidorOrigen}**\n<#${message.channel.id}>`, inline: true }, //[cite: 3]
                { name: '  Persistencia de Datos', value: estadoBD, inline: false }, //[cite: 3]
                { name: '  Auditoría de Red Externa', value: infoCordCat, inline: false } //[cite: 3]
            )
            .setFooter({ text: `C4ISR Squad Case: ${datosAlerta.accionId} | HORA DE IMPACTO: ${fechaExactaStr}` }); //[cite: 3]

        const archivosAdjuntos = [ //[cite: 3]
            { nombre: `EVIDENCIA_SQUAD_${message.author.id}.html`, buffer: htmlData, mimetype: 'text/html' }, //[cite: 3]
            { nombre: `CONTEXTO_${message.author.id}.txt`, buffer: contextoTxtData, mimetype: 'text/plain' } //[cite: 3]
        ];

        await transmisor.enviarWebhook(urlWebhook, panelForense.toJSON(), null, archivosAdjuntos); //[cite: 3]
        return true; 
    }
    return false; //[cite: 3]
}

module.exports = { ejecutar }; //[cite: 3]
