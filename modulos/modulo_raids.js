const { MessageEmbed } = require('discord.js-selfbot-v13');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const database = require('../database.js'); 
const transmisor = require('../web/transmisor.js');

const reglasPath = path.join(__dirname, '../reglas_alertas.json');
const reglasAlertas = JSON.parse(fs.readFileSync(reglasPath, 'utf8'));
const CORDCAT_API_KEY = "cc_c67695eac3f8b0fc7b83db00075086e016f0ce9f55b68814"; 

function generarEvidenciaHTML(mensajeOriginal, authorTag, authorId, avatarUrl, fechaStr) {
    return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><style>@import url('https://fonts.googleapis.com/css2?family=gg+sans:wght@400;500;600&display=swap');body { background-color: #030108; color: #E2DCEF; font-family: 'gg sans', sans-serif; padding: 15px 20px; margin: 0; }.message-container { display: flex; padding-top: 2px; padding-bottom: 2px; }.message-container:hover { background-color: #0a0514; }.avatar { width: 40px; height: 40px; border-radius: 50%; margin-right: 16px; margin-top: 2px; border: 1px solid #B026FF; }.content { display: flex; flex-direction: column; }.header { display: flex; align-items: baseline; margin-bottom: 4px; }.username { color: #B026FF; font-weight: 500; font-size: 16px; margin-right: 8px; }.timestamp { color: #7A7093; font-size: 12px; }.text { font-size: 16px; line-height: 1.375rem; white-space: pre-wrap; word-break: break-word; border-left: 2px solid #FF0055; padding-left: 10px; }.watermark { margin-top: 40px; padding-top: 15px; border-top: 1px solid rgba(176, 38, 255, 0.15); color: #7A7093; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; }</style></head><body><div class="message-container"><img class="avatar" src="${avatarUrl}"><div class="content"><div class="header"><span class="username">${authorTag}</span><span class="timestamp">${fechaStr}</span></div><div class="text">${mensajeOriginal.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</div></div></div><div class="watermark">EVIDENCIA FORENSE | PANÓPTICO C4ISR | ID: ${authorId}</div></body></html>`;
}

async function ejecutar(message, contextoCache) {
    const contenidoMensaje = message.content.toLowerCase();
    let alertaDisparada = false;
    let datosAlerta = null;
    let casoIdGenerado = 'CASO_' + Math.random().toString(36).substring(2, 9).toUpperCase();

    for (const regla of reglasAlertas) {
        if (regla.webhookDestino === "WEBHOOK_Raids") {
            const regexPatron = new RegExp(regla.patron, 'i');
            if (regexPatron.test(contenidoMensaje)) {
                alertaDisparada = true;
                datosAlerta = { idRegla: regla.id_regla, colorHex: regla.colorHex, webhookDestino: regla.webhookDestino, accionId: casoIdGenerado };
                break;
            }
        }
    }

    if (alertaDisparada && datosAlerta) {
        const urlWebhook = process.env[datosAlerta.webhookDestino];
        if (!urlWebhook) return true;

        const servidorOrigen = message.guild ? message.guild.name : 'Sector Privado (DM)';

        const estadoBD = await database.ficharInfractor(
            message.author.id, 
            message.author.tag, 
            `Alusión a Raid/Dox: ${datosAlerta.idRegla}`, 
            datosAlerta.accionId,
            message.content,
            servidorOrigen
        );

        let infoCordCat = "Procesando red externa...";
        try {
            const cordcatRes = await axios.get(`https://api.cordcat.com/v1/users/${message.author.id}`, { headers: { 'Authorization': `Bearer ${CORDCAT_API_KEY}` }, timeout: 3500 });
            const cordData = cordcatRes.data;
            const flags = cordData.flags ? `🚩 **Flags:** ${cordData.flags}` : "✅ Sin reportes";
            const riesgo = cordData.risk_evaluation ? `🛡️ **Evaluación:** ${cordData.risk_evaluation}` : "🛡️ **Evaluación:** Moderada";
            infoCordCat = `${flags}\n${riesgo}`;
        } catch (error) { infoCordCat = `⚠️ Base externa inaccesible.`; }

        // EXTRACCIÓN DE CACHÉ LOCAL
        let contextoTxtData = `Sujeto: ${message.author.tag} (${message.author.id})\nNodo: ${servidorOrigen}\n\n--- INICIO DE EXTRACCIÓN DE MEMORIA VOLÁTIL ---\n`;
        if (contextoCache && contextoCache.length > 0) {
            contextoCache.forEach(msg => { 
                const indicador = msg.authorId === message.author.id && msg.content === message.content ? "(🔥 ALERTA ROJA)" : "";
                contextoTxtData += `[${new Date(msg.createdTimestamp).toISOString().split('T')[1].slice(0,8)}] ${msg.authorTag} ${indicador}: ${msg.content}\n`; 
            });
        } else {
            contextoTxtData += "Contexto vacío en memoria RAM.\n";
        }

        const avatarURL = message.author.displayAvatarURL({ format: 'png', dynamic: true, size: 256 });
        const opcionesFecha = { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' };
        
        const panelForense = new MessageEmbed()
            .setColor(datosAlerta.colorHex)
            .setAuthor({ name: `Amenaza Confirmada: ${message.author.tag}`, iconURL: avatarURL }) 
            .setTitle(`🚨 Clasificación de Riesgo: ${datosAlerta.idRegla.toUpperCase()}`)
            .setDescription(`**Transmisión Interceptada:**\n\`\`\`text\n${message.content.substring(0, 900)}\n\`\`\``)
            .setThumbnail(avatarURL) 
            .addFields(
                { name: '👤 Identidad', value: `\`${message.author.id}\``, inline: true },
                { name: '📍 Nodo', value: `[Rastrear Señal](${message.url})`, inline: true },
                { name: '🌍 Origen Exacto', value: `**${servidorOrigen}**\n<#${message.channel.id}>`, inline: true },
                { name: '🛡️ Estado de Purga', value: estadoBD, inline: false },
                { name: '🔎 Inteligencia API', value: infoCordCat, inline: false }
            )
            .setFooter({ text: `ID: ${datosAlerta.accionId} | Hora España: ${new Date().toLocaleString('es-ES', opcionesFecha)}` });

        const htmlData = generarEvidenciaHTML(message.content, message.author.tag, message.author.id, avatarURL, new Date(message.createdTimestamp).toLocaleString('es-ES', opcionesFecha));

        const archivosAdjuntos = [
            { nombre: `EVIDENCIA_RAID_${message.author.id}.html`, buffer: htmlData, mimetype: 'text/html' },
            { nombre: `TELEMETRIA_${message.author.id}.txt`, buffer: contextoTxtData, mimetype: 'text/plain' }
        ];

        await transmisor.enviarWebhook(urlWebhook, panelForense.toJSON(), null, archivosAdjuntos);
        return true; 
    }
    return false;
}
module.exports = { ejecutar };
