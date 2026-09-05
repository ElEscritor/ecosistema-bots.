const { Client } = require('discord.js-selfbot-v13');
const express = require('express');
const fs = require('fs');
const { MongoClient } = require('mongodb');

// 1. IMPORTAR MÓDULOS ESPECIALIZADOS
const moduloRaids = require('./modulo_raids.js');
const moduloLinks = require('./modulo_links.js');

// 2. DATOS GLOBALES
const whitelistUsuarios = JSON.parse(fs.readFileSync('./whitelist_usuarios.json', 'utf8'));

// 3. CONEXIÓN A MONGODB ATLAS
const mongoUri = process.env.MONGO_URI;
if (!mongoUri) {
    console.error("ERROR CRÍTICO: Falta la variable MONGO_URI en Render.");
    process.exit(1);
}
const mongoClient = new MongoClient(mongoUri);
let blacklistCollection;

async function conectarBaseDatos() {
    try {
        await mongoClient.connect();
        const db = mongoClient.db("panoptico_db");
        blacklistCollection = db.collection("blacklist");
        console.log("[SISTEMA] Base de datos MongoDB enlazada con éxito.");
    } catch (error) {
        console.error("[ERROR BD] Fallo de conexión:", error);
    }
}
conectarBaseDatos();

// 4. LATIDO WEB (SUPERVIVENCIA EN RENDER)
const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.json({ estado: "operativo", nucleo: "Modular-Enrutador-v1" });
}); 
app.listen(PORT, () => console.log(`[LATIDO] Motor web activo en puerto ${PORT}`));

// 5. MEMORIA ANTI-SPAM GLOBAL
const memoriaCooldown = new Set();
const hashMensajesRecientes = new Set();

// 6. INICIO DEL BOT
const cuentaExploradora = new Client({
    checkUpdate: false,
    presence: { status: 'invisible' }
});

cuentaExploradora.on('ready', () => {
    console.log(`[PANÓPTICO] Infiltración activa. Usuario: ${cuentaExploradora.user.tag}`);
});

// 7. ENRUTADOR DE INTELIGENCIA
cuentaExploradora.on('messageCreate', async (message) => {
    
    // Filtros Iniciales
    if (message.author.id === cuentaExploradora.user.id || message.author.bot || message.system) return;
    if (whitelistUsuarios.includes(message.author.id)) return;
    if (memoriaCooldown.has(message.author.id)) return;

    const firmaMensaje = `${message.author.id}-${message.content}`;
    if (hashMensajesRecientes.has(firmaMensaje)) return;

    // Escudos temporales
    memoriaCooldown.add(message.author.id);
    setTimeout(() => memoriaCooldown.delete(message.author.id), 60000);
    hashMensajesRecientes.add(firmaMensaje);
    setTimeout(() => hashMensajesRecientes.delete(firmaMensaje), 120000);

// Enrutamiento seguro a módulos
    try {
        // Enviar al Especialista de Raids
        const esRaid = await moduloRaids.ejecutar(message, blacklistCollection);
        if (esRaid) return; // Si fue procesado como raid, el ciclo termina aquí.

        // Enviar al Especialista de Enlaces (INYECCIÓN B)
        const esEnlace = await moduloLinks.ejecutar(message, blacklistCollection);
        if (esEnlace) return; 

    } catch (error) {
        console.error(`[ESCUDO ACTIVO] Un módulo falló, pero el núcleo sigue vivo. Error: ${error.message}`);
    }

cuentaExploradora.login(process.env.TOKEN_EXPLORADOR_1);
