const { Client, GatewayIntentBits, WebhookClient } = require('discord.js');
const express = require('express');

// 1. SISTEMA DE SUPERVIVENCIA (Keep-Alive)
// Este miniservidor web interno será el objetivo de nuestro futuro sistema de "ping"
const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Panóptico Activo y Vigilando 24/7'));
app.listen(PORT, () => console.log(`Servidor de supervivencia en puerto ${PORT}`));

// 2. MATRIZ DE REGLAS DE DETECCIÓN Y ENRUTAMIENTO
// Aquí defines qué palabra clave detona qué Webhook.
const reglas = [
    {
        palabraClave: "urgente", 
        webhookUrl: process.env.WEBHOOK_1 
    }
    // Para añadir más reglas en el futuro, simplemente copia y pega el bloque superior
    // añadiendo una coma antes de abrir las nuevas llaves.
];

// 3. INICIALIZACIÓN DEL BOT EXPLORADOR (Scout)
const botExplorador = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent // Permiso crítico y obligatorio para leer el texto
    ] 
});

botExplorador.on('ready', () => {
    console.log(`[PANÓPTICO EN LÍNEA] Explorador conectado exitosamente como: ${botExplorador.user.tag}`);
});

botExplorador.on('messageCreate', (message) => {
    // Ignorar mensajes de otros bots (prevención estricta de bucles infinitos)
    if (message.author.bot) return;

    const contenidoMensaje = message.content.toLowerCase();

    // Evaluar el mensaje entrante contra toda la matriz de reglas iterativamente
    reglas.forEach(regla => {
        if (contenidoMensaje.includes(regla.palabraClave.toLowerCase())) {
            const webhook = new WebhookClient({ url: regla.webhookUrl });
            webhook.send({
                content: `🚨 **INTERCEPCIÓN DETECTADA**\n**Origen:** ${message.guild.name} (#${message.channel.name})\n**Sujeto:** ${message.author.tag}\n**Evidencia:** "${message.content}"`
            }).catch(error => console.error('Error crítico de transmisión Webhook:', error));
        }
    });
});

// 4. IGNICIÓN DEL NÚCLEO
botExplorador.login(process.env.TOKEN_EXPLORADOR_1);
