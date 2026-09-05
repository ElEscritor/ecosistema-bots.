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

    // 1. Detección de Comandos
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

    // 2. Detección por Regex
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

    // 3. Envío al Webhook con Diseño Profesional
    if (alertaDisparada && datosAlerta) {
        const urlWebhook = process.env[datosAlerta.webhookDestino];
        if (!urlWebhook) {
            console.log(`[ERROR] Falta variable ${datosAlerta.webhookDestino} en Render.`);
            return true; 
        }

        const webhook = new WebhookClient({ url: urlWebhook });
        
        // --- PREPARACIÓN DE DATOS VISUALES ---
        const mensajeCorto = message.content.length > 1000 ? message.content.substring(0, 1000) + '\n\n[... TEXTO TRUNCADO]' : message.content;
        const avatarURL = message.author.displayAvatarURL({ format: 'png', dynamic: true, size: 256 });
        const creacionCuenta = Math.floor(message.author.createdTimestamp / 1000);
        const nombreServidor = message.guild ? message.guild.name : 'Mensaje Privado (DM)';

        // --- CONSTRUCCIÓN DEL PANEL FORENSE ---
        const panelForense = new MessageEmbed()
            .setColor(datosAlerta.colorHex)
            .setAuthor({ name: `INFRACCIÓN: ${datosAlerta.idRegla.toUpperCase()}`, iconURL: 'https://cdn-icons-png.flaticon.com/512/573/573389.png' })
            .setDescription(`**Mensaje Interceptado:**\n\`\`\`text\n${mensajeCorto}\n\`\`\``)
            .setThumbnail(avatarURL)
            .addFields(
                // Fila 1: Cuadrícula de 3 columnas (Identidad, Antigüedad, Ubicación)
                { name: '👤 Sospechoso', value: `**${message.author.tag}**\n(\`${message.author.id}\`)`, inline: true },
                { name: '📅 Cuenta Creada', value: `<t:${creacionCuenta}:R>`, inline: true },
                { name: '📍 Ubicación', value: `**${nombreServidor}**\n<#${message.channel.id}>`, inline: true },
                
                // Fila 2: Base de Datos y Enlace Directo
                { name: '🛡️ Estado Base de Datos', value: datosAlerta.estadoBD, inline: false },
                { name: '🔗 Acción Directa', value: `[Ir al mensaje original](${message.url})`, inline: false }
            )
            .setFooter({ text: `ID Servidor: ${message.guild ? message.guild.id : 'N/A'} • Caso: ${datosAlerta.accionId}` })
            .setTimestamp();

        webhook.send({ embeds: [panelForense] }).catch(err => console.error('[FALLO RED]', err.message));
        return true; 
    }

    return false; 
}

module.exports = { ejecutar };
