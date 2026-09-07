const { Client } = require('discord.js-selfbot-v13');
const fs = require('fs');
const path = require('path');

// 1. INICIALIZACIÓN DE LA INFRAESTRUCTURA BASE
const database = require('./database.js');
const servidorWeb = require('./web/servidor.js'); 

// 2. IMPORTACIÓN DINÁMICA DE MÓDULOS DE INTELIGENCIA
const moduloSquads = require('./modulos/modulo_squads.js');
const moduloRaids = require('./modulos/modulo_raids.js');
const moduloLinks = require('./modulos/modulo_links.js');
const moduloOrg = require('./modulos/modulo_org.js');

// Resolución de rutas de seguridad
const whitelistPath = path.join(__dirname, 'whitelist_usuarios.json');
const whitelistUsuarios = JSON.parse(fs.readFileSync(whitelistPath, 'utf8'));

// 3. MEMORIA ANTI-SPAM Y CONTROL DE FLUJO
const memoriaCooldown = new Set();
const hashMensajesRecientes = new Set();
const tokens = [];

// 4. MEMORIA CACHÉ LOCAL (Evade Rate Limits y Baneos de Discord)
const cacheHistorialCanales = new Map();

for (let i = 1; i <= 10; i++) {
    if (process.env[`TOKEN_EXPLORADOR_${i}`]) {
        tokens.push(process.env[`TOKEN_EXPLORADOR_${i}`]);
    }
}

if (tokens.length === 0) {
    console.error("ERROR CRÍTICO: Matriz de tokens vacía. Abortando despliegue.");
    process.exit(1);
}

const delay = ms => new Promise(res => setTimeout(res, ms));

// Mantenimiento de Memoria: Limpia canales inactivos para evitar fugas de RAM (Memory Leaks)
setInterval(() => {
    if (cacheHistorialCanales.size > 1000) {
        cacheHistorialCanales.clear();
        console.log("[SISTEMA] Vaciado cíclico de memoria caché de canales ejecutado.");
    }
}, 3600000); // Se ejecuta cada 1 hora

// 5. PROTOCOLO DE DESPLIEGUE EN CASCADA
async function iniciarEnjambre() {
    await database.conectarBaseDatos();
    servidorWeb.iniciar(); 

    console.log(`[ENJAMBRE] Desplegando ${tokens.length} unidades de reconocimiento (Modo Stealth)...`);

    for (let i = 0; i < tokens.length; i++) {
        const explorador = new Client({ checkUpdate: false, presence: { status: 'invisible' } });

        explorador.on('ready', () => console.log(`[PANÓPTICO-${i+1}] Infiltración activa: ${explorador.user.tag}`));

        explorador.on('messageCreate', async (message) => {
            // Reglas de Inmunidad Absoluta
            if (message.author.id === explorador.user.id || message.author.bot || message.system) return;
            if (whitelistUsuarios.includes(message.author.id)) return;
            
            // Ingesta continua en Memoria Volátil Local (Caché de Contexto)
            if (!cacheHistorialCanales.has(message.channel.id)) {
                cacheHistorialCanales.set(message.channel.id, []);
            }
            const bufferCanal = cacheHistorialCanales.get(message.channel.id);
            bufferCanal.push({
                authorTag: message.author.tag,
                authorId: message.author.id,
                content: message.content,
                createdTimestamp: message.createdTimestamp
            });
            // Restricción de memoria: Solo se conservan los 5 mensajes más recientes por canal
            if (bufferCanal.length > 5) bufferCanal.shift();

            // Verificación de Bloqueo por Cooldown
            if (memoriaCooldown.has(message.author.id)) return;
            const firmaMensaje = `${message.author.id}-${message.content}`;
            if (hashMensajesRecientes.has(firmaMensaje)) return;

            try {
                let interceptadoPor = null;
                // Pasamos el buffer local a los módulos para evitar que hagan peticiones HTTP a Discord
                const contextoLocal = [...bufferCanal]; 

                // Evaluación Asíncrona en Cascada
                if (await moduloSquads.ejecutar(message, contextoLocal)) interceptadoPor = 'SQUADS';
                else if (await moduloRaids.ejecutar(message, contextoLocal)) interceptadoPor = 'RAIDS';
                else if (await moduloLinks.ejecutar(message)) interceptadoPor = 'LINKS';
                else if (await moduloOrg.ejecutar(message, contextoLocal)) interceptadoPor = 'ORG';

                // Aplicación de Cooldown Selectivo
                if (interceptadoPor) {
                    if (interceptadoPor === 'LINKS' || interceptadoPor === 'SQUADS') {
                        memoriaCooldown.add(message.author.id);
                        setTimeout(() => memoriaCooldown.delete(message.author.id), 10000); 
                        
                        hashMensajesRecientes.add(firmaMensaje);
                        setTimeout(() => hashMensajesRecientes.delete(firmaMensaje), 120000); 
                    }
                }

            } catch (error) {
                console.error(`[ESCUDO DEFENSIVO] Fallo detectado en la matriz. Error: ${error.message}`);
            }
        });

        try {
            await explorador.login(tokens[i]);
            if (i < tokens.length - 1) await delay(45000); 
        } catch (e) {
            console.error(`[FALLO DE INFILTRACIÓN] El token de la unidad ${i+1} ha sido revocado.`);
        }
    }
}

iniciarEnjambre();
