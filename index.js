const { Client } = require('discord.js-selfbot-v13');
const fs = require('fs');

// 1. IMPORTACIÓN ESTRUCTURAL DE MÓDULOS DE INTELIGENCIA
const database = require('./database.js');
const servidorWeb = require('./servidor_web.js'); // <-- Importamos el nuevo servidor
const moduloExpedientes = require('./modulo_expedientes.js');
const moduloSquads = require('./modulo_squads.js');
const moduloRaids = require('./modulo_raids.js');
const moduloLinks = require('./modulo_links.js');
const moduloOrg = require('./modulo_org.js');

const whitelistUsuarios = JSON.parse(fs.readFileSync('./whitelist_usuarios.json', 'utf8'));

// 2. MEMORIA ANTI-SPAM TÁCTICA Y CONTROL DE FLUJO
const memoriaCooldown = new Set();
const hashMensajesRecientes = new Set();

const tokens = [];
for (let i = 1; i <= 10; i++) {
    if (process.env[`TOKEN_EXPLORADOR_${i}`]) {
        tokens.push(process.env[`TOKEN_EXPLORADOR_${i}`]);
    }
}

if (tokens.length === 0) {
    console.error("ERROR CRÍTICO: No se detectaron tokens de infiltración.");
    process.exit(1);
}

const delay = ms => new Promise(res => setTimeout(res, ms));

// 3. PROTOCOLO DE DESPLIEGUE EN CASCADA
async function iniciarEnjambre() {
    // 3.1. Arranque de Infraestructura de Soporte
    await database.conectarBaseDatos();
    servidorWeb.iniciar(); // <-- Iniciamos la interfaz web en su propio hilo

    console.log(`[ENJAMBRE] Iniciando despliegue de ${tokens.length} unidades de reconocimiento...`);

    for (let i = 0; i < tokens.length; i++) {
        const explorador = new Client({ checkUpdate: false, presence: { status: 'invisible' } });

        explorador.on('ready', () => console.log(`[PANÓPTICO-${i+1}] Infiltración activa: ${explorador.user.tag}`));

        explorador.on('messageCreate', async (message) => {
            if (message.author.id === explorador.user.id || message.author.bot || message.system) return;
            if (whitelistUsuarios.includes(message.author.id)) return;
            
            if (memoriaCooldown.has(message.author.id)) return;
            const firmaMensaje = `${message.author.id}-${message.content}`;
            if (hashMensajesRecientes.has(firmaMensaje)) return;

            try {
                let interceptado = false;

                if (!interceptado) interceptado = await moduloExpedientes.ejecutar(message);
                if (!interceptado) interceptado = await moduloSquads.ejecutar(message);
                if (!interceptado) interceptado = await moduloRaids.ejecutar(message);
                if (!interceptado) interceptado = await moduloLinks.ejecutar(message);
                if (!interceptado) interceptado = await moduloOrg.ejecutar(message);

                if (interceptado) {
                    memoriaCooldown.add(message.author.id);
                    setTimeout(() => memoriaCooldown.delete(message.author.id), 60000); 
                    hashMensajesRecientes.add(firmaMensaje);
                    setTimeout(() => hashMensajesRecientes.delete(firmaMensaje), 120000); 
                }

            } catch (error) {
                console.error(`[ESCUDO DEFENSIVO] Fallo detectado. Error: ${error.message}`);
            }
        });

        try {
            await explorador.login(tokens[i]);
            if (i < tokens.length - 1) await delay(45000); 
        } catch (e) {
            console.error(`[FALLO DE INFILTRACIÓN] El token de la unidad ${i+1} es inválido.`);
        }
    }
    console.log(`[ENJAMBRE] Malla de inteligencia completamente desplegada.`);
}

iniciarEnjambre();
