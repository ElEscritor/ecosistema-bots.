const { Client, WebhookClient, MessageEmbed, MessageAttachment } = require('discord.js-selfbot-v13');
const express = require('express');
const fs = require('fs');
const axios = require('axios');
const { MongoClient } = require('mongodb'); // NUEVO: Motor de base de datos en la nube

// 1. CARGA DE MÓDULOS DE DATOS LOCALES (Solo reglas y comandos, que son estáticos)
const reglasAlertas = JSON.parse(fs.readFileSync('./reglas_alertas.json', 'utf8'));
const comandosSquads = JSON.parse(fs.readFileSync('./comandos_squads.json', 'utf8'));
const whitelistUsuarios = JSON.parse(fs.readFileSync('./whitelist_usuarios.json', 'utf8'));

// 2. CLAVES DE API EXTERNAS
const CORDCAT_API_KEY = "cc_c67695eac3f8b0fc7b83db00075086e016f0ce9f55b688142";

// 3. CONEXIÓN A MONGODB ATLAS (Base de datos indestructible)
const mongoUri = process.env.MONGO_URI;
if (!mongoUri) {
    console.error("ERROR CRÍTICO: Falta la variable MONGO_URI en Render.");
    process.exit(1);
}
const mongoClient = new MongoClient(mongoUri);
let db, blacklistCollection;

async function conectarBaseDatos() {
    try {
        await mongoClient.connect();
        db = mongoClient.db("panoptico_db"); 
        blacklistCollection = db.collection("blacklist");
        console.log("[SISTEMA] Base de datos MongoDB enlazada con éxito.");
    } catch (error) {
        console.error("[ERROR BD] Fallo de conexión a MongoDB:", error);
    }
}
conectarBaseDatos();

// 4. SISTEMA WEB DE SUPERVIVENCIA
const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => {
    res.set('Access-Control-Allow-Origin', '*'); 
    res.json({ estado: "operativo", nucleo: "Forense-Cloud-v6" });
});
app.listen(PORT, () => console.log(`[SISTEMA] Motor web activo en puerto ${PORT}`));

// 5. MEMORIA ANTI-SPAM Y DEDUPLICACIÓN
const memoriaCooldown = new Set();
const TIEMPO_ENFRIAMIENTO_MS = 60000;
const hashMensajesRecientes = new Set(); 

const cuentaExploradora = new Client({ 
    checkUpdate: false,
    presence: { status: 'invisible' }
});

cuentaExploradora.on('ready', () => {
    console.log(`[PANÓPTICO V6] Infiltración profunda activa. Usuario: ${cuentaExploradora.user.tag}`);
});

