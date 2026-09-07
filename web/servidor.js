const express = require('express');
const fs = require('fs');
const path = require('path');
const database = require('../database.js');

function iniciar() {
    const app = express();
    const PORT = process.env.PORT || 3000;

    app.use(express.urlencoded({ extended: true }));

    const bloqueoSeguridad = (req, res, next) => {
        const b64auth = (req.headers.authorization || '').split(' ')[1] || '';
        const [login, password] = Buffer.from(b64auth, 'base64').toString().split(':');
        const adminPass = process.env.PANEL_PASSWORD;

        if (!adminPass) return res.status(500).send('ERROR: Configura PANEL_PASSWORD en Render.');
        if (login === 'admin' && password === adminPass) return next();
        
        res.set('WWW-Authenticate', 'Basic realm="Acceso Restringido"');
        res.status(401).send('Acceso denegado.');
    };

    app.get('/', (req, res) => res.json({ estado: "operativo", nucleo: "Servidor-Web-Aislado" }));

    app.post('/panel/eliminar', bloqueoSeguridad, async (req, res) => {
        const { userId } = req.body;
        if (userId) await database.eliminarExpediente(userId);
        res.redirect('/panel'); 
    });

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
        } catch (error) { res.status(500).send('Error exportando datos.'); }
    });

    app.get('/panel', bloqueoSeguridad, async (req, res) => {
        try {
            const query = req.query.q || '';
            let filtro = query ? { $or: [{ userId: new RegExp(query, 'i') }, { ultimoAlias: new RegExp(query, 'i') }] } : {};
            
            // Extracción de la base de datos (Esto faltaba en tu código)
            const infractores = await database.obtenerExpedientes(filtro);
            
            let filasHTML = '';
            infractores.forEach(inf => {
                const alias = inf.ultimoAlias || inf.nombreUsuario || 'Desconocido';
                const total = inf.totalInfracciones || 1;
                const fecha = new Date(inf.primerFichaje || inf.fechaFichaje).toLocaleDateString('es-ES');
                const ultimaAccion = inf.historial?.slice(-1)[0]?.accion || inf.accion || "Desconocida";

                // Empaquetado en Base64 para el Modal HTML
                const historialData = JSON.stringify(inf.historial || [{ 
                    fecha: inf.primerFichaje || new Date().toISOString(), 
                    accion: inf.accion || 'Registro heredado', 
                    casoId: inf.casoId || 'N/A' 
                }]);
                const encodedHistorial = Buffer.from(historialData).toString('base64');

                filasHTML += `
                    <tr>
                        <td><a href="#" class="id-link" data-historial="${encodedHistorial}" data-userid="${inf.userId}" data-alias="${alias}">${inf.userId}</a></td>
                        <td class="alias-text">${alias}</td>
                        <td class="infracciones-count">${total}</td>
                        <td>${fecha}</td>
                        <td class="ultima-actividad">${ultimaAccion}</td>
                        <td style="text-align: right;">
                            <form method="POST" action="/panel/eliminar" style="margin: 0;">
                                <input type="hidden" name="userId" value="${inf.userId}">
                                <button type="submit" class="btn btn-purge" onclick="return confirm('ATENCIÓN: ¿Borrar expediente de ${alias}?')">🗑️ Purga</button>
                            </form>
                        </td>
                    </tr>
                `;
            });

            const htmlPath = path.join(__dirname, 'panel.html');
            let plantillaHTML = fs.readFileSync(htmlPath, 'utf8');
            
            plantillaHTML = plantillaHTML.replace('{{FILAS_TABLA}}', filasHTML);
            plantillaHTML = plantillaHTML.replace(/{{QUERY}}/g, query);
            plantillaHTML = plantillaHTML.replace('{{TOTAL_RESULTADOS}}', infractores.length);

            res.send(plantillaHTML);
        } catch (error) { 
            console.error(error);
            res.status(500).send('Error cargando la base de datos.'); 
        }
    });

    app.listen(PORT, () => console.log(`[LATIDO] Servidor Web UI activo en puerto ${PORT}`));
}

module.exports = { iniciar };
