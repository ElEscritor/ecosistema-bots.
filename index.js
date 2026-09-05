const { Client } = require('discord.js-selfbot-v13');
const express = require('express');
const fs = require('fs');

// 1. IMPORTACIÓN ESTRUCTURAL DE MÓDULOS DE INTELIGENCIA
const database = require('./database.js');
const moduloExpedientes = require('./modulo_expedientes.js');
const moduloSquads = require('./modulo_squads.js');
const moduloRaids = require('./modulo_raids.js');
const moduloLinks = require('./modulo_links.js');
const moduloOrg = require('./modulo_org.js');

const whitelistUsuarios = JSON.parse(fs.readFileSync('./whitelist_usuarios.json', 'utf8'));

// 2. SUBSISTEMA DE SUPERVIVENCIA WEB (RENDER)
const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => { res.json({ estado: "operativo", nucleo: "Enjambre-Cascade-v4-Expedientes" }); }); 
app.listen(PORT, () => console.log(`[LATIDO] Motor activo en puerto ${PORT}`));

// 3. MEMORIA ANTI-SPAM TÁCTICA Y CONTROL DE FLUJO
const memoriaCooldown = new Set();
const hashMensajesRecientes = new Set();

// 4. EXTRACCIÓN DINÁMICA DE TOKENS (SOPORTE PARA 10 EXPLORADORES)
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

// 5. PROTOCOLO DE DESPLIEGUE EN CASCADA Y ARRANQUE DE INFRAESTRUCTURA
async function iniciarEnjambre() {
    // Inicialización del modelo Singleton para la base de datos
    const blacklistCollection = await database.conectarBaseDatos();

    console.log(`[ENJAMBRE] Iniciando despliegue de ${tokens.length} unidades de reconocimiento...`);

    for (let i = 0; i < tokens.length; i++) {
        const explorador = new Client({ checkUpdate: false, presence: { status: 'invisible' } });

        explorador.on('ready', () => console.log(`[PANÓPTICO-${i+1}] Infiltración activa: ${explorador.user.tag}`));

        explorador.on('messageCreate', async (message) => {
            // Filtros de inmunidad absoluta (Prevención de bucles de retroalimentación)
            if (message.author.id === explorador.user.id || message.author.bot || message.system) return;
            if (whitelistUsuarios.includes(message.author.id)) return;
            
            // Verificación de aislamiento punitivo
            if (memoriaCooldown.has(message.author.id)) return;
            const firmaMensaje = `${message.author.id}-${message.content}`;
            if (hashMensajesRecientes.has(firmaMensaje)) return;

            try {
                // EVALUACIÓN DE AMENAZAS EN CASCADA (Mapeo de responsabilidades secuenciales)
                let interceptado = false;

                // Prioridad 0: Consultas Administrativas (Expedientes Forenses)
                if (!interceptado) interceptado = await moduloExpedientes.ejecutar(message);

                // Prioridad 1: Detección de comandos de destrucción masiva
                if (!interceptado) interceptado = await moduloSquads.ejecutar(message, blacklistCollection);
                
                // Prioridad 2: Intercepción de alusiones y organización de Raids
                if (!interceptado) interceptado = await moduloRaids.ejecutar(message, blacklistCollection);
                
                // Prioridad 3: Análisis de vectores de distribución de Spam/Enlaces
                if (!interceptado) interceptado = await moduloLinks.ejecutar(message, blacklistCollection);
                
                // Prioridad 4: Telemetría pasiva de la Organización (Requiere confirmación de civil)
                if (!interceptado) interceptado = await moduloOrg.ejecutar(message);

                // PROTOCOLO DE CASTIGO TEMPORAL (Solo aplicable ante anomalías confirmadas)
                if (interceptado) {
                    memoriaCooldown.add(message.author.id);
                    setTimeout(() => memoriaCooldown.delete(message.author.id), 60000); // 60 segundos de silencio
                    
                    hashMensajesRecientes.add(firmaMensaje);
                    setTimeout(() => hashMensajesRecientes.delete(firmaMensaje), 120000); // Prevención de clonación
                }

            } catch (error) {
                console.error(`[ESCUDO DEFENSIVO] Fallo detectado en la matriz de cascada modular. Error: ${error.message}`);
            }
        });

        try {
            await explorador.login(tokens[i]);
            // Evasión de heurísticas de Discord mediante desincronización de peticiones WebSocket
            if (i < tokens.length - 1) await delay(45000); 
        } catch (e) {
            console.error(`[FALLO DE INFILTRACIÓN] El token de la unidad ${i+1} ha sido revocado o es inválido.`);
        }
    }
    
    console.log(`[ENJAMBRE] Malla de inteligencia completamente desplegada y enlazada al motor MongoDB.`);
}

iniciarEnjambre();
