const { Client, WebhookClient } = require('discord.js-selfbot-v13');
const express = require('express');
const fs = require('fs');

// 1. LECTURA DEL ARCHIVO EXTERNO DE REGLAS
const reglas = JSON.parse(fs.readFileSync('./reglas.json', 'utf8'));

// 2. SISTEMA API PARA TU FUTURO PANEL DE CONTROL
const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => {
    // Esta línea mágica permite que Vercel se conecte a Render sin ser bloqueado
    res.set('Access-Control-Allow-Origin', '*'); 
    res.json({ estado: "online", bot: "Panóptico" });
});
app.listen(PORT, () => console.log(`API de Monitorización en puerto ${PORT}`));

// 3. INICIALIZACIÓN DEL EXPLORADOR
const cuentaExploradora = new Client({ checkUpdate: false });

cuentaExploradora.on('ready', () => {
    console.log(`[PANÓPTICO EN LÍNEA] Cuenta conectada: ${cuentaExploradora.user.tag}`);
});

cuentaExploradora.on('messageCreate', (message) => {
    if (message.author.id === cuentaExploradora.user.id) return;

    const contenidoMensaje = message.content.toLowerCase();

    reglas.forEach(regla => {
        if (contenidoMensaje.includes(regla.palabraClave.toLowerCase())) {
            
            // Busca la URL secreta en Render usando el nombre que pusiste en el JSON
            const urlWebhook = process.env[regla.webhookDestino]; 
            
            if (!urlWebhook) {
                console.error(`Error: No existe la variable de entorno ${regla.webhookDestino} en Render.`);
                return;
            }

            const webhook = new WebhookClient({ url: urlWebhook });
            const nombreServidor = message.guild ? message.guild.name : 'Mensaje Directo';
            const nombreCanal = message.channel.name ? `#${message.channel.name}` : 'Privado';

            webhook.send({
                content: `🚨 **INTERCEPCIÓN DETECTADA**\n**Origen:** ${nombreServidor} (${nombreCanal})\n**Sujeto:** ${message.author.tag}\n**Evidencia:** "${message.content}"`
            }).catch(error => console.error('Error Webhook:', error));
        }
    });
});

cuentaExploradora.login(process.env.TOKEN_EXPLORADOR_1);
