const { Client } = require('discord.js-selfbot-v13');
const express = require('express');
const fs = require('fs');
const { MongoClient } = require('mongodb');

// 1. IMPORTAR MÓDULOS ESPECIALIZADOS
const moduloRaids = require('./modulo_raids.js');
const moduloLinks = require('./modulo_links.js');
const moduloOrg = require('./modulo_org.js');

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
    res.json({ estado: "operativo", nucleo: "Enjambre-v2" });
}); 
app.listen(PORT, () => console.log(`[LATIDO] Motor web activo en puerto ${PORT}`));

// 5. MEMORIA ANTI-SPAM GLOBAL (Compartida por todo el enjambre)
const memoriaCooldown = new Set();
const hashMensajesRecientes = new Set();

// 6. EXTRACCIÓN DINÁMICA DE TOKENS
const tokens = [];
for (let i = 1; i <= 10; i++) {
    if (process.env[`TOKEN_EXPLORADOR_${i}`]) {
        tokens.push(process.env[`TOKEN_EXPLORADOR_${i}`]);
    }
}

if (tokens.length === 0) {
    console.error("ERROR CRÍTICO: No se encontraron tokens de exploradores (TOKEN_EXPLORADOR_1) en Render.");
    process.exit(1);
}

// Función de retardo táctico para evasión de radar
const delay = ms => new Promise(res => setTimeout(res, ms));

// 7. PROTOCOLO DE DESPLIEGUE ESCALONADO
async function iniciarEnjambre() {
    console.log(`[ENJAMBRE] Iniciando despliegue de ${tokens.length} cuentas de inteligencia...`);

    for (let i = 0; i < tokens.length; i++) {
        const cuentaExploradora = new Client({
            checkUpdate: false,
            presence: { status: 'invisible' }
        });

        cuentaExploradora.on('ready', () => {
            console.log(`[PANÓPTICO-${i+1}] Infiltración activa. Usuario: ${cuentaExploradora.user.tag}`);
        });

        cuentaExploradora.on('messageCreate', async (message) => {
            if (message.author.id === cuentaExploradora.user.id || message.author.bot || message.system) return;
            if (whitelistUsuarios.includes(message.author.id)) return;
            if (memoriaCooldown.has(message.author.id)) return;

            const firmaMensaje = `${message.author.id}-${message.content}`;
            if (hashMensajesRecientes.has(firmaMensaje)) return;

            memoriaCooldown.add(message.author.id);
            setTimeout(() => memoriaCooldown.delete(message.author.id), 60000);
            hashMensajesRecientes.add(firmaMensaje);
            setTimeout(() => hashMensajesRecientes.delete(firmaMensaje), 120000);

            try {
                const esRaid = await moduloRaids.ejecutar(message, blacklistCollection);
                if (esRaid) return; 

                const esEnlace = await moduloLinks.ejecutar(message, blacklistCollection);
                if (esEnlace) return; 

                const esMencionOrg = await moduloOrg.ejecutar(message, blacklistCollection);
                if (esMencionOrg) return;

            } catch (error) {
                console.error(`[ESCUDO ACTIVO] Un módulo falló. Error: ${error.message}`);
            }
        });

        try {
            await cuentaExploradora.login(tokens[i]);
            
            // Pausa obligatoria entre conexiones para evitar bloqueos por IP
            if (i < tokens.length - 1) {
                console.log(`[ENJAMBRE] Esperando 45 segundos antes de infiltrar la siguiente cuenta para evadir defensas...`);
                await delay(45000); 
            }
        } catch (error) {
            console.error(`[FALLO DE INFILTRACIÓN] Token ${i+1} inválido, caducado o bloqueado por Discord.`);
        }
    }
    console.log(`[ENJAMBRE] Despliegue de inteligencia completado. Todas las cuentas operativas.`);
}

iniciarEnjambre();
