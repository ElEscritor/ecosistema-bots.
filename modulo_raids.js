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
    return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><style>@import url('https://fonts.googleapis.com/css2?family=gg+sans:wght@400;500;600&display=swap');body { background-color: #313338; color: #dbdee1; font-family: 'gg sans', sans-serif; padding: 15px 20px; margin: 0; }.message-container { display: flex; padding-top: 2px; padding-bottom: 2px; }.message-container:hover { background-color: #2e3035; }.avatar { width: 40px; height: 40px; border-radius: 50%; margin-right: 16px; margin-top: 2px; }.content { display: flex; flex-direction: column; }.header { display: flex; align-items: baseline; margin-bottom: 4px; }.username { color: #f2f3f5; font-weight: 500; font-size: 16px; margin-right: 8px; }.timestamp { color: #949ba4; font-size: 12px; }.text { font-size: 16px; line-height: 1.375rem; white-space: pre-wrap; word-break: break-word; }.watermark { margin-top: 40px; padding-top: 15px; border-top: 1px solid #3f4147; color: #5c5e66; font-size: 11px; text-transform: uppercase; }</style></head><body><div class="message-container"><img class="avatar" src="${avatarUrl}"><div class="content"><div class="header"><span class="username">${authorTag}</span><span class="timestamp">${fechaStr}</span></div><div class="text">${mensajeOriginal.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</div></div></div><div class="watermark">EVIDENCIA FORENSE | ID: ${authorId}</div></body></html>`;
}

async function ejecutar(message) {
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

        const estadoBD = await database.ficharInfractor(message.author.id, message.author.tag, `Alusión a Raid: ${datosAlerta.idRegla}`, datosAlerta.accionId);

        let infoCordCat = "Procesando...";
        try {
            const cordcatRes = await axios.get(`https://api.cordcat.com/v1/users/${message.author.id}`, { headers: { 'Authorization': `Bearer ${CORDCAT_API_KEY}` }, timeout: 3500 });
            const cordData = cordcatRes.data;
            const flags = cordData.flags ? `🚩 **Banderas:** ${cordData.flags}` : "✅ Sin banderas";
            const dsa = cordData.dsa_sanctions !== undefined ? `⚖️ **Sanciones DSA:** ${cordData.dsa_sanctions}` : "⚖️ **DSA:** 0";
            const riesgo = cordData.risk_evaluation ? `🛡️ **Riesgo:** ${cordData.risk_evaluation}` : "🛡️ **Riesgo:** Bajo";
            infoCordCat = `${flags}\n${riesgo}\n${dsa}`;
        } catch (error) { infoCordCat = `⚠️ Base de datos inaccesible.`; }

        let contextoTxtData = `Sujeto: ${message.author.tag} (${message.author.id})\n\n`;
        try {
            const previos = await message.channel.messages.fetch({ limit: 3, before: message.id });
            const ordenados = previos.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
            ordenados.forEach(msg => { contextoTxtData += `[${new Date(msg.createdTimestamp).toISOString().split('T')[1].slice(0,8)}] ${msg.author.tag}: ${msg.content}\n`; });
            contextoTxtData += `[${new Date(message.createdTimestamp).toISOString().split('T')[1].slice(0,8)}] ${message.author.tag} (🔥 INTERCEPTADO): ${message.content}\n`;
        } catch (e) { contextoTxtData += "Error de telemetría.\n"; }

        const avatarURL = message.author.displayAvatarURL({ format: 'png', dynamic: true, size: 256 });
        const opcionesFecha = { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' };
        
        const panelForense = new MessageEmbed()
            .setColor(datosAlerta.colorHex)
            .setAuthor({ name: `Identidad Confirmada: ${message.author.tag}`, iconURL: avatarURL }) 
            .setTitle(`🚨 Registro de Actividad: ${datosAlerta.idRegla.toUpperCase()}`)
            .setDescription(`**Evidencia Interceptada:**\n\`\`\`text\n${message.content.substring(0, 900)}\n\`\`\``)
            .setThumbnail(avatarURL) 
            .addFields(
                { name: '👤 Identificador Único (ID)', value: `\`${message.author.id}\``, inline: true },
                { name: '📍 Coordenada', value: `[Saltar al mensaje original](${message.url})`, inline: true },
                { name: '🌍 Zona de Impacto', value: `**Servidor:** ${message.guild ? message.guild.name : 'DM'}\n**Canal:** <#${message.channel.id}>`, inline: true },
                { name: '🛡️ Estado en Panóptico DB', value: estadoBD, inline: false },
                { name: '🔎 Inteligencia (CordCat)', value: infoCordCat, inline: false }
            )
            .setFooter({ text: `Intercepción Confirmada (Hora España): ${new Date().toLocaleString('es-ES', opcionesFecha)}` });

        const htmlData = generarEvidenciaHTML(message.content, message.author.tag, message.author.id, avatarURL, new Date(message.createdTimestamp).toLocaleString('es-ES', opcionesFecha));

        const archivosAdjuntos = [
            { nombre: `EVIDENCIA_${message.author.id}.html`, buffer: htmlData, mimetype: 'text/html' },
            { nombre: `CONTEXTO_${message.author.id}.txt`, buffer: contextoTxtData, mimetype: 'text/plain' }
        ];

        await transmisor.enviarWebhook(urlWebhook, panelForense.toJSON(), null, archivosAdjuntos);
        return true; 
    }
    return false;
}
module.exports = { ejecutar };