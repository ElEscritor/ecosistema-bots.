const express = require('express');
const database = require('./database.js');

function iniciar() {
    const app = express();
    const PORT = process.env.PORT || 3000;

    // Middleware para procesar formularios (necesario para el botón de borrar)
    app.use(express.urlencoded({ extended: true }));

    // Middleware de Autenticación
    const bloqueoSeguridad = (req, res, next) => {
        const b64auth = (req.headers.authorization || '').split(' ')[1] || '';
        const [login, password] = Buffer.from(b64auth, 'base64').toString().split(':');
        const adminPass = process.env.PANEL_PASSWORD;

        if (!adminPass) return res.status(500).send('ERROR: Configura PANEL_PASSWORD en Render.');
        if (login === 'admin' && password === adminPass) return next();
        
        res.set('WWW-Authenticate', 'Basic realm="Acceso Restringido"');
        res.status(401).send('Acceso denegado.');
    };

    // Ruta de estado público (Latido para Render)
    app.get('/', (req, res) => res.json({ estado: "operativo", nucleo: "Servidor-Aislado-v1" }));

    // Ruta para Eliminar Infractores (POST)
    app.post('/panel/eliminar', bloqueoSeguridad, async (req, res) => {
        const { userId } = req.body;
        if (userId) await database.eliminarExpediente(userId);
        res.redirect('/panel'); // Recarga el panel tras borrar
    });

    // Ruta de Exportación CSV (Respeta el filtro de búsqueda)
    app.get('/panel/exportar', bloqueoSeguridad, async (req, res) => {
        try {
            const query = req.query.q || '';
            let filtro = {};
            if (query) {
                filtro = { $or: [{ userId: new RegExp(query, 'i') }, { ultimoAlias: new RegExp(query, 'i') }] };
            }

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
        } catch (error) {
            res.status(500).send('Error exportando datos.');
        }
    });

    // Panel Principal (Buscador y Visualización)
    app.get('/panel', bloqueoSeguridad, async (req, res) => {
        try {
            const query = req.query.q || '';
            let filtro = {};
            
            // Lógica del buscador por ID o Nombre
            if (query) {
                filtro = { $or: [{ userId: new RegExp(query, 'i') }, { ultimoAlias: new RegExp(query, 'i') }] };
            }

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
                                <button type="submit" class="delete-btn" onclick="return confirm('ATENCIÓN: ¿Borrar expediente de ${alias} permanentemente?')">🗑️ Purga</button>
                            </form>
                        </td>
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
                    th { background-color: #111214; color: #a3a6aa; text-transform: uppercase; font-size: 12px; letter-spacing: 1px; }
                    tr:hover { background-color: #313338; }
                    code { background-color: #111214; padding: 4px 8px; border-radius: 4px; font-family: monospace; color: #00a8fc; }
                    .search-bar { display: flex; gap: 10px; margin-bottom: 20px; }
                    .search-input { flex: 1; padding: 12px; border-radius: 4px; border: 1px solid #1e1f22; background-color: #111214; color: white; font-size: 16px; }
                </style>
            </head>
            <body>
                <div class="header-container">
                    <h1>🛡️ Registro de Expedientes</h1>
                    <a href="/panel/exportar?q=${query}" class="btn btn-export">⬇️ Exportar CSV</a>
                </div>
                
                <!-- Buscador -->
                <form method="GET" action="/panel" class="search-bar">
                    <input type="text" name="q" class="search-input" placeholder="Buscar por ID o Alias (ej. escritor)..." value="${query}">
                    <button type="submit" class="btn">🔍 Buscar</button>
                    <a href="/panel" class="btn btn-clear">❌ Limpiar</a>
                </form>

                <div style="margin-bottom: 15px; color: #a3a6aa;">Sujetos filtrados: <strong>${infractores.length}</strong></div>
                
                <table>
                    <thead>
                        <tr>
                            <th>ID del Sujeto</th>
                            <th>Último Alias</th>
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
            `;
            res.send(html);
        } catch (error) {
            res.status(500).send('Error interno leyendo la base de datos.');
        }
    });

    app.listen(PORT, () => console.log(`[LATIDO] Servidor Web UI activo en puerto ${PORT}`));
}

module.exports = { iniciar };
