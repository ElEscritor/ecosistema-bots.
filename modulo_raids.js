const { WebhookClient, MessageEmbed } = require('discord.js-selfbot-v13');
const fs = require('fs');

// Cargar listas estáticas
const comandosSquads = JSON.parse(fs.readFileSync('./comandos_squads.json', 'utf8'));
const reglasAlertas = JSON.parse(fs.readFileSync('./reglas_alertas.json', 'utf8'));

async function ejecutar(message, blacklistCollection) {
    const contenidoMensaje = message.content.toLowerCase();
    let alertaDisparada = false;
    let datosAlerta = null;
    let casoIdGenerado = 'CASO_' + Math.random().toString(36).substring(2, 9).toUpperCase();

    // 1. Detección de Comandos (Solo los dirigidos al Webhook de Raids)
    for (const cmd of comandosSquads) {
        if (cmd.webhookDestino === "WEBHOOK_Raids" && contenidoMensaje.startsWith(cmd.comando.toLowerCase())) {
            alertaDisparada = true;
            
            let estadoBanXN = "Base de datos inactiva";
            if (blacklistCollection) {
                const usuarioYaFichado = await blacklistCollection.findOne({ userId: message.author.id });
                if (!usuarioYaFichado) {
                    const nuevoFichaje = {
                        userId: message.author.id,
                        nombreUsuario: message.author.tag,
                        accion: `Comando Raid: ${cmd.comando}`,
                        fechaFichaje: new Date().toISOString().split('T')[0],
                        casoId: casoIdGenerado
                    };
                    await blacklistCollection.insertOne(nuevoFichaje);
                    estadoBanXN = "Nuevo ingreso en MongoDB [🟨]";
                } else {
                    estadoBanXN = "Infractor reincidente [🟥]";
                }
            }
            
            datosAlerta = { idRegla: cmd.comando, colorHex: cmd.colorHex, webhookDestino: cmd.webhookDestino, estadoBD: estadoBanXN, accionId: casoIdGenerado };
            break;
        }
    }

    // 2. Detección por Regex (Solo reglas de Raids)
    if (!alertaDisparada) {
        for (const regla of reglasAlertas) {
            if (regla.webhookDestino === "WEBHOOK_Raids") {
                const regexPatron = new RegExp(regla.patron, 'i');
                if (regexPatron.test(contenidoMensaje)) {
                    alertaDisparada = true;
                    datosAlerta = { idRegla: regla.id_regla, colorHex: regla.colorHex, webhookDestino: regla.webhookDestino, estadoBD: "Intercepción por patrón", accionId: casoIdGenerado };
                    break;
                }
            }
        }
    }

    // 3. Envío al Webhook si hubo detección
    if (alertaDisparada && datosAlerta) {
        const urlWebhook = process.env[datosAlerta.webhookDestino];
        if (!urlWebhook) {
            console.log(`[ERROR] Falta variable ${datosAlerta.webhookDestino} en Render.`);
            return true; // Retorna true para que index.js sepa que procesó (aunque fallara el envío)
        }

        const webhook = new WebhookClient({ url: urlWebhook });
        const mensajeCorto = message.content.length > 1000 ? message.content.substring(0, 1000) + '...' : message.content;

        const panelForense = new MessageEmbed()
            .setColor(datosAlerta.colorHex)
            .setAuthor({ name: `INFRACCIÓN: ${datosAlerta.idRegla.toUpperCase()}`, iconURL: 'https://cdn-icons-png.flaticon.com/512/573/573389.png' })
            .setDescription(`**Evidencia Interceptada:**\n\`\`\`\n${mensajeCorto}\n\`\`\``)
            .addFields(
                { name: '👤 Sospechoso', value: `**${message.author.tag}**\n\`${message.author.id}\``, inline: true },
                { name: '📍 Origen', value: `**Canal:** <#${message.channel.id}>`, inline: true },
                { name: '🛡️ Estado Base de Datos', value: datosAlerta.estadoBD, inline: false }
            )
            .setFooter({ text: `Caso: ${datosAlerta.accionId}` })
            .setTimestamp();

        webhook.send({ embeds: [panelForense] }).catch(err => console.error('[FALLO RED]', err.message));
        return true; // Indica que este módulo atrapó al raider
    }

    return false; // No era un raid. Pasa el mensaje al siguiente módulo.
}

module.exports = { ejecutar };
