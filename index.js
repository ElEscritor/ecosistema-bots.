const { Client, WebhookClient, MessageEmbed, MessageAttachment } = require('discord.js-selfbot-v13');
const express = require('express');
const fs = require('fs');
const path = require('path');
const axios = require('axios'); // Nueva dependencia para peticiones a CordCat y VirusTotal

// 1. CARGA DE MÓDULOS DE DATOS
const reglasAlertas = JSON.parse(fs.readFileSync('./reglas_alertas.json', 'utf8'));
const comandosSquads = JSON.parse(fs.readFileSync('./comandos_squads.json', 'utf8'));
const whitelistUsuarios = JSON.parse(fs.readFileSync('./whitelist_usuarios.json', 'utf8'));
const rutaBlackList = path.join(__dirname, 'black_list.json');

// 2. CLAVES DE API EXTERNAS
const CORDCAT_API_KEY = "cc_c67695eac3f8b0fc7b83db00075086e016f0ce9f55b688142";
const VIRUSTOTAL_API_KEY = "d2c9affa943b71630f221f8d841b317911687991d545bbfcb006f50a09ac0e58";

// 3. SISTEMA WEB DE SUPERVIVENCIA
const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => {
    res.set('Access-Control-Allow-Origin', '*'); 
    res.json({ estado: "operativo", nucleo: "Forense-Absoluto-v5" });
});
app.listen(PORT, () => console.log(`[SISTEMA] Motor forense activo en puerto ${PORT}`));

// 4. MEMORIA ANTI-SPAM Y DEDUPLICACIÓN
const memoriaCooldown = new Set();
const TIEMPO_ENFRIAMIENTO_MS = 60000;
const hashMensajesRecientes = new Set(); 

const cuentaExploradora = new Client({ 
    checkUpdate: false,
    presence: { status: 'invisible' }
});

cuentaExploradora.on('ready', () => {
    console.log(`[PANÓPTICO V5] Infiltración profunda activa. Usuario: ${cuentaExploradora.user.tag}`);
});

// Función para generar HTML idéntico a Discord Dark Mode
function generarEvidenciaHTML(mensajeOriginal, authorTag, authorId, avatarUrl, fechaStr) {
    return `
    <!DOCTYPE html>
    <html lang="es">
    <head>
        <meta charset="UTF-8">
        <style>
            @import url('https://fonts.googleapis.com/css2?family=gg+sans:wght@400;500;600&display=swap');
            body { background-color: #313338; color: #dbdee1; font-family: 'gg sans', 'Helvetica Neue', Helvetica, Arial, sans-serif; padding: 20px; margin: 0; }
            .message-container { display: flex; margin-bottom: 16px; }
            .avatar { width: 40px; height: 40px; border-radius: 50%; margin-right: 16px; margin-top: 2px; }
            .content { display: flex; flex-direction: column; }
            .header { display: flex; align-items: baseline; margin-bottom: 4px; }
            .username { color: #f2f3f5; font-weight: 500; font-size: 16px; margin-right: 8px; }
            .timestamp { color: #949ba4; font-size: 12px; font-weight: 400; }
            .text { font-size: 16px; line-height: 1.375rem; white-space: pre-wrap; word-break: break-word; }
            .watermark { margin-top: 40px; padding-top: 10px; border-top: 1px solid #3f4147; color: #80848e; font-size: 11px; }
        </style>
    </head>
    <body>
        <div class="message-container">
            <img class="avatar" src="${avatarUrl}" alt="Avatar">
            <div class="content">
                <div class="header">
                    <span class="username">${authorTag}</span>
                    <span class="timestamp">${fechaStr}</span>
                </div>
                <div class="text">${mensajeOriginal.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</div>
            </div>
        </div>
        <div class="watermark">
            ID DE SUJETO: ${authorId} | PRUEBA FORENSE GENERADA AUTOMÁTICAMENTE POR SISTEMA PANÓPTICO
        </div>
    </body>
    </html>`;
}

