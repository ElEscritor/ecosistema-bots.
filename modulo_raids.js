const { WebhookClient, MessageEmbed } = require('discord.js-selfbot-v13');
const fs = require('fs');
const axios = require('axios');

// 1. CARGA DE CONFIGURACIÓN ESTÁTICA Y CREDENCIALES
const comandosSquads = JSON.parse(fs.readFileSync('./comandos_squads.json', 'utf8'));
const reglasAlertas = JSON.parse(fs.readFileSync('./reglas_alertas.json', 'utf8'));
const CORDCAT_API_KEY = "cc_c67695eac3f8b0fc7b83db00075086e016f0ce9f55b68814"; 

// 2. MOTOR DE RENDERIZADO FORENSE HTML
function generarEvidenciaHTML(mensajeOriginal, authorTag, authorId, avatarUrl, fechaStr) {
    return `
    <!DOCTYPE html>
    <html lang="es">
    <head>
        <meta charset="UTF-8">
        <style>
            @import url('https://fonts.googleapis.com/css2?family=gg+sans:wght@400;500;600&display=swap');
            body { background-color: #313338; color: #dbdee1; font-family: 'gg sans', 'Helvetica Neue', Helvetica, Arial, sans-serif; padding: 25px; margin: 0; }
            .message-container { display: flex; margin-bottom: 16px; border-left: 4px solid #ed4245; padding-left: 10px; background: rgba(237, 66, 69, 0.05); padding-top: 10px; padding-bottom: 10px; border-radius: 4px; }
            .avatar { width: 40px; height: 40px; border-radius: 50%; margin-right: 16px; margin-top: 2px; }
            .content { display: flex; flex-direction: column; }
            .header { display: flex; align-items: baseline; margin-bottom: 4px; }
            .username { color: #f2f3f5; font-weight: 500; font-size: 16px; margin-right: 8px; }
            .timestamp { color: #949ba4; font-size: 12px; font-weight: 400; }
            .text { font-size: 16px; line-height: 1.375rem; white-space: pre-wrap; word-break: break-word; }
            .watermark { margin-top: 30px; padding-top: 15px; border-top: 1px solid #3f4147; color: #80848e; font-size: 11px; letter-spacing: 0.5px; }
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
            REGISTRO FORENSE | ID SUJETO: ${authorId} | PANÓPTICO CLOUD INFRASTRUCTURE
        </div>
    </body>
    </html>`;
}

