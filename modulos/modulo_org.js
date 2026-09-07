const { MessageEmbed } = require('discord.js-selfbot-v13');
const fs = require('fs');
const path = require('path');

const database = require('../database.js');
const transmisor = require('../web/transmisor.js');

const reglasPath = path.join(__dirname, '../reglas_alertas.json');
const reglasAlertas = JSON.parse(fs.readFileSync(reglasPath, 'utf8'));

async function ejecutar(message, contextoCache) {
    const contenidoMensaje = message.content.toLowerCase();
    let mencionesDetectadas = [];
    let datosAlerta = null;

    for (const regla of reglasAlertas) {
        if (regla.webhookDestino === "WEBHOOK_Org") {
            const regexPatron = new RegExp(regla.patron, 'gi');
            const coincidencias = contenidoMensaje.match(regexPatron);

            if (coincidencias && coincidencias.length > 0) {
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

    if (mencionesDetectadas.length > 0 && datosAlerta) {
        const urlWebhook = process.env[datosAlerta.webhookDestino];
        if (!urlWebhook) return true;

        const servidorOrigen = message.guild ? message.guild.name : 'Sector Privado (DM)';
        const casoIdGenerado = 'OSINT_' + Math.random().toString(36).substring(2, 9).toUpperCase();

        await database.ficharInfractor(
            message.author.id,
            message.author.tag,
            `Mención Organizacional (OSINT): ${mencionesDetectadas.join(', ')}`,
            casoIdGenerado,
            message.content,
            servidorOrigen
        );

        // EXTRACCIÓN DE CACHÉ LOCAL
        let contextoDialogo = "";
        if (contextoCache && contextoCache.length > 0) {
            contextoCache.forEach(msg => {
                const nombreLimpio = msg.authorTag.replace(/_/g, '\\_');
                const marcador = msg.authorId === message.author.id && msg.content === message.content ? "🎯" : "";
                contextoDialogo += `**${nombreLimpio}**: ${msg.content} ${marcador}\n`;
            });
        } else {
            contextoDialogo = `**${message.author.tag}**: ${message.content} 🎯`;
        }

        const creacionCuentaUnix = Math.floor(message.author.createdTimestamp / 1000);
        const avatarURL = message.author.displayAvatarURL({ format: 'png', dynamic: true, size: 128 });
        
        const panelObservacion = new MessageEmbed()
            .setColor(datosAlerta.colorHex || '#9D4EDD') 
            .setAuthor({ name: `Radar de Organización: ${message.author.tag}`, iconURL: avatarURL })
            .setDescription(`Firma de red detectada: **${mencionesDetectadas.join(', ')}**\n\n**Transcripción del Segmento:**\n> ${contextoDialogo.replace(/\n/g, '\n> ')}`)
            .addFields(
                { name: '👤 Identidad Base', value: `\`${message.author.id}\``, inline: true },
                { name: '📅 Creación', value: `<t:${creacionCuentaUnix}:R>`, inline: true },
                { name: '📍 Rastro', value: `[Cruce de Señal](${message.url})`, inline: true },
                { name: '🌍 Red Origen', value: `**${servidorOrigen}**`, inline: true },
                { name: '📡 Vector Local', value: `**<#${message.channel.id}>**`, inline: true }
            )
            .setFooter({ text: `ID: ${message.author.id} • Monitoreo Pasivo • OSINT` })
            .setTimestamp();

        await transmisor.enviarWebhook(urlWebhook, panelObservacion.toJSON(), null, []);
        return true; 
    }
    return false;
}

module.exports = { ejecutar };
