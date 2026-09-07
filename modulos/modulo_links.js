const { MessageEmbed } = require('discord.js-selfbot-v13');
const fs = require('fs');
const path = require('path');

const database = require('../database.js'); 
const transmisor = require('../web/transmisor.js');

const reglasPath = path.join(__dirname, '../reglas_alertas.json');
const reglasAlertas = JSON.parse(fs.readFileSync(reglasPath, 'utf8'));

async function ejecutar(message) { // Links no usa el historialCache para evitar pesadez innecesaria
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
        
        const matchEnlace = message.content.match(/(https?:\/\/[^\s]+|discord\.gg\/[^\s]+)/i);
        const enlaceAislado = matchEnlace ? matchEnlace[0] : null;
        const servidorOrigen = message.guild ? message.guild.name : 'Sector Privado (DM)';

        const estadoBD = await database.ficharInfractor(
            message.author.id, 
            message.author.tag, 
            `Distribución de Links: ${datosAlerta.idRegla}`, 
            datosAlerta.accionId,
            message.content,
            servidorOrigen
        );

        const avatarURL = message.author.displayAvatarURL({ format: 'png', dynamic: true, size: 256 });
        const panelForense = new MessageEmbed()
            .setColor(datosAlerta.colorHex)
            .setAuthor({ name: `DETECCIÓN DE ENLACE: ${datosAlerta.idRegla.toUpperCase()}` })
            .setDescription(`**Promoción Analizada:**\n${message.content.substring(0, 900)}`)
            .setThumbnail(avatarURL)
            .addFields(
                { name: '👤 Remitente', value: `**${message.author.tag}**\n\`${message.author.id}\``, inline: true },
                { name: '📍 Nodo Origen', value: `**${servidorOrigen}**\n<#${message.channel.id}>`, inline: true },
                { name: '🛡️ Estado en La Biblioteca', value: estadoBD, inline: false }
            )
            .setFooter({ text: `Expediente: ${datosAlerta.accionId}` })
            .setTimestamp();

        const contenido = enlaceAislado ? `🔗 **URL Aislada:** ${enlaceAislado}` : null;
        
        await transmisor.enviarWebhook(urlWebhook, panelForense.toJSON(), contenido, []);
        return true;
    }
    return false;
}

module.exports = { ejecutar };
