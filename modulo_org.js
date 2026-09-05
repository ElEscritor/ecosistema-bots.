const { WebhookClient, MessageEmbed } = require('discord.js-selfbot-v13');
const fs = require('fs');

// Cargar solo las reglas (No necesitamos base de datos ni comandos aquí)
const reglasAlertas = JSON.parse(fs.readFileSync('./reglas_alertas.json', 'utf8'));

async function ejecutar(message) {
    const contenidoMensaje = message.content.toLowerCase();
    let alertaDisparada = false;
    let datosAlerta = null;

    // Escáner de Palabras Clave (Solo reglas asignadas a WEBHOOK_Org)
    for (const regla of reglasAlertas) {
        if (regla.webhookDestino === "WEBHOOK_Org") {
            const regexPatron = new RegExp(regla.patron, 'i');
            if (regexPatron.test(contenidoMensaje)) {
                alertaDisparada = true;
                datosAlerta = { idRegla: regla.id_regla, colorHex: regla.colorHex, webhookDestino: regla.webhookDestino };
                break;
            }
        }
    }

    if (alertaDisparada && datosAlerta) {
        const urlWebhook = process.env[datosAlerta.webhookDestino];
        if (!urlWebhook) return true; // Ignora silenciosamente si falta el webhook

        // Extraer un poco de contexto (los 2 mensajes anteriores)
        let contextoConversacion = "";
        try {
            const mensajesPrevios = await message.channel.messages.fetch({ limit: 2, before: message.id });
            const mensajesOrdenados = mensajesPrevios.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
            
            mensajesOrdenados.forEach(msg => {
                contextoConversacion += `[${msg.author.username}]: ${msg.content}\n`;
            });
        } catch (e) {
            contextoConversacion += "(No se pudo cargar el historial previo)\n";
        }
        // Añadir el mensaje exacto que detonó el radar
        contextoConversacion += `[${message.author.username}] (📌 MENCIÓN): ${message.content}`;

        // Limitar tamaño por si escribieron un testamento
        if (contextoConversacion.length > 2000) {
            contextoConversacion = contextoConversacion.substring(0, 1950) + '\n...[Texto truncado]';
        }

        const nombreServidor = message.guild ? message.guild.name : 'Mensaje Privado (DM)';
        const nombreCanal = message.channel.name ? message.channel.name : 'oculto';
        const avatarURL = message.author.displayAvatarURL({ format: 'png', dynamic: true, size: 128 });

        // Diseño Minimalista y Funcional (Tonos neutros/informativos)
        const panelRadar = new MessageEmbed()
            .setColor(datosAlerta.colorHex || '#3498db') // Usa el color del JSON o azul por defecto
            .setAuthor({ name: message.author.tag, iconURL: avatarURL })
            .setTitle(`📡 Rastreo de Palabra Clave: ${datosAlerta.idRegla}`)
            .setDescription(`**Contexto de la conversación:**\n\`\`\`text\n${contextoConversacion}\n\`\`\``)
            .addFields(
                { name: '👤 Usuario', value: `\`${message.author.id}\``, inline: true },
                { name: '📍 Servidor', value: `**${nombreServidor}**\n(\`${message.guild ? message.guild.id : 'N/A'}\`)`, inline: true },
                { name: '💬 Ubicación', value: `**#${nombreCanal}**\n[Ir al mensaje](${message.url})`, inline: true }
            )
            .setTimestamp(); // Pone la hora exacta automáticamente abajo

        try {
            const webhook = new WebhookClient({ url: urlWebhook });
            await webhook.send({ embeds: [panelRadar] });
        } catch (err) {
            console.error('[FALLO RED ORG]', err.message);
        }
        
        return true; 
    }

    return false;
}

module.exports = { ejecutar };
