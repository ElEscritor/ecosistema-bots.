const { WebhookClient, MessageEmbed } = require('discord.js-selfbot-v13');
const fs = require('fs');
const axios = require('axios');

// 1. CARGA DE CONFIGURACIÓN ESTÁTICA Y CREDENCIALES
const comandosSquads = JSON.parse(fs.readFileSync('./comandos_squads.json', 'utf8'));
const reglasAlertas = JSON.parse(fs.readFileSync('./reglas_alertas.json', 'utf8'));
const CORDCAT_API_KEY = "cc_c67695eac3f8b0fc7b83db00075086e016f0ce9f55b68814"; 

// 2. MOTOR DE RENDERIZADO FORENSE HTML (Estética Nativa Discord)
function generarEvidenciaHTML(mensajeOriginal, authorTag, authorId, avatarUrl, fechaStr) {
    return `
    <!DOCTYPE html>
    <html lang="es">
    <head>
        <meta charset="UTF-8">
        <style>
            @import url('https://fonts.googleapis.com/css2?family=gg+sans:wght@400;500;600&display=swap');
            body { background-color: #313338; color: #dbdee1; font-family: 'gg sans', 'Helvetica Neue', Helvetica, Arial, sans-serif; padding: 15px 20px; margin: 0; }
            .message-container { display: flex; margin-bottom: 0; padding-top: 2px; padding-bottom: 2px; }
            .message-container:hover { background-color: #2e3035; }
            .avatar { width: 40px; height: 40px; border-radius: 50%; margin-right: 16px; margin-top: 2px; cursor: pointer; }
            .content { display: flex; flex-direction: column; }
            .header { display: flex; align-items: baseline; margin-bottom: 4px; }
            .username { color: #f2f3f5; font-weight: 500; font-size: 16px; margin-right: 8px; cursor: pointer; }
            .username:hover { text-decoration: underline; }
            .timestamp { color: #949ba4; font-size: 12px; font-weight: 400; cursor: default; }
            .text { font-size: 16px; line-height: 1.375rem; white-space: pre-wrap; word-break: break-word; }
            .watermark { margin-top: 40px; padding-top: 15px; border-top: 1px solid #3f4147; color: #5c5e66; font-size: 11px; letter-spacing: 0.5px; text-transform: uppercase; }
        </style>
    </head>
    <body>
        <div class="message-container">
            <img class="avatar" src="${avatarUrl}" alt="Avatar">
            <div class="content">
                <div class="header">
                    <span class="username">${authorTag}</span>
                    <span class="timestamp">${fechaStr}</span>
                </div>
                <div class="text">${mensajeOriginal.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</div>
            </div>
        </div>
        <div class="watermark">
            EVIDENCIA DE SISTEMA | PANÓPTICO CLOUD INFRASTRUCTURE | ID: ${authorId}
        </div>
    </body>
    </html>`;
}

