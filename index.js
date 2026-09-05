const { Client, WebhookClient, MessageEmbed } = require('discord.js-selfbot-v13');
const express = require('express');
const fs = require('fs');

// 1. CARGA DE MATRIZ DE REGLAS
const reglas = JSON.parse(fs.readFileSync('./reglas.json', 'utf8'));

// 2. SISTEMA DE LATIDO Y API EXTERNA (Keep-Alive)
const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => {
    res.set('Access-Control-Allow-Origin', '*'); 
    res.json({ estado: "operativo", nucleo: "Forense-v2" });
});
app.listen(PORT, () => console.log(`[SISTEMA] API activa en puerto ${PORT}`));

// 3. ESCUDO ANTI-SPAM (Memoria Volátil)
const memoriaCooldown = new Set();
const TIEMPO_ENFRIAMIENTO_MS = 60000; // 60 segundos de bloqueo por usuario infractor

// 4. INICIALIZACIÓN FANTASMA DEL EXPLORADOR
const cuentaExploradora = new Client({ 
    checkUpdate: false,
    presence: { status: 'invisible' } // Evasión: Nunca aparecerá "En línea"
});

cuentaExploradora.on('ready', () => {
    console.log(`[PANÓPTICO V2] Infiltración exitosa. Operando como: ${cuentaExploradora.user.tag}`);
});

cuentaExploradora.on('messageCreate', async (message) => {
    // Ignorar mensajes propios, de bots oficiales o del sistema
    if (message.author.id === cuentaExploradora.user.id || message.author.bot || message.system) return;

    // Verificar si el usuario está en periodo de enfriamiento por spam previo
    if (memoriaCooldown.has(message.author.id)) return;

    const contenidoMensaje = message.content.toLowerCase();

    // Evaluación matemática contra el archivo JSON
    for (const regla of reglas) {
        const regexPatron = new RegExp(regla.patron, 'i');
        
        if (regexPatron.test(contenidoMensaje)) {
            
            // 4.1. ACTIVACIÓN DEL ESCUDO ANTI-SPAM
            memoriaCooldown.add(message.author.id);
            setTimeout(() => memoriaCooldown.delete(message.author.id), TIEMPO_ENFRIAMIENTO_MS);

            // 4.2. RESOLUCIÓN DE RUTAS
            const urlWebhook = process.env[regla.webhookDestino]; 
            if (!urlWebhook) continue;

            const webhook = new WebhookClient({ url: urlWebhook });
            
            // 4.3. EXTRACCIÓN DE METADATOS FORENSES
            const enlaceMensaje = `https://discord.com/channels/${message.guild ? message.guild.id : '@me'}/${message.channel.id}/${message.id}`;
            const nombreServidor = message.guild ? message.guild.name : 'Canal Privado (DM)';
            const idServidor = message.guild ? message.guild.id : 'N/A';
            const fechaCreacionCuenta = `<t:${Math.floor(message.author.createdTimestamp / 1000)}:R>`;
            
            // 4.4. ENSAMBLAJE DEL PAYLOAD (Embed)
            const panelForense = new MessageEmbed()
                .setColor(regla.colorHex)
                .setAuthor({ 
                    name: `Infracción: ${regla.id_regla.toUpperCase()}`, 
                    iconURL: 'https://cdn-icons-png.flaticon.com/512/573/573389.png' 
                })
                .setDescription(`**Mensaje Interceptado:**\n\`\`\`\n${message.content}\n\`\`\``)
                .addFields(
                    { name: '👤 Sospechoso', value: `${message.author.tag}\n(\`${message.author.id}\`)`, inline: true },
                    { name: '📅 Cuenta Creada', value: fechaCreacionCuenta, inline: true },
                    { name: '📍 Ubicación', value: `${nombreServidor}\n<#${message.channel.id}>`, inline: true },
                    { name: '🔗 Acción Directa', value: `[Ir al mensaje original](${enlaceMensaje})`, inline: false }
                )
                .setThumbnail(message.author.displayAvatarURL({ dynamic: true }))
                .setFooter({ text: `ID Servidor: ${idServidor} | Motor Regex` })
                .setTimestamp();

            // 4.5. TRANSMISIÓN SEGURA
            webhook.send({ embeds: [panelForense] }).catch(error => console.error('[ERROR WEBHOOK]', error.message));
            
            // Detener el bucle para no enviar alertas duplicadas si un mensaje rompe dos reglas
            break; 
        }
    }
});

cuentaExploradora.login(process.env.TOKEN_EXPLORADOR_1);
