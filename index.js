const { Client, WebhookClient, MessageEmbed } = require('discord.js-selfbot-v13');
const express = require('express');
const fs = require('fs');
const path = require('path');

const reglasAlertas = JSON.parse(fs.readFileSync('./reglas_alertas.json', 'utf8'));
const comandosSquads = JSON.parse(fs.readFileSync('./comandos_squads.json', 'utf8'));
const rutaBlackList = path.join(__dirname, 'black_list.json');

const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => {
    res.set('Access-Control-Allow-Origin', '*'); 
    res.json({ estado: "operativo", nucleo: "Contrainteligencia-Autonoma-v4" });
});
app.listen(PORT, () => console.log(`[SISTEMA] Motor de contrainteligencia activo en puerto ${PORT}`));

const memoriaCooldown = new Set();
const TIEMPO_ENFRIAMIENTO_MS = 45000;

const cuentaExploradora = new Client({ 
    checkUpdate: false,
    presence: { status: 'invisible' }
});

cuentaExploradora.on('ready', () => {
    console.log(`[PANÓPTICO V4] Red de infiltración operativa como: ${cuentaExploradora.user.tag}`);
});

cuentaExploradora.on('messageCreate', async (message) => {
    if (message.author.id === cuentaExploradora.user.id || message.author.bot || message.system) return;
    if (memoriaCooldown.has(message.author.id)) return;

    const contenidoMensaje = message.content.toLowerCase();
    let alertaDisparada = false;
    let datosAlerta = null;
    let casoIdGenerado = 'CASO_' + Math.random().toString(36).substring(2, 9).toUpperCase();

    // 1. EVALUACIÓN DE COMANDOS DE SQUADS Y AUTO-FICHAJE
    for (const cmd of comandosSquads) {
        if (contenidoMensaje.startsWith(cmd.comando.toLowerCase())) {
            alertaDisparada = true;
            
            // Proceso de lectura, actualización y escritura autónoma de la base de datos
            let blackList = JSON.parse(fs.readFileSync(rutaBlackList, 'utf8'));
            const usuarioYaFichado = blackList.find(b => b.userId === message.author.id);
            
            if (!usuarioYaFichado) {
                const nuevoFichaje = {
                    userId: message.author.id,
                    nombreUsuario: message.author.tag,
                    accion: `Infracción automatizada: Uso del comando ${cmd.comando}`,
                    fechaFichaje: new Date().toISOString().split('T')[0],
                    casoId: casoIdGenerado
                };
                blackList.push(nuevoFichaje);
                fs.writeFileSync(rutaBlackList, JSON.stringify(blackList, null, 2), 'utf8');
                console.log(`[NUEVO INGRESO] Usuario ${message.author.tag} añadido a la lista negra.`);
            }

            datosAlerta = {
                tipo: 'COMANDO',
                idRegla: cmd.comando,
                severidad: cmd.severidad,
                colorHex: cmd.colorHex,
                webhookKey: cmd.webhookDestino,
                detalleAccion: cmd.descripcion,
                accionId: usuarioYaFichado ? "REINCIDENTE" : casoIdGenerado
            };
            break;
        }
    }

    // 2. EVALUACIÓN DE REGLAS GENERALES (Sin auto-fichaje, solo monitoreo)
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
                    detalleAccion: `Intercepción por patrón de vigilancia`,
                    accionId: casoIdGenerado
                };
                break;
            }
        }
    }

    // 3. CONSTRUCCIÓN Y ENVÍO DEL REPORTE FORENSE
    if (alertaDisparada && datosAlerta) {
        memoriaCooldown.add(message.author.id);
        setTimeout(() => memoriaCooldown.delete(message.author.id), TIEMPO_ENFRIAMIENTO_MS);

        const urlWebhook = process.env[datosAlerta.webhookKey];
        if (!urlWebhook) {
            console.error(`ERROR CRÍTICO: Falta la clave de enrutamiento ${datosAlerta.webhookKey} en Render.`);
            return;
        }

        const webhook = new WebhookClient({ url: urlWebhook });

        // Lectura de estado actual en la lista negra
        const blackListActualizada = JSON.parse(fs.readFileSync(rutaBlackList, 'utf8'));
        const infractorFichado = blackListActualizada.find(b => b.userId === message.author.id);
        const estadoBanXN = infractorFichado 
            ? `Si, [🟨] ${infractorFichado.accion} (Caso asociado: ${infractorFichado.casoId || 'Antiguo'})` 
            : `No consta en los registros de seguridad.`;

        const enlaceMensaje = `https://discord.com/channels/${message.guild ? message.guild.id : '@me'}/${message.channel.id}/${message.id}`;
        const nombreServidor = message.guild ? message.guild.name : 'Sector Privado (DM)';
        const idServidor = message.guild ? message.guild.id : 'N/A';
        const fechaCreacionCuenta = `<t:${Math.floor(message.author.createdTimestamp / 1000)}:R>`;

        const panelForense = new MessageEmbed()
            .setColor(datosAlerta.colorHex)
            .setAuthor({ 
                name: `ALERTA DE SEGURIDAD: ${datosAlerta.idRegla.toUpperCase()}`, 
                iconURL: 'https://cdn-icons-png.flaticon.com/512/573/573389.png' 
            })
            .setDescription(`**Evidencia capturada en tiempo real:**\n\`\`\`\n${message.content}\n\`\`\``)
            .addFields(
                { name: '🆔 Identificador de Caso', value: `\`${datosAlerta.accionId}\``, inline: false },
                { name: '👤 Identidad del Sujeto', value: `${message.author.tag}\n(\`${message.author.id}\`)`, inline: true },
                { name: '📅 Antigüedad de Cuenta', value: fechaCreacionCuenta, inline: true },
                { name: '📍 Coordenadas de Origen', value: `${nombreServidor}\n<#${message.channel.id}> (\`${idServidor}\`)`, inline: false },
                { name: '🛡️ Estado en Base de Datos', value: `${estadoBanXN}`, inline: false },
                { name: '🔗 Trazabilidad', value: `[Acceder al registro original del servidor](${enlaceMensaje})`, inline: false }
            )
            .setThumbnail(message.author.displayAvatarURL({ dynamic: true }))
            .setFooter({ text: `Departamento de Contrainteligencia | ID Origen: ${idServidor}` })
            .setTimestamp();

        webhook.send({ embeds: [panelForense] }).catch(error => console.error('[FALLO DE TRANSMISIÓN]', error.message));
    }
});

cuentaExploradora.login(process.env.TOKEN_EXPLORADOR_1);
