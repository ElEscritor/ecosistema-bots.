const { WebhookClient, MessageEmbed } = require('discord.js-selfbot-v13');
const fs = require('fs');

const reglasAlertas = JSON.parse(fs.readFileSync('./reglas_alertas.json', 'utf8'));

async function ejecutar(message, blacklistCollection) {
    const contenidoMensaje = message.content.toLowerCase();
    let alertaDisparada = false;
    let datosAlerta = null;
    let casoIdGenerado = 'LNK_' + Math.random().toString(36).substring(2, 9).toUpperCase();

    // 1. Escáner de enlaces
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

        // 2. Extraer el enlace exacto (aislarlo del resto del texto)
        const matchEnlace = message.content.match(/(https?:\/\/[^\s]+|discord\.gg\/[^\s]+)/i);
        const enlaceAislado = matchEnlace ? matchEnlace[0] : null;

        // 3. Fichaje en MongoDB
        let estadoBanXN = "Base de datos inactiva";
        if (blacklistCollection) {
            const usuarioYaFichado = await blacklistCollection.findOne({ userId: message.author.id });
            if (!usuarioYaFichado) {
                await blacklistCollection.insertOne({
                    userId: message.author.id, 
                    nombreUsuario: message.author.tag,
                    accion: `Spam de enlaces`, 
                    fechaFichaje: new Date().toISOString().split('T')[0]
                });
                estadoBanXN = "Nuevo ingreso [🟨]";
            } else {
                estadoBanXN = "Infractor reincidente [🟥]";
            }
        }

        // 4. Panel visual limpio (sin el enlace, solo con el contexto)
        const avatarURL = message.author.displayAvatarURL({ format: 'png', dynamic: true, size: 256 });
        const panelForense = new MessageEmbed()
            .setColor(datosAlerta.colorHex)
            .setAuthor({ name: `ALERTA DE ENLACE: ${datosAlerta.idRegla.toUpperCase()}` })
            .setDescription(`**Contexto del mensaje:**\n${message.content}`)
            .setThumbnail(avatarURL)
            .addFields(
                { name: '👤 Remitente', value: `**${message.author.tag}**\n\`${message.author.id}\``, inline: true },
                { name: '📍 Origen', value: `**Canal:** <#${message.channel.id}>`, inline: true },
                { name: '🛡️ Estado en BD', value: estadoBanXN, inline: false }
            )
            .setFooter({ text: `Caso: ${datosAlerta.accionId}` })
            .setTimestamp();

        // 5. EL TRUCO: Construir el mensaje final
        const payload = { embeds: [panelForense] };
        
        // Si atrapamos un enlace, lo ponemos fuera del Embed para que Discord cargue la preview de la invitación
        if (enlaceAislado) {
            payload.content = `🔗 **Enlace detectado:** ${enlaceAislado}`; 
        }

        webhook.send(payload).catch(err => console.error('[FALLO LINKS]', err.message));
        return true;
    }
    return false;
}

module.exports = { ejecutar };
