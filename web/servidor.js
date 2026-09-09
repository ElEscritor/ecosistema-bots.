const express = require('express');
const path = require('path');
const database = require('../database.js');

const app = express();
const PUERTO = process.env.PORT || 3000;

// CLAVE FIJADA DIRECTAMENTE (Ignoramos a Render por completo)
const PASSWORD = "1930";

app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Middleware simplificado al máximo
function autenticar(req, res, next) {
    const token = req.headers['x-auth-key'];
    if (token !== PASSWORD) {
        return res.status(403).json({ error: "Clave incorrecta" });
    }
    next();
}

app.get('/api/datos', autenticar, async (req, res) => {
    try {
        const expedientes = await database.obtenerExpedientes({});
        const hace24Horas = new Date(Date.now() - 86400000);
        
        const datos = {
            total_registros: expedientes.length,
            alertas_recientes: expedientes.filter(e => new Date(e.primerFichaje) > hace24Horas).length,
            blacklist: [],
            links: []
        };

        expedientes.forEach(exp => {
            const ultimoDelito = exp.historial && exp.historial.length > 0 ? exp.historial[exp.historial.length - 1] : null;
            
            datos.blacklist.push({
                id: exp.userId,
                username: exp.ultimoAlias || 'Desconocido',
                reincidencia: exp.totalInfracciones || 1,
                evidencia: ultimoDelito ? ultimoDelito.mensajeOriginal : 'Evidencia no disponible',
                fecha: ultimoDelito ? ultimoDelito.fecha : (exp.primerFichaje || new Date().toISOString()),
                notas: exp.notasAnalista || ''
            });

            if (exp.historial) {
                exp.historial.forEach(delito => {
                    if (delito.accion && delito.accion.includes('Links')) {
                        const urlMatch = delito.mensajeOriginal.match(/(https?:\/\/[^\s]+|discord\.gg\/[^\s]+)/i);
                        datos.links.push({
                            serverName: delito.servidor || 'Sector Desconocido',
                            mensaje: delito.mensajeOriginal,
                            url: urlMatch ? urlMatch[0] : '#',
                            fecha: delito.fecha || new Date().toISOString()
                        });
                    }
                });
            }
        });
        res.json(datos);
    } catch (error) {
        res.status(500).json({ error: "Fallo BD" });
    }
});

app.post('/api/notas', autenticar, async (req, res) => {
    try {
        await database.actualizarNotaOSINT(req.body.id, req.body.nota);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: "Fallo BD" });
    }
});

app.post('/api/eliminar', autenticar, async (req, res) => {
    try {
        await database.eliminarExpediente(req.body.id);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: "Fallo BD" });
    }
});

app.get('/api/exportar', autenticar, async (req, res) => {
    try {
        const cursor = database.obtenerExpedientesCursor({});
        const todos = await cursor.toArray();
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', 'attachment; filename=C4ISR_DATABASE.json');
        res.send(JSON.stringify(todos, null, 2));
    } catch (error) {
        res.status(500).send("Fallo exportación");
    }
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

function iniciar() {
    app.listen(PUERTO, () => console.log(`[C4ISR] Servidor activo puerto ${PUERTO}`));
}
module.exports = { iniciar };