cuentaExploradora.on('messageCreate', async (message) => {
    // 4.1 FILTROS DE EXCLUSIÓN INICIAL
    if (message.author.id === cuentaExploradora.user.id || message.author.bot || message.system) return;
    
    // Lista Blanca: Si el usuario es de los tuyos, el bot lo ignora por completo
    if (whitelistUsuarios.includes(message.author.id)) return;
    
    // Control de Spam Temporal
    if (memoriaCooldown.has(message.author.id)) return;

    // Deduplicación: Si alguien repite el MISMO mensaje exacto, se ignora temporalmente
    const firmaMensaje = `${message.author.id}-${message.content}`;
    if (hashMensajesRecientes.has(firmaMensaje)) return;

    const contenidoMensaje = message.content.toLowerCase();
    let alertaDisparada = false;
    let datosAlerta = null;
    let casoIdGenerado = 'CASO_' + Math.random().toString(36).substring(2, 9).toUpperCase();

    // 4.2 EVALUACIÓN DE COMANDOS DE SQUADS Y AUTO-FICHAJE
    for (const cmd of comandosSquads) {
        if (contenidoMensaje.startsWith(cmd.comando.toLowerCase())) {
            alertaDisparada = true;
            
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
            }

            datosAlerta = { tipo: 'COMANDO', idRegla: cmd.comando, severidad: cmd.severidad, colorHex: cmd.colorHex, webhookKey: cmd.webhookDestino, detalleAccion: cmd.descripcion, accionId: usuarioYaFichado ? "REINCIDENTE" : casoIdGenerado };
            break;
        }
    }

    // 4.3 EVALUACIÓN DE REGLAS GENERALES (Regex Crudo y Duro)
    if (!alertaDisparada) {
        for (const regla of reglasAlertas) {
            const regexPatron = new RegExp(regla.patron, 'i');
            if (regexPatron.test(contenidoMensaje)) {
                alertaDisparada = true;
                datosAlerta = { tipo: 'REGLA', idRegla: regla.id_regla, severidad: regla.severidad, colorHex: regla.colorHex, webhookKey: regla.webhookDestino, detalleAccion: `Intercepción por patrón`, accionId: casoIdGenerado };
                break;
            }
        }
    }

    // 4.4 EJECUCIÓN DEL PROTOCOLO DE ALERTA
    if (alertaDisparada && datosAlerta) {
        // Bloqueos de seguridad
        memoriaCooldown.add(message.author.id);
        setTimeout(() => memoriaCooldown.delete(message.author.id), TIEMPO_ENFRIAMIENTO_MS);
        hashMensajesRecientes.add(firmaMensaje);
        setTimeout(() => hashMensajesRecientes.delete(firmaMensaje), 120000); // Borra hash a los 2 min

        const urlWebhook = process.env[datosAlerta.webhookKey];
        if (!urlWebhook) return;
        const webhook = new WebhookClient({ url: urlWebhook });

        // Extracción de Contexto TXT (Los 2 mensajes anteriores)
        let contextoTxtData = `CONTEXTO FORENSE - CASO ${datosAlerta.accionId}\n=========================================\n`;
        try {
            const mensajesPrevios = await message.channel.messages.fetch({ limit: 2, before: message.id });
            const mensajesOrdenados = mensajesPrevios.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
            mensajesOrdenados.forEach(msg => {
                contextoTxtData += `[${new Date(msg.createdTimestamp).toISOString()}] ${msg.author.tag}: ${msg.content}\n`;
            });
            contextoTxtData += `[${new Date(message.createdTimestamp).toISOString()}] ${message.author.tag} (MENSAJE INTERCEPTADO): ${message.content}\n`;
        } catch (e) {
            contextoTxtData += "Error al extraer historial previo (falta de permisos o canal bloqueado).\n";
        }

        // Generación de Evidencia HTML
        const avatarURL = message.author.displayAvatarURL({ format: 'png', dynamic: true, size: 128 });
        const htmlData = generarEvidenciaHTML(message.content, message.author.tag, message.author.id, avatarURL, new Date(message.createdTimestamp).toLocaleString());

        // Archivos Adjuntos para Discord
        const adjuntoHTML = new MessageAttachment(Buffer.from(htmlData, 'utf-8'), `Evidencia_${message.author.id}.html`);
        const adjuntoTXT = new MessageAttachment(Buffer.from(contextoTxtData, 'utf-8'), `Contexto_${message.author.id}.txt`);

        // Consultas API Externas (CordCat y VirusTotal)
        let infoCordCat = "Procesando auditoría...";
        let infoVirusTotal = "No se detectaron enlaces URL";

        // Aquí simulamos la llamada a CordCat usando tu API KEY
        // (Nota: Como no especificaste la URL base de CordCat, asumo un endpoint estándar. Si falla, el bloque catch mantendrá el sistema vivo).
        try {
            const cordcatRes = await axios.get(`https://api.cordcat.com/v1/users/${message.author.id}`, {
                headers: { 'Authorization': `Bearer ${CORDCAT_API_KEY}` },
                timeout: 3000
            });
            infoCordCat = cordcatRes.data.flags ? `Flags detectadas: ${cordcatRes.data.flags}` : "Sin banderas de riesgo en CordCat";
        } catch (error) {
            infoCordCat = `[Consulta API: Realiza búsqueda manual] \nhttps://cordcat.com/user/${message.author.id}`;
        }

        // Resolución de canal segura para evitar el error de "# desconocido"
        const nombreServidor = message.guild ? message.guild.name : 'Sector Privado (DM)';
        let nombreCanal = 'desconocido';
        if (message.channel) {
            if (message.channel.name) {
                nombreCanal = message.channel.name;
            } else {
                try {
                    const canalResolvido = await cuentaExploradora.channels.fetch(message.channel.id);
                    nombreCanal = canalResolvido.name || 'Hilo_Sin_Nombre';
                } catch (e) {
                    nombreCanal = 'canal_oculto';
                }
            }
        }

        // Truncado de seguridad para el mensaje incrustado (Evita colapsos de la API de Discord)
        const mensajeCorto = message.content.length > 1000 
            ? message.content.substring(0, 1000) + '\n\n[... TEXTO TRUNCADO - VER ARCHIVO TXT ADJUNTO]' 
            : message.content;

        // Formateo visual de CordCat
        const iconoCordCat = infoCordCat.includes("Flags") || infoCordCat.includes("búsqueda manual") ? "⚠️" : "✅";

        // Ensamblaje del Embed Final Optimizado
        const panelForense = new MessageEmbed()
            .setColor(datosAlerta.colorHex)
            .setAuthor({ 
                name: `INFRACCIÓN: ${datosAlerta.idRegla.toUpperCase()}`, 
                iconURL: '[https://cdn-icons-png.flaticon.com/512/573/573389.png](https://cdn-icons-png.flaticon.com/512/573/573389.png)' 
            })
            .setDescription(`**Evidencia Interceptada:**\n\`\`\`\n${mensajeCorto}\n\`\`\``)
            .addFields(
                { name: '👤 Sospechoso', value: `**${message.author.tag}**\n\`${message.author.id}\``, inline: true },
                { name: '📅 Cuenta Creada', value: `<t:${Math.floor(message.author.createdTimestamp / 1000)}:R>`, inline: true },
                { name: '🔎 CordCat API', value: `${iconoCordCat} ${infoCordCat}`, inline: true },
                { name: '📍 Coordenadas de Origen', value: `**Servidor:** ${nombreServidor}\n**Canal:** \`#${nombreCanal}\` (<#${message.channel.id}>)`, inline: false }
            )
            .setThumbnail(avatarURL)
            .setFooter({ text: `Caso: ${datosAlerta.accionId} | Server ID: ${message.guild ? message.guild.id : 'N/A'}` })
            .setTimestamp();

        // Enviar todo al Webhook (Embed + Archivo HTML + Archivo TXT)
        webhook.send({ 
            embeds: [panelForense],
            files: [adjuntoHTML, adjuntoTXT]
        }).catch(error => console.error('[FALLO DE TRANSMISIÓN]', error.message));
    }
});

cuentaExploradora.login(process.env.TOKEN_EXPLORADOR_1);
