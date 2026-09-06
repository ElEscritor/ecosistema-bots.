const { WebhookClient, MessageEmbed } = require('discord.js-selfbot-v13');
const fs = require('fs');
const database = require('./database.js'); // Conexión inyectada

const reglasAlertas = JSON.parse(fs.readFileSync('./reglas_alertas.json', 'utf8'));

async function ejecutar(message) {
    const contenidoMensaje = message.content.toLowerCase();
    let alertaDisparada = false;
    let datosAlerta = null;
    let casoIdGenerado = 'LNK_' + Math.random().toString(36).substring(2, 9).toUpperCase();

    for (const regla of reglasAlertas) {
        if (regla.webhookDestino === "WEBHOOK_Links") {
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

        const webhook = new WebhookClient({ url: urlWebhook });
        
        // Extraer enlace para renderizar la tarjeta en Discord
        const matchEnlace = message.content.match(/(https?:\/\/[^\s]+|discord\.gg\/[^\s]+)/i);
        const enlaceAislado = matchEnlace ? matchEnlace[0] : null;

        // FICHAJE DINÁMICO EN EXPEDIENTE
        const estadoBD = await database.ficharInfractor(message.author.id, message.author.tag, `Distribución de Links: ${datosAlerta.idRegla}`, datosAlerta.accionId);

        const avatarURL = message.author.displayAvatarURL({ format: 'png', dynamic: true, size: 256 });
        const panelForense = new MessageEmbed()
            .setColor(datosAlerta.colorHex)
            .setAuthor({ name: `ALERTA DE ENLACE: ${datosAlerta.idRegla.toUpperCase()}` })
            .setDescription(`**Contexto del mensaje:**\n${message.content.substring(0, 900)}`)
            .setThumbnail(avatarURL)
            .addFields(
                { name: '👤 Remitente', value: `**${message.author.tag}**\n\`${message.author.id}\``, inline: true },
                { name: '📍 Origen', value: `**Canal:** <#${message.channel.id}>`, inline: true },
                { name: '🛡️ Estado en BD', value: estadoBD, inline: false }
            )
            .setFooter({ text: `Caso: ${datosAlerta.accionId}` })
            .setTimestamp();

        // Construir la carga útil final aislando el enlace fuera del Embed
        const payload = { embeds: [panelForense] };
        if (enlaceAislado) {
            payload.content = `🔗 **Enlace detectado:** ${enlaceAislado}`; 
        }

        webhook.send(payload).catch(err => console.error('[FALLO LINKS]', err.message));
        return true;
    }
    return false;
}

module.exports = { ejecutar };