// 3. NÚCLEO DEL ANALIZADOR DE RAIDS
async function ejecutar(message, blacklistCollection) {
// (Dentro de async function ejecutar)
    const contenidoMensaje = message.content.toLowerCase();
    let alertaDisparada = false;
    let datosAlerta = null;

    // Escáner Analítico exclusivo para patrones Regex de Raids
    for (const regla of reglasAlertas) {
        // Ignora cualquier regla que no esté dirigida al Webhook de Raids
        if (regla.webhookDestino === "WEBHOOK_Raids") {
            const regexPatron = new RegExp(regla.patron, 'i');
            if (regexPatron.test(contenidoMensaje)) {
                alertaDisparada = true;
                datosAlerta = { idRegla: regla.id_regla, colorHex: regla.colorHex, webhookDestino: regla.webhookDestino };
                break;
            }
        }
    }

    if (!alertaDisparada) {
        for (const regla of reglasAlertas) {
            if (regla.webhookDestino === "WEBHOOK_Raids") {
                const regexPatron = new RegExp(regla.patron, 'i');
                if (regexPatron.test(contenidoMensaje)) {
                    alertaDisparada = true;
                    datosAlerta = { idRegla: regla.id_regla, colorHex: regla.colorHex, webhookDestino: regla.webhookDestino };
                    break;
                }
            }
        }
    }

    if (alertaDisparada && datosAlerta) {
        const urlWebhook = process.env[datosAlerta.webhookDestino];
        if (!urlWebhook) {
            console.error(`[ERROR] Variable de entorno ${datosAlerta.webhookDestino} inexistente.`);
            return true;
        }

        // Motor Avanzado de Inteligencia (CordCat API)
        let infoCordCat = "Procesando auditoría de riesgo...";
        try {
            const cordcatRes = await axios.get(`https://api.cordcat.com/v1/users/${message.author.id}`, {
                headers: { 'Authorization': `Bearer ${CORDCAT_API_KEY}` },
                timeout: 3500
            });
            
            // Mapeo profundo de datos basados en el Dashboard de CordCat
            const cordData = cordcatRes.data;
            const flags = cordData.flags ? `🚩 **Banderas:** ${cordData.flags}` : "✅ Sin banderas detectadas";
            const dsa = cordData.dsa_sanctions !== undefined ? `⚖️ **Sanciones DSA:** ${cordData.dsa_sanctions} entradas` : "⚖️ **Sanciones DSA:** No registradas";
            const riesgo = cordData.risk_evaluation ? `🛡️ **Riesgo:** ${cordData.risk_evaluation}` : "🛡️ **Riesgo:** Análisis Humano (Bajo)";
            const insignias = cordData.badges && cordData.badges.length > 0 ? `🎖️ **Placas:** ${cordData.badges.join(', ')}` : "🎖️ **Placas:** Ninguna";
            
            infoCordCat = `${flags}\n${riesgo}\n${dsa}\n${insignias}`;
        } catch (error) {
            infoCordCat = `⚠️ Base de datos externa inaccesible.\n🔗 [Ejecutar evaluación manual en panel CordCat](https://cord.cat/${message.author.id})`;
        }

        // Extracción Segura de Contexto (Límite estricto para evasión de ban)
        let contextoTxtData = `=========================================\nREPORTE DE CONTEXTO TÁCTICO\n=========================================\nSujeto: ${message.author.tag} (${message.author.id})\nFecha: ${new Date().toUTCString()}\n\n--- HISTORIAL RECIENTE DEL CANAL ---\n`;
        try {
            const mensajesPrevios = await message.channel.messages.fetch({ limit: 3, before: message.id });
            const mensajesOrdenados = mensajesPrevios.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
            mensajesOrdenados.forEach(msg => {
                contextoTxtData += `[${new Date(msg.createdTimestamp).toISOString().split('T')[1].slice(0,8)}] ${msg.author.tag}: ${msg.content}\n`;
            });
            contextoTxtData += `[${new Date(message.createdTimestamp).toISOString().split('T')[1].slice(0,8)}] ${message.author.tag} (🔥 INTERCEPTADO): ${message.content}\n`;
        } catch (e) {
            contextoTxtData += "Error de telemetría (Permisos insuficientes o canal privado).\n";
        }

        const creacionCuentaUnix = Math.floor(message.author.createdTimestamp / 1000);
        const opcionesFecha = { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' };
        const fechaIntercepcionES = new Date().toLocaleString('es-ES', opcionesFecha);
        const fechaMensajeOriginal = new Date(message.createdTimestamp).toLocaleString('es-ES', opcionesFecha);

        const nombreServidor = message.guild ? message.guild.name : 'Sector Privado (DM)';
        const idServidor = message.guild ? message.guild.id : 'N/A';
        const nombreCanal = message.channel.name ? message.channel.name : 'Canal Oculto';
        
        const avatarURL = message.author.displayAvatarURL({ format: 'png', dynamic: true, size: 256 });
        const mensajeCorto = message.content.length > 900 
            ? message.content.substring(0, 900) + '\n\n[... CONTENIDO EXTENSO TRUNCADO]' 
            : message.content;

        const panelForense = new MessageEmbed()
            .setColor(datosAlerta.colorHex)
            .setAuthor({ name: `Identidad Confirmada: ${message.author.tag}`, iconURL: avatarURL }) 
            .setTitle(`Registro de Actividad: ${datosAlerta.idRegla.toUpperCase()}`)
            .setDescription(`**Evidencia Interceptada:**\n\`\`\`text\n${mensajeCorto}\n\`\`\``)
            .setThumbnail(avatarURL) 
            .addFields(
                { name: '👤 Identificador Único (ID)', value: `\`${message.author.id}\``, inline: true },
                { name: '📅 Creación de la Cuenta', value: `<t:${creacionCuentaUnix}:R>`, inline: true },
                { name: '📍 Coordenada Espacial', value: `[Saltar al mensaje original](${message.url})`, inline: true },
                { name: '🌍 Zona de Impacto (Servidor)', value: `**${nombreServidor}**\n(\`${idServidor}\`)`, inline: true },
                { name: '📡 Vector de Ataque (Canal)', value: `**#${nombreCanal}**\n(\`${message.channel.id}\`)`, inline: true },
                { name: '🔎 Inteligencia de Amenazas (CordCat)', value: infoCordCat, inline: false }
            )
            .setFooter({ text: `Intercepción Confirmada (Hora Peninsular Española): ${fechaIntercepcionES}` });

        const htmlData = generarEvidenciaHTML(message.content, message.author.tag, message.author.id, avatarURL, fechaMensajeOriginal);

        try {
            const formData = new FormData();
            formData.append('payload_json', JSON.stringify({ embeds: [panelForense.toJSON()] }));
            const blobHTML = new Blob([htmlData], { type: 'text/html' });
            formData.append('files[0]', blobHTML, `EVIDENCIA_${message.author.id}.html`);
            const blobTXT = new Blob([contextoTxtData], { type: 'text/plain' });
            formData.append('files[1]', blobTXT, `CONTEXTO_${message.author.id}.txt`);

            const response = await fetch(urlWebhook, { method: 'POST', body: formData });
            if (!response.ok) throw new Error(`HTTP STATUS ${response.status}`);
        } catch (err) {
            console.error('[FALLO DE TRANSMISIÓN NATIVA]', err.message);
            try {
                const webhookEmergencia = new WebhookClient({ url: urlWebhook });
                await webhookEmergencia.send({ embeds: [panelForense] });
            } catch(e) {
                console.error('[COLAPSO TOTAL]', e.message);
            }
        }
        
        return true; 
    }

    return false;
}

module.exports = { ejecutar };
