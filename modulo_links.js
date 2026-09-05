const { WebhookClient, MessageEmbed } = require('discord.js-selfbot-v13');
const fs = require('fs');

const reglasAlertas = JSON.parse(fs.readFileSync('./reglas_alertas.json', 'utf8'));

async function ejecutar(message, blacklistCollection) {
    const contenidoMensaje = message.content.toLowerCase();
    let alertaDisparada = false;
    let datosAlerta = null;
    let casoIdGenerado = 'LNK_' + Math.random().toString(36).substring(2, 9).toUpperCase();

    // 1. Escáner de reglas enfocadas a enlaces/invitaciones
    for (const regla of reglasAlertas) {
        if (regla.id_regla.includes("enlace") || regla.id_regla.includes("invitacion") || regla.webhookDestino.includes("WEBHOOK_Links")) {
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

    // 2. Ejecución y Notificación
    if (alertaDisparada && datosAlerta) {
        
        // Soporte Híbrido: Permite URL directa (http...) o Variable de Entorno
        let urlWebhook = datosAlerta.webhookDestino.startsWith('http') 
            ? datosAlerta.webhookDestino 
            : process.env[datosAlerta.webhookDestino];

        if (!urlWebhook) {
            console.log(`[ERROR ENLACES] No se encontró el Webhook: ${datosAlerta.webhookDestino}`);
            return true; // Retorna true para abortar ciclo en index.js
        }

        const webhook = new WebhookClient({ url: urlWebhook });
        
        // Extractor específico para destacar el enlace en el panel
        const matchEnlace = message.content.match(/(https?:\/\/[^\s]+|discord\.gg\/[^\s]+)/i);
        const enlaceAislado = matchEnlace ? matchEnlace[0] : "Enlace oculto detectado";
        
        // Fichaje en MongoDB por Spam
        let estadoBanXN = "Error de conexión BD";
        if (blacklistCollection) {
            const usuarioYaFichado = await blacklistCollection.findOne({ userId: message.author.id });
            if (!usuarioYaFichado) {
                await blacklistCollection.insertOne({
                    userId: message.author.id,
                    nombreUsuario: message.author.tag,
                    accion: `Spam de enlaces detectado`,
                    fechaFichaje: new Date().toISOString().split('T')[0],
                    casoId: casoIdGenerado
                });
                estadoBanXN = "Nuevo ingreso por Enlaces [🟨]";
            } else {
                estadoBanXN = "Infractor reincidente [🟥]";
            }
        }

        const panelForense = new MessageEmbed()
            .setColor(datosAlerta.colorHex)
            .setAuthor({ name: `ALERTA DE ENLACE: ${datosAlerta.idRegla.toUpperCase()}`, iconURL: 'https://cdn-icons-png.flaticon.com/512/281/281769.png' })
            .setDescription(`**Enlace Aislado:**\n\`\`\`\n${enlaceAislado}\n\`\`\`\n**Contexto:**\n${message.content.length > 500 ? message.content.substring(0,500) + '...' : message.content}`)
            .addFields(
                { name: '👤 Remitente', value: `**${message.author.tag}**\n\`${message.author.id}\``, inline: true },
                { name: '📍 Origen', value: `**Canal:** <#${message.channel.id}>`, inline: true },
                { name: '🛡️ Estado Base de Datos', value: estadoBanXN, inline: false }
            )
            .setFooter({ text: `Caso: ${datosAlerta.accionId}` })
            .setTimestamp();

        webhook.send({ embeds: [panelForense] }).catch(err => console.error('[FALLO RED LINKS]', err.message));
        return true; 
    }

    return false; // No hay enlaces, sigue al próximo analizador
}

module.exports = { ejecutar };
