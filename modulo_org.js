const { WebhookClient, MessageEmbed } = require('discord.js-selfbot-v13');
const fs = require('fs');
const database = require('./database.js');

// Carga de la matriz de palabras clave
const reglasAlertas = JSON.parse(fs.readFileSync('./reglas_alertas.json', 'utf8'));

async function ejecutar(message) {
    const contenidoMensaje = message.content.toLowerCase();
    let mencionesDetectadas = [];
    let datosAlerta = null;

    // 1. Escáner de Palabras Clave (Optimizado para lectura rápida)
    for (const regla of reglasAlertas) {
        if (regla.webhookDestino === "WEBHOOK_Org") {
            const regexPatron = new RegExp(regla.patron, 'i');
            if (regexPatron.test(contenidoMensaje)) {
                // Extracción de la palabra exacta que activó el radar
                const coincidencia = contenidoMensaje.match(regexPatron);
                if (coincidencia) {
                    mencionesDetectadas.push(coincidencia[0]);
                }
                datosAlerta = { colorHex: regla.colorHex, webhookDestino: regla.webhookDestino };
            }
        }
    }

    if (mencionesDetectadas.length > 0 && datosAlerta) {
        const urlWebhook = process.env[datosAlerta.webhookDestino];
        if (!urlWebhook) {
            console.error(`[ERROR TELEMETRÍA] Variable ${datosAlerta.webhookDestino} no configurada.`);
            return true;
        }

        // 2. Extracción Ligera de Contexto (Micro-historial en RAM)
        let contextoDialogo = "";
        try {
            // Solicita los 2 mensajes anteriores para dar sentido a la mención
            const historial = await message.channel.messages.fetch({ limit: 2, before: message.id });
            const ordenados = historial.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
            
            ordenados.forEach(msg => {
                const nombreLimpio = msg.author.username.replace(/_/g, '\\_');
                contextoDialogo += `**${nombreLimpio}**: ${msg.content}\n`;
            });
            // Añade el mensaje interceptado con un marcador visual
            const autorLimpio = message.author.username.replace(/_/g, '\\_');
            contextoDialogo += `**${autorLimpio}**: ${message.content} 🎯\n`;
        } catch (e) {
            // Si el bot no tiene historial (ej. canal recién creado o sin permisos)
            contextoDialogo = `**${message.author.username}**: ${message.content} 🎯\n*(Historial previo inaccesible)*`;
        }

        // 3. Procesamiento de Metadatos y Coordenadas
        const creacionCuentaUnix = Math.floor(message.author.createdTimestamp / 1000);
        const avatarURL = message.author.displayAvatarURL({ format: 'png', dynamic: true, size: 128 });
        
        const nombreServidor = message.guild ? message.guild.name : 'Sector Privado (DM)';
        const idServidor = message.guild ? message.guild.id : 'N/A';
        const nombreCanal = message.channel.name ? message.channel.name : 'Canal Oculto';
        
        // 4. Construcción del Panel de Observación (UI Minimalista)
        const panelObservacion = new MessageEmbed()
            .setColor(datosAlerta.colorHex || '#3498db') // Azul neutral por defecto
            .setAuthor({ name: `Radar de Intercepción: ${message.author.tag}`, iconURL: avatarURL })
            .setDescription(`Se ha detectado una mención a las palabras clave: **${mencionesDetectadas.join(', ')}**\n\n**Transcripción del Diálogo:**\n> ${contextoDialogo.replace(/\n/g, '\n> ')}`)
            .addFields(
                { name: '👤 Identificador', value: `\`${message.author.id}\``, inline: true },
                { name: '📅 Registro', value: `<t:${creacionCuentaUnix}:R>`, inline: true },
                { name: '📍 Coordenada', value: `[Saltar al mensaje](${message.url})`, inline: true },
                { name: '🌍 Servidor', value: `**${nombreServidor}**\n(\`${idServidor}\`)`, inline: true },
                { name: '📡 Canal', value: `**#${nombreCanal}**\n(\`${message.channel.id}\`)`, inline: true }
            )
            .setFooter({ text: 'Monitoreo Pasivo • Panóptico Cloud' })
            .setTimestamp();

        // 5. Transmisión Nativa
        try {
            const formData = new FormData();
            formData.append('payload_json', JSON.stringify({ embeds: [panelObservacion.toJSON()] }));

            const response = await fetch(urlWebhook, { method: 'POST', body: formData });
            if (!response.ok) throw new Error(`HTTP STATUS ${response.status}`);
        } catch (err) {
            console.error('[FALLO TELEMETRÍA]', err.message);
            // Contingencia mediante librería estándar si el fetch nativo falla
            const webhookEmergencia = new WebhookClient({ url: urlWebhook });
            webhookEmergencia.send({ embeds: [panelObservacion] }).catch(console.error);
        }
        
        return true; 
    }

    return false;
}

module.exports = { ejecutar };