// Función HTML para evidencia visual
function generarEvidenciaHTML(mensajeOriginal, authorTag, authorId, avatarUrl, fechaStr) {
    return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><style>@import url('https://fonts.googleapis.com/css2?family=gg+sans:wght@400;500;600&display=swap');body { background-color: #313338; color: #dbdee1; font-family: 'gg sans', 'Helvetica Neue', Helvetica, Arial, sans-serif; padding: 20px; margin: 0; }.message-container { display: flex; margin-bottom: 16px; }.avatar { width: 40px; height: 40px; border-radius: 50%; margin-right: 16px; margin-top: 2px; }.content { display: flex; flex-direction: column; }.header { display: flex; align-items: baseline; margin-bottom: 4px; }.username { color: #f2f3f5; font-weight: 500; font-size: 16px; margin-right: 8px; }.timestamp { color: #949ba4; font-size: 12px; font-weight: 400; }.text { font-size: 16px; line-height: 1.375rem; white-space: pre-wrap; word-break: break-word; }.watermark { margin-top: 40px; padding-top: 10px; border-top: 1px solid #3f4147; color: #80848e; font-size: 11px; }</style></head><body><div class="message-container"><img class="avatar" src="${avatarUrl}" alt="Avatar"><div class="content"><div class="header"><span class="username">${authorTag}</span><span class="timestamp">${fechaStr}</span></div><div class="text">${mensajeOriginal.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</div></div></div><div class="watermark">ID DE SUJETO: ${authorId} | PRUEBA FORENSE GENERADA AUTOMÁTICAMENTE POR SISTEMA PANÓPTICO</div></body></html>`;
}

cuentaExploradora.on('messageCreate', async (message) => {
    if (message.author.id === cuentaExploradora.user.id || message.author.bot || message.system) return;
    if (whitelistUsuarios.includes(message.author.id)) return;
    if (memoriaCooldown.has(message.author.id)) return;

    const firmaMensaje = `${message.author.id}-${message.content}`;
    if (hashMensajesRecientes.has(firmaMensaje)) return;

    const contenidoMensaje = message.content.toLowerCase();
    let alertaDisparada = false;
    let datosAlerta = null;
    let casoIdGenerado = 'CASO_' + Math.random().toString(36).substring(2, 9).toUpperCase();

    // 6. EVALUACIÓN DE COMANDOS DE SQUADS Y AUTO-FICHAJE CLOUD
    for (const cmd of comandosSquads) {
        if (contenidoMensaje.startsWith(cmd.comando.toLowerCase())) {
            alertaDisparada = true;
            
            // Consulta asíncrona a MongoDB Atlas
            let usuarioYaFichado = null;
            if (blacklistCollection) {
                usuarioYaFichado = await blacklistCollection.findOne({ userId: message.author.id });
                
                if (!usuarioYaFichado) {
                    const nuevoFichaje = {
                        userId: message.author.id,
                        nombreUsuario: message.author.tag,
                        accion: `Infracción automatizada: Uso del comando ${cmd.comando}`,
                        fechaFichaje: new Date().toISOString().split('T')[0],
                        casoId: casoIdGenerado
                    };
                    await blacklistCollection.insertOne(nuevoFichaje);
                    console.log(`[NUEVO INGRESO CLOUD] Usuario ${message.author.tag} fichado en MongoDB.`);
                }
            }

            datosAlerta = { tipo: 'COMANDO', idRegla: cmd.comando, severidad: cmd.severidad, colorHex: cmd.colorHex, webhookKey: cmd.webhookDestino, detalleAccion: cmd.descripcion, accionId: usuarioYaFichado ? "REINCIDENTE" : casoIdGenerado };
            break;
        }
    }

    // 7. EVALUACIÓN DE REGLAS GENERALES (Regex)
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

    // 8. EJECUCIÓN DEL PROTOCOLO DE ALERTA
    if (alertaDisparada && datosAlerta) {
        memoriaCooldown.add(message.author.id);
        setTimeout(() => memoriaCooldown.delete(message.author.id), TIEMPO_ENFRIAMIENTO_MS);
        hashMensajesRecientes.add(firmaMensaje);
        setTimeout(() => hashMensajesRecientes.delete(firmaMensaje), 120000);

        const urlWebhook = process.env[datosAlerta.webhookKey];
        if (!urlWebhook) return;
        const webhook = new WebhookClient({ url: urlWebhook });

        // Consulta a MongoDB para saber el estado del usuario en la base de datos general
        let estadoBanXN = `Base de datos inactiva / Error de conexión`;
        if (blacklistCollection) {
            const infractorFichado = await blacklistCollection.findOne({ userId: message.author.id });
            estadoBanXN = infractorFichado 
                ? `Si, [🟨] ${infractorFichado.accion} (Caso: ${infractorFichado.casoId || 'Antiguo'})` 
                : `No consta en los registros de MongoDB.`;
        }

        // Extracción de Contexto TXT
        let contextoTxtData = `CONTEXTO FORENSE - CASO ${datosAlerta.accionId}\n=========================================\n`;
        try {
            const mensajesPrevios = await message.channel.messages.fetch({ limit: 2, before: message.id });
            const mensajesOrdenados = mensajesPrevios.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
            mensajesOrdenados.forEach(msg => {
                contextoTxtData += `[${new Date(msg.createdTimestamp).toISOString()}] ${msg.author.tag}: ${msg.content}\n`;
            });
            contextoTxtData += `[${new Date(message.createdTimestamp).toISOString()}] ${message.author.tag} (INTERCEPTADO): ${message.content}\n`;
        } catch (e) {
            contextoTxtData += "Error al extraer historial previo.\n";
        }

        // Archivos Adjuntos
        const avatarURL = message.author.displayAvatarURL({ format: 'png', dynamic: true, size: 128 });
        const htmlData = generarEvidenciaHTML(message.content, message.author.tag, message.author.id, avatarURL, new Date(message.createdTimestamp).toLocaleString());
        const adjuntoHTML = new MessageAttachment(Buffer.from(htmlData, 'utf-8'), `Evidencia_${message.author.id}.html`);
        const adjuntoTXT = new MessageAttachment(Buffer.from(contextoTxtData, 'utf-8'), `Contexto_${message.author.id}.txt`);

        // Consultas API CordCat
        let infoCordCat = "Procesando auditoría...";
        try {
            const cordcatRes = await axios.get(`https://api.cordcat.com/v1/users/${message.author.id}`, {
                headers: { 'Authorization': `Bearer ${CORDCAT_API_KEY}` },
                timeout: 3000
            });
            infoCordCat = cordcatRes.data.flags ? `Flags detectadas: ${cordcatRes.data.flags}` : "Sin banderas de riesgo en CordCat";
        } catch (error) {
            infoCordCat = `[Realiza búsqueda manual] \nhttps://cordcat.com/user/${message.author.id}`;
        }

        // Resolución de canal
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

        const mensajeCorto = message.content.length > 1000 
            ? message.content.substring(0, 1000) + '\n\n[... TEXTO TRUNCADO - VER ARCHIVO TXT ADJUNTO]' 
            : message.content;
        const iconoCordCat = infoCordCat.includes("Flags") || infoCordCat.includes("búsqueda manual") ? "⚠️" : "✅";

        // Ensamblaje del Embed Optimizado
        const panelForense = new MessageEmbed()
            .setColor(datosAlerta.colorHex)
            .setAuthor({ name: `INFRACCIÓN: ${datosAlerta.idRegla.toUpperCase()}`, iconURL: 'https://cdn-icons-png.flaticon.com/512/573/573389.png' })
            .setDescription(`**Evidencia Interceptada:**\n\`\`\`\n${mensajeCorto}\n\`\`\``)
            .addFields(
                { name: '👤 Sospechoso', value: `**${message.author.tag}**\n\`${message.author.id}\``, inline: true },
                { name: '📅 Cuenta Creada', value: `<t:${Math.floor(message.author.createdTimestamp / 1000)}:R>`, inline: true },
                { name: '🔎 CordCat API', value: `${iconoCordCat} ${infoCordCat}`, inline: true },
                { name: '📍 Coordenadas de Origen', value: `**Servidor:** ${nombreServidor}\n**Canal:** \`#${nombreCanal}\` (<#${message.channel.id}>)`, inline: false },
                { name: '🛡️ Estado en Base de Datos', value: estadoBanXN, inline: false }
            )
            .setThumbnail(avatarURL)
            .setFooter({ text: `Caso: ${datosAlerta.accionId} | Server ID: ${message.guild ? message.guild.id : 'N/A'}` })
            .setTimestamp();

        webhook.send({ embeds: [panelForense], files: [adjuntoHTML, adjuntoTXT] }).catch(error => console.error('[FALLO DE TRANSMISIÓN]', error.message));
    }
});

// ... código anterior (conexión a MongoDB, Express, variables) ...

cuentaExploradora.on('ready', () => {
    console.log(`[PANÓPTICO V6] Infiltración profunda activa. Usuario: ${cuentaExploradora.user.tag}`);
});

// Función HTML para evidencia visual (omitida para brevedad)
function generarEvidenciaHTML(mensajeOriginal, authorTag, authorId, avatarUrl, fechaStr) { /* ... */ }

// INICIO DEL EVENTO - AQUÍ NACE LA VARIABLE "message"
cuentaExploradora.on('messageCreate', async (message) => {
    
    // ==========================================
    // [MODO DEBUG] - EL BOT NOS HABLA EN RENDER
    // ==========================================
    if (message.content.toLowerCase().includes('raid') || message.content.toLowerCase().includes('!serdan')) {
        console.log(`\n[DIAGNÓSTICO] Analizando mensaje de: ${message.author.tag}`);
        console.log(`1. ¿Es el propio bot?: ${message.author.id === cuentaExploradora.user.id}`);
        console.log(`2. ¿Está en la whitelist?: ${whitelistUsuarios.includes(message.author.id)}`);
        console.log(`3. ¿Está bloqueado por cooldown?: ${memoriaCooldown.has(message.author.id)}`);
        const firmaPrueba = `${message.author.id}-${message.content}`;
        console.log(`4. ¿Es un mensaje duplicado (Anti-spam)?: ${hashMensajesRecientes.has(firmaPrueba)}`);
        console.log(`Si alguna de las respuestas de arriba es 'true', el bot ignorará el mensaje.\n`);
    }
    // ==========================================

    // 4.1 FILTROS DE EXCLUSIÓN INICIAL
    if (message.author.id === cuentaExploradora.user.id || message.author.bot || message.system) return;
    if (whitelistUsuarios.includes(message.author.id)) return;
    if (memoriaCooldown.has(message.author.id)) return;

    // ... resto de la lógica de evaluación (Regex, MongoDB, Embeds) ...
