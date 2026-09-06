const { Client } = require('discord.js-selfbot-v13');
const express = require('express');
const fs = require('fs');

// 1. IMPORTACIÓN DE MÓDULOS DE INTELIGENCIA
const database = require('./database.js');
const moduloSquads = require('./modulo_squads.js');
const moduloRaids = require('./modulo_raids.js');
const moduloLinks = require('./modulo_links.js');
const moduloOrg = require('./modulo_org.js');

const whitelistUsuarios = JSON.parse(fs.readFileSync('./whitelist_usuarios.json', 'utf8'));

// ==========================================
// 2. SUBSISTEMA WEB (PANEL FORENSE SEGURO)
// ==========================================
const app = express();
const PORT = process.env.PORT || 3000;
app.use(express.urlencoded({ extended: true }));

const bloqueoSeguridad = (req, res, next) => {
    const b64auth = (req.headers.authorization || '').split(' ')[1] || '';
    const [login, password] = Buffer.from(b64auth, 'base64').toString().split(':');
    const adminPass = process.env.PANEL_PASSWORD;

    if (!adminPass) return res.status(500).send('ERROR: Configura PANEL_PASSWORD en Render.');
    if (login === 'admin' && password === adminPass) return next();
    
    res.set('WWW-Authenticate', 'Basic realm="Acceso Restringido al Panóptico"');
    res.status(401).send('Acceso denegado. Credenciales requeridas.');
};

// Ruta de estado
app.get('/', (req, res) => res.json({ estado: "operativo", nucleo: "Panoptico-Stealth-v7" }));

// Acción: Eliminar Expediente
app.post('/panel/eliminar', bloqueoSeguridad, async (req, res) => {
    const { userId } = req.body;
    if (userId) await database.eliminarExpediente(userId);
    res.redirect('/panel'); 
});

// Acción: Exportar CSV
app.get('/panel/exportar', bloqueoSeguridad, async (req, res) => {
    try {
        const query = req.query.q || '';
        let filtro = query ? { $or: [{ userId: new RegExp(query, 'i') }, { ultimoAlias: new RegExp(query, 'i') }] } : {};
        
        const infractores = await database.obtenerExpedientes(filtro);
        let csv = 'ID_Sujeto,Alias,Total_Infracciones,Fecha_Primer_Ingreso,Ultima_Accion_Registrada\n';
        
        infractores.forEach(inf => {
            const alias = (inf.ultimoAlias || inf.nombreUsuario || 'Desconocido').replace(/,/g, '');
            const total = inf.totalInfracciones || 1;
            const fecha = new Date(inf.primerFichaje || inf.fechaFichaje).toLocaleDateString('es-ES');
            const ultimaAccion = (inf.historial?.slice(-1)[0]?.accion || inf.accion || "Desconocida").replace(/,/g, '');
            csv += `${inf.userId},${alias},${total},${fecha},${ultimaAccion}\n`;
        });

        res.header('Content-Type', 'text/csv');
        res.attachment(`Panoptico_Registros_${new Date().toISOString().split('T')[0]}.csv`);
        res.send(csv);
    } catch (error) { res.status(500).send('Error procesando exportación.'); }
});

