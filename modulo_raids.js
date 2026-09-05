const { WebhookClient, MessageEmbed } = require('discord.js-selfbot-v13');
const fs = require('fs');
const axios = require('axios'); // Motor de peticiones HTTP para auditoría externa

// 1. CARGA DE CONFIGURACIÓN ESTÁTICA Y CREDENCIALES
const comandosSquads = JSON.parse(fs.readFileSync('./comandos_squads.json', 'utf8'));
const reglasAlertas = JSON.parse(fs.readFileSync('./reglas_alertas.json', 'utf8'));
const CORDCAT_API_KEY = "cc_c67695eac3f8b0fc7b83db00075086e016f0ce9f55b688142";

// 2. MOTOR DE RENDERIZADO FORENSE HTML (Simulación de Captura UI Discord)
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
            REGISTRO FORENSE ENCRIPTADO | ID SUJETO: ${authorId} | PANÓPTICO CLOUD INFRASTRUCTURE
        </div>
    </body>
    </html>`;
}

// 3. NÚCLEO DEL ANALIZADOR DE RAIDS
async function ejecutar(message, blacklistCollection) {
    const contenidoMensaje = message.content.toLowerCase();
    let alertaDisparada = false;
    let datosAlerta = null;

    // Escáner de Comandos Estrictos
    for (const cmd of comandosSquads) {
        if (cmd.webhookDestino === "WEBHOOK_Raids" && contenidoMensaje.startsWith(cmd.comando.toLowerCase())) {
            alertaDisparada = true;
            datosAlerta = { idRegla: cmd.comando, colorHex: cmd.colorHex, webhookDestino: cmd.webhookDestino };
            break;
        }
    }

    // Escáner Analítico por Expresiones Regulares
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
            console.error(`[ERROR FATAL] Variable de entorno ${datosAlerta.webhookDestino} inexistente.`);
            return true;
        }
        
        const webhook = new WebhookClient({ url: urlWebhook });

        // Extracción de Inteligencia de Terceros (CordCat API)
        let infoCordCat = "Procesando auditoría de riesgo...";
        try {
            const cordcatRes = await axios.get(`https://api.cordcat.com/v1/users/${message.author.id}`, {
                headers: { 'Authorization': `Bearer ${CORDCAT_API_KEY}` },
                timeout: 2500
            });
            infoCordCat = cordcatRes.data.flags 
                ? `🚩 Alerta de Banderas: ${cordcatRes.data.flags}` 
                : "✅ Perfil verificado sin banderas de riesgo";
        } catch (error) {
            infoCordCat = `⚠️ Error de API. Cotejo manual requerido:\nhttps://cordcat.com/user/${message.author.id}`;
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
            ? message.content.substring(0, 900) + '\n\n[... TEXTO TRUNCADO - VER CAPTURA HTML]' 
            : message.content;

        // Estructuración del Panel Visual (Embed)
        const panelForense = new MessageEmbed()
            .setColor(datosAlerta.colorHex)
            .setAuthor({ name: `${message.author.tag}`, iconURL: avatarURL }) // Identidad visual superior
            .setTitle(`🚨 Detección de Alusión a Raid`)
            .setDescription(`**Carga Útil Interceptada:**\n\`\`\`text\n${mensajeCorto}\n\`\`\``)
            .setThumbnail(avatarURL) // Proyección del Avatar en el flanco derecho
            .addFields(
                { name: '👤 Identificador de Sujeto', value: `\`${message.author.id}\``, inline: true },
                { name: '📅 Origen de la Cuenta', value: `<t:${creacionCuentaUnix}:F>`, inline: true },
                { name: '🆔 Coordenada de Mensaje', value: `[Ir al mensaje](${message.url}) (\`${message.id}\`)`, inline: true },
                { name: '📍 Vector de Ataque (Canal)', value: `**#${nombreCanal}**\n(\`${message.channel.id}\`)`, inline: true },
                { name: '🌍 Zona de Impacto (Servidor)', value: `**${nombreServidor}**\n(\`${idServidor}\`)`, inline: true },
                { name: '🔎 Inteligencia de Amenazas (CordCat)', value: infoCordCat, inline: false }
            )
            .setFooter({ text: `Intercepción Confirmada (Hora Peninsular Española): ${fechaIntercepcionES}` });

        // Compilación y Empaquetado del Archivo HTML
        const htmlData = generarEvidenciaHTML(message.content, message.author.tag, message.author.id, avatarURL, fechaMensajeOriginal);
        
        // Empaquetado seguro en formato de objeto plano para el WebhookClient
        const capturaHTML = {
            attachment: Buffer.from(htmlData, 'utf-8'),
            name: `EVIDENCIA_FORENSE_${message.author.id}.html`
        };

        // Bloque de Transmisión Tolerante a Fallos
        try {
            await webhook.send({ 
                embeds: [panelForense],
                files: [capturaHTML] 
            });
        } catch (err) {
            console.error('[FALLO RED WEBOOK] Transmisión con adjuntos rechazada. Ejecutando envío degradado.', err.message);
            // Protocolo de seguridad: Si Discord rechaza el HTML, se fuerza el envío del panel textual.
            try {
                await webhook.send({ embeds: [panelForense] });
            } catch(e) {
                console.error('[COLAPSO TOTAL DE TRANSMISIÓN]', e.message);
            }
        }
        
        return true; 
    }

    return false;
}

module.exports = { ejecutar };
