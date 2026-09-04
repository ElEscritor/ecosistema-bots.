const { Client, WebhookClient } = require('discord.js-selfbot-v13');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Panóptico Activo y Vigilando 24/7'));
app.listen(PORT, () => console.log(`Servidor de supervivencia en puerto ${PORT}`));

const reglas = [
    {
        palabraClave: "urgente", 
        webhookUrl: process.env.WEBHOOK_1 
    }
];

const cuentaExploradora = new Client({
    checkUpdate: false
});

cuentaExploradora.on('ready', () => {
    console.log(`[PANÓPTICO EN LÍNEA] Cuenta conectada exitosamente como: ${cuentaExploradora.user.tag}`);
});

cuentaExploradora.on('messageCreate', (message) => {
    // Evita que la cuenta reaccione a sus propios mensajes si llegara a escribir algo
    if (message.author.id === cuentaExploradora.user.id) return;

    const contenidoMensaje = message.content.toLowerCase();

    reglas.forEach(regla => {
        if (contenidoMensaje.includes(regla.palabraClave.toLowerCase())) {
            const webhook = new WebhookClient({ url: regla.webhookUrl });
            
            // Operador ternario añadido para evitar colapsos si el mensaje proviene de un canal privado (DM)
            const nombreServidor = message.guild ? message.guild.name : 'Mensaje Directo';
            const nombreCanal = message.channel.name ? `#${message.channel.name}` : 'Privado';

            webhook.send({
                content: `🚨 **INTERCEPCIÓN DETECTADA**\n**Origen:** ${nombreServidor} (${nombreCanal})\n**Sujeto:** ${message.author.tag}\n**Evidencia:** "${message.content}"`
            }).catch(error => console.error('Error crítico de transmisión Webhook:', error));
        }
    });
});

cuentaExploradora.login(process.env.TOKEN_EXPLORADOR_1);
