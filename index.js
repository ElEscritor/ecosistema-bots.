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

// VARIABLE GLOBAL DE BASE DE DATOS PARA EL SERVIDOR WEB
let coleccionBD;

// 2. SUBSISTEMA DE SUPERVIVENCIA WEB Y PANEL FORENSE (RENDER)
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware de Seguridad (Autenticación Básica)
const bloqueoSeguridad = (req, res, next) => {
    const b64auth = (req.headers.authorization || '').split(' ')[1] || '';
    const [login, password] = Buffer.from(b64auth, 'base64').toString().split(':');
    const adminPass = process.env.PANEL_PASSWORD;

    if (!adminPass) {
        return res.status(500).send('ERROR: La variable PANEL_PASSWORD no está configurada en Render.');
    }

    if (login === 'admin' && password === adminPass) {
        return next();
    }
    res.set('WWW-Authenticate', 'Basic realm="Acceso Restringido al Panóptico"');
    res.status(401).send('Acceso denegado. Credenciales incorrectas.');
};

// Ruta de estado público (Latido para Render)
app.get('/', (req, res) => { 
    res.json({ estado: "operativo", nucleo: "Enjambre-Cascade-v6-Exportacion" }); 
}); 

// Ruta de Descarga Segura de Base de Datos (CSV)
app.get('/panel/exportar', bloqueoSeguridad, async (req, res) => {
    if (!coleccionBD) return res.status(503).send('Base de datos no inicializada aún.');
    
    try {
        const infractores = await coleccionBD.find({}).sort({ totalInfracciones: -1 }).toArray();
        
        // Cabeceras del archivo Excel/CSV
        let csv = 'ID_Sujeto,Alias,Total_Infracciones,Fecha_Primer_Ingreso,Ultima_Accion_Registrada\n';
        
        infractores.forEach(inf => {
            // Limpieza de comas en cadenas de texto para evitar roturas de columna en el CSV
            const alias = (inf.ultimoAlias || inf.nombreUsuario || 'Desconocido').replace(/,/g, '');
            const total = inf.totalInfracciones || 1;
            const fecha = new Date(inf.primerFichaje || inf.fechaFichaje).toLocaleDateString('es-ES');
            
            let ultimaAccion = "Desconocida";
            if (inf.historial && inf.historial.length > 0) {
                ultimaAccion = inf.historial[inf.historial.length - 1].accion.replace(/,/g, '');
            } else if (inf.accion) {
                ultimaAccion = inf.accion.replace(/,/g, '');
            }

            // Ensamblaje de la fila
            csv += `${inf.userId},${alias},${total},${fecha},${ultimaAccion}\n`;
        });

        // Forzar al navegador a descargar el archivo en lugar de mostrarlo como texto
        res.header('Content-Type', 'text/csv');
        res.attachment(`Panoptico_Registros_${new Date().toISOString().split('T')[0]}.csv`);
        res.send(csv);
    } catch (error) {
        res.status(500).send('Error crítico al procesar la exportación del archivo.');
    }
});

// Ruta del Panel Forense (Protegida)
app.get('/panel', bloqueoSeguridad, async (req, res) => {
    if (!coleccionBD) return res.status(503).send('Base de datos no inicializada aún.');
    
    try {
        const infractores = await coleccionBD.find({}).sort({ totalInfracciones: -1 }).toArray();
        
        let filasHTML = '';
        infractores.forEach(inf => {
            const alias = inf.ultimoAlias || inf.nombreUsuario || 'Desconocido';
            const total = inf.totalInfracciones || 1;
            const fecha = new Date(inf.primerFichaje || inf.fechaFichaje).toLocaleDateString('es-ES');
            
            let ultimaAccion = "Desconocida";
            if (inf.historial && inf.historial.length > 0) {
                ultimaAccion = inf.historial[inf.historial.length - 1].accion;
            } else if (inf.accion) {
                ultimaAccion = inf.accion;
            }

            filasHTML += `
                <tr>
                    <td><code>${inf.userId}</code></td>
                    <td><strong>${alias}</strong></td>
                    <td style="color: #ff5252; font-weight: bold;">${total}</td>
                    <td>${fecha}</td>
                    <td>${ultimaAccion}</td>
                </tr>
            `;
        });

        const html = `
        <!DOCTYPE html>
        <html lang="es">
        <head>
            <meta charset="UTF-8">
            <title>Panóptico - Base de Datos</title>
            <style>
                body { background-color: #1e1e24; color: #cfd2d6; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 40px; margin: 0; }
                .header-container { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #ed4245; padding-bottom: 10px; margin-bottom: 20px; }
                h1 { color: #ffffff; margin: 0; }
                .download-btn { background-color: #3ba55c; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px; font-weight: bold; transition: background-color 0.2s; }
                .download-btn:hover { background-color: #2d7d46; }
                table { width: 100%; border-collapse: collapse; background-color: #2b2d31; border-radius: 8px; overflow: hidden; }
                th, td { padding: 15px; text-align: left; border-bottom: 1px solid #1e1f22; }
                th { background-color: #111214; color: #a3a6aa; text-transform: uppercase; font-size: 12px; letter-spacing: 1px; }
                tr:hover { background-color: #313338; }
                code { background-color: #111214; padding: 4px 8px; border-radius: 4px; font-family: monospace; color: #00a8fc; }
                .stats { margin-bottom: 20px; font-size: 14px; color: #a3a6aa; }
            </style>
        </head>
        <body>
            <div class="header-container">
                <h1>🛡️ Registro de Expedientes Criminales</h1>
                <a href="/panel/exportar" class="download-btn">⬇️ Exportar CSV (Excel)</a>
            </div>
            <div class="stats">Total de sujetos fichados: <strong>${infractores.length}</strong></div>
            <table>
                <thead>
                    <tr>
                        <th>ID del Sujeto</th>
                        <th>Último Alias</th>
                        <th>Infracciones</th>
                        <th>Fecha de Ingreso</th>
                        <th>Última Actividad Hostil</th>
                    </tr>
                </thead>
                <tbody>
                    ${filasHTML}
                </tbody>
            </table>
        </body>
        </html>
        `;
        res.send(html);
    } catch (error) {
        res.status(500).send('Error interno leyendo la base de datos.');
    }
});

app.listen(PORT, () => console.log(`[LATIDO] Motor web activo en puerto ${PORT}`));

// 3. MEMORIA ANTI-SPAM TÁCTICA Y CONTROL DE FLUJO
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

// 4. PROTOCOLO DE DESPLIEGUE EN CASCADA
async function iniciarEnjambre() {
    // Almacenamos la colección en la variable global para que Express la lea
    coleccionBD = await database.conectarBaseDatos();

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
                if (!interceptado) interceptado = await moduloSquads.ejecutar(message, coleccionBD);
                if (!interceptado) interceptado = await moduloRaids.ejecutar(message, coleccionBD);
                if (!interceptado) interceptado = await moduloLinks.ejecutar(message, coleccionBD);
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
