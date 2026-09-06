const { WebhookClient, MessageEmbed } = require('discord.js-selfbot-v13');
const fs = require('fs');

const reglasAlertas = JSON.parse(fs.readFileSync('./reglas_alertas.json', 'utf8'));

async function ejecutar(message) {
    const contenidoMensaje = message.content.toLowerCase();
    let mencionesDetectadas = [];
    let datosAlerta = null;

    // 1. Escáner Analítico de Palabras Clave
    for (const regla of reglasAlertas) {
        if (regla.webhookDestino === "WEBHOOK_Org") {
            // El modificador 'gi' busca de forma global sin importar mayúsculas/minúsculas
            const regexPatron = new RegExp(regla.patron, 'gi');
            const coincidencias = contenidoMensaje.match(regexPatron);

            if (coincidencias && coincidencias.length > 0) {
                // Filtramos duplicados (ej. si dice "rz" dos veces, solo lo marcamos una)
                mencionesDetectadas = [...new Set(coincidencias.map(p => p.toLowerCase()))];
                datosAlerta = { 
                    idRegla: regla.id_regla, 
                    colorHex: regla.colorHex, 
                    webhookDestino: regla.webhookDestino 
                };
                break; 
            }
        }
    }

    // 2. Procesamiento y Transmisión
    if (mencionesDetectadas.length > 0 && datosAlerta) {
        const urlWebhook = process.env[datosAlerta.webhookDestino];
        if (!urlWebhook) {
            console.error(`[ERROR] Variable de entorno ${datosAlerta.webhookDestino} no configurada.`);
            return true;
        }

        const webhook = new WebhookClient({ url: urlWebhook });

        // 3. Extracción del Micro-Historial
        let contextoDialogo = "";
        try {
            // Recuperamos los 2 mensajes anteriores
            const historial = await message.channel.messages.fetch({ limit: 2, before: message.id });
            const ordenados = historial.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
            
            ordenados.forEach(msg => {
                const nombreLimpio = msg.author.username.replace(/_/g, '\\_');
                contextoDialogo += `**${nombreLimpio}**: ${msg.content}\n`;
            });
        } catch (e) {
            // Si no hay permisos de lectura de historial, el bot se mantiene en silencio y sigue operando
        }
        
        // Añadimos el mensaje actual detectado
        const autorLimpio = message.author.username.replace(/_/g, '\\_');
        contextoDialogo += `**${autorLimpio}**: ${message.content} 🎯`;

        // 4. Formateo Visual
        const creacionCuentaUnix = Math.floor(message.author.createdTimestamp / 1000);
        const avatarURL = message.author.displayAvatarURL({ format: 'png', dynamic: true, size: 128 });
        
        const nombreServidor = message.guild ? message.guild.name : 'Sector Privado (DM)';
        
        const panelObservacion = new MessageEmbed()
            .setColor(datosAlerta.colorHex || '#3498db') 
            .setAuthor({ name: `Radar de Organización: ${message.author.tag}`, iconURL: avatarURL })
            .setDescription(`Se ha detectado mención a: **${mencionesDetectadas.join(', ')}**\n\n**Transcripción del Diálogo:**\n> ${contextoDialogo.replace(/\n/g, '\n> ')}`)
            .addFields(
                { name: '👤 ID Sujeto', value: `\`${message.author.id}\``, inline: true },
                { name: '📅 Registro', value: `<t:${creacionCuentaUnix}:R>`, inline: true },
                { name: '📍 Coordenada', value: `[Saltar al mensaje](${message.url})`, inline: true },
                { name: '🌍 Servidor', value: `**${nombreServidor}**`, inline: true },
                { name: '📡 Canal', value: `**<#${message.channel.id}>**`, inline: true }
            )
            .setFooter({ text: `ID: ${message.author.id} • Monitoreo Pasivo` })
            .setTimestamp();

        // 5. Transmisión nativa limpia (Sin FormData, sin fallos)
        webhook.send({ embeds: [panelObservacion] }).catch(err => console.error('[FALLO RED ORG]', err.message));
        
        return true; 
    }

    return false;
}

module.exports = { ejecutar };
