const { Client, WebhookClient, MessageEmbed } = require('discord.js-selfbot-v13');
const express = require('express');
const fs = require('fs');

const reglasAlertas = JSON.parse(fs.readFileSync('./reglas_alertas.json', 'utf8'));
const comandosSquads = JSON.parse(fs.readFileSync('./comandos_squads.json', 'utf8'));
let blackList = JSON.parse(fs.readFileSync('./black_list.json', 'utf8'));

const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => {
    res.set('Access-Control-Allow-Origin', '*'); 
    res.json({ estado: "operativo", nucleo: "Forense-Autonomo-v4" });
});
app.listen(PORT, () => console.log(`[SISTEMA] API activa en puerto ${PORT}`));

const memoriaCooldown = new Set();
const TIEMPO_ENFRIAMIENTO_MS = 45000;

const cuentaExploradora = new Client({ 
    checkUpdate: false,
    presence: { status: 'invisible' }
});

cuentaExploradora.on('ready', () => {
    console.log(`[PANÓPTICO V4] Operando de forma invisible como: ${cuentaExploradora.user.tag}`);
});

cuentaExploradora.on('messageCreate', async (message) => {
    if (message.author.id === cuentaExploradora.user.id || message.author.bot || message.system) return;
    if (memoriaCooldown.has(message.author.id)) return;

    const contenidoMensaje = message.content.toLowerCase();
    let alertaDisparada = false;
    let datosAlerta = null;
    let idCasoGenerado = 'CASO-' + Math.random().toString(36).substring(2, 9).toUpperCase();

    // 1. EVALUACIÓN DE COMANDOS DE SQUADS Y AUTO-FICHAJE
    for (const cmd of comandosSquads) {
        if (contenidoMensaje.startsWith(cmd.comando.toLowerCase())) {
            alertaDisparada = true;
            
            // Comprobar si el infractor ya existe en la base de datos
            const infractorExistente = blackList.find(b => b.userId === message.author.id);
            
            // Si no existe, se añade automáticamente a la lista y se guarda el archivo
            if (!infractorExistente) {
                const nuevoRegistro = {
                    userId: message.author.id,
                    nombreUsuario: message.author.tag,
                    accion: cmd.descripcion,
                    fechaFichaje: new Date().toISOString().split('T')[0],
                    idCaso: idCasoGenerado
                };
                blackList.push(nuevoRegistro);
                fs.writeFileSync('./black_list.json', JSON.stringify(blackList, null, 2));
                console.log(`[BASE DE DATOS] Nuevo infractor registrado: ${message.author.tag}`);
            }

            datosAlerta = {
                tipo: 'COMANDO',
                idRegla: cmd.comando,
                severidad: cmd.severidad,
                colorHex: cmd.colorHex,
                webhookKey: cmd.webhookDestino,
                detalleAccion: cmd.descripcion,
                accionId: infractorExistente ? infractorExistente.idCaso : idCasoGenerado
            };
            break;
        }
    }

    // 2. EVALUACIÓN DE REGLAS GENERALES
    if (!alertaDisparada) {
        for (const regla of reglasAlertas) {
            const regexPatron = new RegExp(regla.patron, 'i');
            if (regexPatron.test(contenidoMensaje)) {
                alertaDisparada = true;
                datosAlerta = {
                    tipo: 'REGLA',
                    idRegla: regla.id_regla,
                    severidad: regla.severidad,
                    colorHex: regla.colorHex,
                    webhookKey: regla.webhookDestino,
                    detalleAccion: `Coincidencia por patrón (${regla.tipo})`,
                    accionId: idCasoGenerado
                };
                break;
            }
        }
    }

    // 3. ENVÍO DE LA ALERTA AL WEBHOOK
    if (alertaDisparada && datosAlerta) {
        memoriaCooldown.add(message.author.id);
        setTimeout(() => memoriaCooldown.delete(message.author.id), TIEMPO_ENFRIAMIENTO_MS);

        const urlWebhook = process.env[datosAlerta.webhookKey];
        if (!urlWebhook) return;

        const webhook = new WebhookClient({ url: urlWebhook });

        // Verificamos nuevamente la base de datos actualizada en tiempo real
        const estadoActualizado = blackList.find(b => b.userId === message.author.id);
        const estadoBanXN = estadoActualizado 
            ? `Si, [🟨] ${estadoActualizado.accion} (ID caso: ${estadoActualizado.idCaso})` 
            : `No registrado en blacklist activa.`;

        const enlaceMensaje = `https://discord.com/channels/${message.guild ? message.guild.id : '@me'}/${message.channel.id}/${message.id}`;
        const nombreServidor = message.guild ? message.guild.name : 'Canal Privado (DM)';
        const idServidor = message.guild ? message.guild.id : 'N/A';
        const fechaCreacionCuenta = `<t:${Math.floor(message.author.createdTimestamp / 1000)}:R>`;

        const panelForense = new MessageEmbed()
            .setColor(datosAlerta.colorHex)
            .setAuthor({ 
                name: `PANÓPTICO INTEL: ${datosAlerta.idRegla.toUpperCase()}`, 
                iconURL: 'https://cdn-icons-png.flaticon.com/512/573/573389.png' 
            })
            .setDescription(`**Nuevo evento interceptado:**\n\`\`\`\n${message.content}\n\`\`\``)
            .addFields(
                { name: '🆔 ID Caso', value: `\`${datosAlerta.accionId}\``, inline: false },
                { name: '👤 Usuario', value: `${message.author.tag} (\`${message.author.id}\`)`, inline: true },
                { name: '📅 Creada', value: fechaCreacionCuenta, inline: true },
                { name: '📍 Servidor / Canal', value: `${nombreServidor}\n<#${message.channel.id}> (\`${idServidor}\`)`, inline: false },
                { name: '🛡️ Registro Interno', value: `${estadoBanXN}`, inline: false },
                { name: '🔗 Enlace Directo', value: `[Ir al mensaje original](${enlaceMensaje})`, inline: false }
            )
            .setThumbnail(message.author.displayAvatarURL({ dynamic: true }))
            .setFooter({ text: `Sistema de Inteligencia Forense | ID Servidor: ${idServidor}` })
            .setTimestamp();

        webhook.send({ embeds: [panelForense] }).catch(error => console.error('[ERROR WEBHOOK]', error.message));
    }
});

cuentaExploradora.login(process.env.TOKEN_EXPLORADOR_1);
