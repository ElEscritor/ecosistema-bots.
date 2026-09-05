const { WebhookClient, MessageEmbed } = require('discord.js-selfbot-v13');
const fs = require('fs');

const reglasAlertas = JSON.parse(fs.readFileSync('./reglas_alertas.json', 'utf8'));

async function ejecutar(message, blacklistCollection) {
    const contenidoMensaje = message.content.toLowerCase();
    let alertaDisparada = false;
    let datosAlerta = null;
    let casoIdGenerado = 'ORG_' + Math.random().toString(36).substring(2, 9).toUpperCase();

    // 1. Escáner de Menciones a Aliados / Organización
    for (const regla of reglasAlertas) {
        if (regla.webhookDestino === "WEBHOOK_Org") {
            const regexPatron = new RegExp(regla.patron, 'i');
            if (regexPatron.test(contenidoMensaje)) {
                alertaDisparada = true;
                datosAlerta = { 
                    idRegla: regla.id_regla, 
                    colorHex: regla.colorHex, 
                    webhookDestino: regla.webhookDestino, 
                    accionId: casoIdGenerado 
                };
                break;
            }
        }
    }

    // 2. Ejecución y Notificación de Inteligencia
    if (alertaDisparada && datosAlerta) {
        
        // Soporte de enlace directo o variable de entorno
        let urlWebhook = datosAlerta.webhookDestino.startsWith('http') 
            ? datosAlerta.webhookDestino 
            : process.env[datosAlerta.webhookDestino];

        if (!urlWebhook) {
            console.log(`[ERROR ORG] No se encontró el Webhook: ${datosAlerta.webhookDestino}`);
            return true; 
        }

        const webhook = new WebhookClient({ url: urlWebhook });
        
        // Verificación de Antecedentes (Solo lectura, no fichamos por mencionar)
        let estadoBanXN = "Error de conexión BD";
        if (blacklistCollection) {
            const usuarioFichado = await blacklistCollection.findOne({ userId: message.author.id });
            if (usuarioFichado) {
                estadoBanXN = `⚠️ ALERTA ROJA: Raider conocido hablando de la Org (${usuarioFichado.accion})`;
            } else {
                estadoBanXN = "Sujeto limpio (Sin antecedentes penales en BD)";
            }
        }

        const mensajeCorto = message.content.length > 1000 
            ? message.content.substring(0, 1000) + '...' 
            : message.content;

        const panelForense = new MessageEmbed()
            .setColor(datosAlerta.colorHex)
            .setAuthor({ name: `INTELIGENCIA: ${datosAlerta.idRegla.toUpperCase()}`, iconURL: 'https://cdn-icons-png.flaticon.com/512/3260/3260143.png' })
            .setDescription(`**Intercepción de Comunicaciones:**\n\`\`\`\n${mensajeCorto}\n\`\`\``)
            .addFields(
                { name: '🗣️ Sujeto Identificado', value: `**${message.author.tag}**\n\`${message.author.id}\``, inline: true },
                { name: '📍 Coordenadas', value: `**Canal:** <#${message.channel.id}>`, inline: true },
                { name: '🛡️ Cotejo con Base de Datos', value: estadoBanXN, inline: false }
            )
            .setFooter({ text: `Rastreo ID: ${datosAlerta.accionId}` })
            .setTimestamp();

        webhook.send({ embeds: [panelForense] }).catch(err => console.error('[FALLO RED ORG]', err.message));
        return true; 
    }

    return false; // Continúa si quieres añadir más módulos en el futuro
}

module.exports = { ejecutar };