// Interfaz Gráfica (Buscador y Tabla)
app.get('/panel', bloqueoSeguridad, async (req, res) => {
    try {
        const query = req.query.q || '';
        let filtro = query ? { $or: [{ userId: new RegExp(query, 'i') }, { ultimoAlias: new RegExp(query, 'i') }] } : {};

        const infractores = await database.obtenerExpedientes(filtro);
        let filasHTML = '';
        
        infractores.forEach(inf => {
            const alias = inf.ultimoAlias || inf.nombreUsuario || 'Desconocido';
            const total = inf.totalInfracciones || 1;
            const fecha = new Date(inf.primerFichaje || inf.fechaFichaje).toLocaleDateString('es-ES');
            const ultimaAccion = inf.historial?.slice(-1)[0]?.accion || inf.accion || "Desconocida";

            filasHTML += `
                <tr>
                    <td><code>${inf.userId}</code></td>
                    <td><strong>${alias}</strong></td>
                    <td style="color: #ff5252; font-weight: bold;">${total}</td>
                    <td>${fecha}</td>
                    <td>${ultimaAccion}</td>
                    <td style="text-align: center;">
                        <form method="POST" action="/panel/eliminar" style="margin: 0;">
                            <input type="hidden" name="userId" value="${inf.userId}">
                            <button type="submit" class="delete-btn" onclick="return confirm('ATENCIÓN: ¿Borrar expediente de ${alias}?')">🗑️ Purga</button>
                        </form>
                    </td>
                </tr>
            `;
        });

        res.send(`
        <!DOCTYPE html>
        <html lang="es">
        <head>
            <meta charset="UTF-8">
            <title>Panóptico - Base de Datos</title>
            <style>
                body { background-color: #1e1e24; color: #cfd2d6; font-family: 'Segoe UI', Tahoma, sans-serif; padding: 40px; margin: 0; }
                .header-container { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #ed4245; padding-bottom: 10px; margin-bottom: 20px; }
                h1 { color: #ffffff; margin: 0; }
                .btn { background-color: #5865F2; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px; border: none; font-weight: bold; cursor: pointer; }
                .btn-export { background-color: #3ba55c; }
                .btn-clear { background-color: #4f545c; }
                .delete-btn { background-color: #ed4245; color: white; border: none; border-radius: 4px; padding: 6px 12px; cursor: pointer; font-weight: bold; }
                .delete-btn:hover { background-color: #da373c; }
                table { width: 100%; border-collapse: collapse; background-color: #2b2d31; border-radius: 8px; overflow: hidden; }
                th, td { padding: 15px; text-align: left; border-bottom: 1px solid #1e1f22; }
                th { background-color: #111214; color: #a3a6aa; text-transform: uppercase; font-size: 12px; }
                tr:hover { background-color: #313338; }
                code { background-color: #111214; padding: 4px 8px; border-radius: 4px; color: #00a8fc; }
                .search-bar { display: flex; gap: 10px; margin-bottom: 20px; }
                .search-input { flex: 1; padding: 12px; border-radius: 4px; border: 1px solid #1e1f22; background-color: #111214; color: white; font-size: 16px; }
            </style>
        </head>
        <body>
            <div class="header-container">
                <h1>🛡️ Registro de Expedientes</h1>
                <a href="/panel/exportar?q=${query}" class="btn btn-export">⬇️ Exportar CSV</a>
            </div>
            <form method="GET" action="/panel" class="search-bar">
                <input type="text" name="q" class="search-input" placeholder="Buscar por ID o Alias..." value="${query}">
                <button type="submit" class="btn">🔍 Buscar</button>
                <a href="/panel" class="btn btn-clear">❌ Limpiar</a>
            </form>
            <div style="margin-bottom: 15px;">Sujetos filtrados: <strong>${infractores.length}</strong></div>
            <table>
                <thead>
                    <tr>
                        <th>ID del Sujeto</th>
                        <th>Alias</th>
                        <th>Infracciones</th>
                        <th>Primer Ingreso</th>
                        <th>Última Actividad</th>
                        <th style="text-align: center;">Acción</th>
                    </tr>
                </thead>
                <tbody>${filasHTML}</tbody>
            </table>
        </body>
        </html>
        `);
    } catch (error) { res.status(500).send('Error cargando la base de datos.'); }
});

app.listen(PORT, () => console.log(`[LATIDO] Servidor Web UI activo en puerto ${PORT}`));

// ==========================================
// 3. ENJAMBRE DE INTELIGENCIA TÁCTICA
// ==========================================
const memoriaCooldown = new Set();
const hashMensajesRecientes = new Set();
const tokens = [];

for (let i = 1; i <= 10; i++) {
    if (process.env[`TOKEN_EXPLORADOR_${i}`]) tokens.push(process.env[`TOKEN_EXPLORADOR_${i}`]);
}

if (tokens.length === 0) {
    console.error("ERROR CRÍTICO: No hay tokens de explorador.");
    process.exit(1);
}

const delay = ms => new Promise(res => setTimeout(res, ms));

async function iniciarEnjambre() {
    await database.conectarBaseDatos();
    console.log(`[ENJAMBRE] Desplegando ${tokens.length} unidades (Modo Stealth)...`);

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
                let interceptadoPor = null;

                // CASCADA DE EVALUACIÓN
                if (await moduloSquads.ejecutar(message)) interceptadoPor = 'SQUADS';
                else if (await moduloRaids.ejecutar(message)) interceptadoPor = 'RAIDS';
                else if (await moduloLinks.ejecutar(message)) interceptadoPor = 'LINKS';
                else if (await moduloOrg.ejecutar(message)) interceptadoPor = 'ORG';

                if (interceptadoPor) {
                    // COOLDOWN SELECTIVO: Solo ensordecer el bot si es Spam (Links) o Comandos masivos (Squads)
                    if (interceptadoPor === 'LINKS' || interceptadoPor === 'SQUADS') {
                        memoriaCooldown.add(message.author.id);
                        setTimeout(() => memoriaCooldown.delete(message.author.id), 10000); // 10s para pruebas
                        
                        hashMensajesRecientes.add(firmaMensaje);
                        setTimeout(() => hashMensajesRecientes.delete(firmaMensaje), 120000); 
                    }
                    // Si interceptadoPor === 'RAIDS' u 'ORG', el bot lo registra pero sigue escuchando inmediatamente.
                }

            } catch (error) {
                console.error(`[ESCUDO DEFENSIVO] Fallo detectado. Error: ${error.message}`);
            }
        });

        try {
            await explorador.login(tokens[i]);
            if (i < tokens.length - 1) await delay(45000); 
        } catch (e) {
            console.error(`[FALLO INFILTRACIÓN] Token ${i+1} inválido.`);
        }
    }
}

iniciarEnjambre();
