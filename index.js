const { Client } = require('discord.js-selfbot-v13');
const express = require('express');
const fs = require('fs');
const { MongoClient } = require('mongodb');

// 1. IMPORTAR MÓDULOS DE INTELIGENCIA AISLADOS
const moduloSquads = require('./modulo_squads.js');
const moduloRaids = require('./modulo_raids.js');
const moduloLinks = require('./modulo_links.js');
const moduloOrg = require('./modulo_org.js');

const whitelistUsuarios = JSON.parse(fs.readFileSync('./whitelist_usuarios.json', 'utf8'));

// 2. CONEXIÓN A MONGODB ATLAS
const mongoUri = process.env.MONGO_URI;
if (!mongoUri) {
    console.error("ERROR CRÍTICO: Falta MONGO_URI.");
    process.exit(1);
}
const mongoClient = new MongoClient(mongoUri);
let blacklistCollection;

async function conectarBaseDatos() {
    try {
        await mongoClient.connect();
        const db = mongoClient.db("panoptico_db");
        blacklistCollection = db.collection("blacklist");
        console.log("[SISTEMA] Base de datos MongoDB enlazada.");
    } catch (error) {
        console.error("[ERROR BD] Fallo de conexión:", error);
    }
}
conectarBaseDatos();

// 3. LATIDO WEB (RENDER)
const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => { res.json({ estado: "operativo", nucleo: "Enjambre-Cascade-v3" }); }); 
app.listen(PORT, () => console.log(`[LATIDO] Motor activo en puerto ${PORT}`));

// 4. MEMORIA ANTI-SPAM TÁCTICA
const memoriaCooldown = new Set();
const hashMensajesRecientes = new Set();

const tokens = [];
for (let i = 1; i <= 10; i++) {
    if (process.env[`TOKEN_EXPLORADOR_${i}`]) tokens.push(process.env[`TOKEN_EXPLORADOR_${i}`]);
}

const delay = ms => new Promise(res => setTimeout(res, ms));

// 5. PROTOCOLO DE DESPLIEGUE EN CASCADA
async function iniciarEnjambre() {
    console.log(`[ENJAMBRE] Iniciando ${tokens.length} cuentas...`);

    for (let i = 0; i < tokens.length; i++) {
        const explorador = new Client({ checkUpdate: false, presence: { status: 'invisible' } });

        explorador.on('ready', () => console.log(`[PANÓPTICO-${i+1}] Infiltración activa: ${explorador.user.tag}`));

        explorador.on('messageCreate', async (message) => {
            // Filtros de inmunidad base
            if (message.author.id === explorador.user.id || message.author.bot || message.system) return;
            if (whitelistUsuarios.includes(message.author.id)) return;
            
            // Verificación de enfriamiento punitivo
            if (memoriaCooldown.has(message.author.id)) return;
            const firmaMensaje = `${message.author.id}-${message.content}`;
            if (hashMensajesRecientes.has(firmaMensaje)) return;

            try {
                // EVALUACIÓN EN CASCADA POR ORDEN DE PRIORIDAD TÁCTICA
                let interceptado = false;

                // 1º: Detección de comandos de destrucción (Alta Prioridad)
                if (!interceptado) interceptado = await moduloSquads.ejecutar(message, blacklistCollection);
                
                // 2º: Detección de alusiones a Raids
                if (!interceptado) interceptado = await moduloRaids.ejecutar(message, blacklistCollection);
                
                // 3º: Detección de spam de enlaces
                if (!interceptado) interceptado = await moduloLinks.ejecutar(message, blacklistCollection);
                
                // 4º: Telemetría pasiva de la Organización (Solo si no era un ataque)
                if (!interceptado) interceptado = await moduloOrg.ejecutar(message);

                // APLICACIÓN DE CASTIGO (Solo si un módulo detectó una anomalía)
                if (interceptado) {
                    memoriaCooldown.add(message.author.id);
                    setTimeout(() => memoriaCooldown.delete(message.author.id), 60000); // Sordera de 60s
                    hashMensajesRecientes.add(firmaMensaje);
                    setTimeout(() => hashMensajesRecientes.delete(firmaMensaje), 120000); // Anti-spam texto
                }

            } catch (error) {
                console.error(`[ESCUDO] Fallo en la cascada modular. Error: ${error.message}`);
            }
        });

        try {
            await explorador.login(tokens[i]);
            if (i < tokens.length - 1) await delay(45000); 
        } catch (e) {
            console.error(`[FALLO DE INFILTRACIÓN] Token ${i+1} inválido.`);
        }
    }
}
iniciarEnjambre();