// 3. NÚCLEO DEL ANALIZADOR DE RAIDS
async function ejecutar(message, blacklistCollection) {
    const contenidoMensaje = message.content.toLowerCase();
    let alertaDisparada = false;
    let datosAlerta = null;

    // Escáner de Comandos
    for (const cmd of comandosSquads) {
        if (cmd.webhookDestino === "WEBHOOK_Raids" && contenidoMensaje.startsWith(cmd.comando.toLowerCase())) {
            alertaDisparada = true;
            datosAlerta = { idRegla: cmd.comando, colorHex: cmd.colorHex, webhookDestino: cmd.webhookDestino };
            break;
        }
    }

    // Escáner Analítico por Regex
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

    // Protocolo de Ensamblaje y Transmisión
    if (alertaDisparada && datosAlerta) {
        const urlWebhook = process.env[datosAlerta.webhookDestino];
        if (!urlWebhook) {
            console.error(`[ERROR] Variable de entorno ${datosAlerta.webhookDestino} inexistente.`);
            return true;
        }

        // Extracción de Inteligencia de Terceros (CordCat API)
        let infoCordCat = "Procesando auditoría...";
        try {
            const cordcatRes = await axios.get(`https://cord.cat/api/v1/user/${message.author.id}`, {
                headers: { 'Authorization': `Bearer ${CORDCAT_API_KEY}` },
                timeout: 3000
            });
            infoCordCat = cordcatRes.data.flags 
                ? `🚩 Alerta de Banderas: ${cordcatRes.data.flags}` 
                : "✅ Perfil verificado sin banderas";
        } catch (error) {
            infoCordCat = `⚠️ Error de API. Cotejo manual: [Ver Perfil en CordCat](https://cord.cat/user/${message.author.id})`;
        }

        // Extracción de Contexto para el archivo TXT (Últimos 3 mensajes)
        let contextoTxtData = `=========================================\nREPORTE DE CONTEXTO TÁCTICO\n=========================================\nSujeto: ${message.author.tag} (${message.author.id})\nFecha: ${new Date().toUTCString()}\n\n--- HISTORIAL RECIENTE DEL CANAL ---\n`;
        try {
            const mensajesPrevios = await message.channel.messages.fetch({ limit: 3, before: message.id });
            const mensajesOrdenados = mensajesPrevios.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
            mensajesOrdenados.forEach(msg => {
                contextoTxtData += `[${new Date(msg.createdTimestamp).toISOString().split('T')[1].slice(0,8)}] ${msg.author.tag}: ${msg.content}\n`;
            });
            contextoTxtData += `[${new Date(message.createdTimestamp).toISOString().split('T')[1].slice(0,8)}] ${message.author.tag} (🔥 INTERCEPTADO): ${message.content}\n`;
        } catch (e) {
            contextoTxtData += "Error al extraer historial (Posible falta de permisos o DM cerrado).\n";
        }

        // Procesamiento de Fechas (Formato Europeo / Madrid)
        const creacionCuentaUnix = Math.floor(message.author.createdTimestamp / 1000);
        const opcionesFecha = { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' };
        const fechaIntercepcionES = new Date().toLocaleString('es-ES', opcionesFecha);
        const fechaMensajeOriginal = new Date(message.createdTimestamp).toLocaleString('es-ES', opcionesFecha);

        // Coordenadas Espaciales
        const nombreServidor = message.guild ? message.guild.name : 'Sector Privado (DM)';
        const idServidor = message.guild ? message.guild.id : 'N/A';
        const nombreCanal = message.channel.name ? message.channel.name : 'Canal Oculto';
        
        const avatarURL = message.author.displayAvatarURL({ format: 'png', dynamic: true, size: 256 });
        const mensajeCorto = message.content.length > 900 
            ? message.content.substring(0, 900) + '\n\n[... TEXTO TRUNCADO]' 
            : message.content;

        // Estructuración del Panel Visual Optimizada
        const panelForense = new MessageEmbed()
            .setColor(datosAlerta.colorHex)
            .setAuthor({ name: `${message.author.tag}`, iconURL: avatarURL }) 
            .setTitle(`🚨 Detección de Alusión a Raid`)
            .setDescription(`**Evidencia Interceptada:**\n\`\`\`text\n${mensajeCorto}\n\`\`\``)
            .setThumbnail(avatarURL) 
            .addFields(
                { name: '👤 Identidad del Sujeto', value: `**Usuario:** ${message.author.tag}\n**ID:** \`${message.author.id}\`\n**Cuenta Creada:** <t:${creacionCuentaUnix}:R>`, inline: true },
                { name: '📍 Coordenadas de Impacto', value: `**Servidor:** ${nombreServidor} (\`${idServidor}\`)\n**Canal:** #${nombreCanal} (\`${message.channel.id}\`)\n**Vínculo:** [Saltar al mensaje original](${message.url})`, inline: true },
                { name: '🔎 Inteligencia de Amenazas (CordCat)', value: infoCordCat, inline: false }
            )
            .setFooter({ text: `Fecha de Intercepción: ${fechaIntercepcionES} (Hora España)` });

        // Compilación de Evidencia HTML
        const htmlData = generarEvidenciaHTML(message.content, message.author.tag, message.author.id, avatarURL, fechaMensajeOriginal);

        // --- BYPASS DE TRANSMISIÓN NATIVA (NODE.JS 24+ FETCH API) ---
        try {
            // Construcción del límite multipart/form-data puro
            const formData = new FormData();
            
            // Inyección del Embed serializado
            formData.append('payload_json', JSON.stringify({ 
                embeds: [panelForense.toJSON()] 
            }));
            
            // Inyección del búfer de memoria HTML disfrazado de archivo (Blob)
            const blobHTML = new Blob([htmlData], { type: 'text/html' });
            formData.append('files[0]', blobHTML, `EVIDENCIA_FORENSE_${message.author.id}.html`);
            
            // Inyección del búfer de memoria TXT disfrazado de archivo (Blob)
            const blobTXT = new Blob([contextoTxtData], { type: 'text/plain' });
            formData.append('files[1]', blobTXT, `CONTEXTO_TACTICO_${message.author.id}.txt`);

            // Disparo del payload HTTP mediante Fetch crudo
            const response = await fetch(urlWebhook, {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                throw new Error(`Discord API rechazó la carga nativa: STATUS ${response.status}`);
            }

        } catch (err) {
            console.error('[FALLO RED NATIVO] La red rechazó el FormData puro. Forzando modo de degradación seguro.', err.message);
            // Protocolo de contingencia: Si incluso el Fetch falla, se emplea WebhookClient sin archivos para asegurar la alerta.
            try {
                const webhookEmergencia = new WebhookClient({ url: urlWebhook });
                await webhookEmergencia.send({ embeds: [panelForense] });
            } catch(e) {
                console.error('[COLAPSO TOTAL DE ALERTA]', e.message);
            }
        }
        
        return true; 
    }

    return false;
}

module.exports = { ejecutar };
