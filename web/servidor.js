const express = require('express');
const fs = require('fs');
const path = require('path');
const database = require('../database.js');

function iniciar() {
    const app = express();
    const PORT = process.env.PORT || 3000;

    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    const bloqueoSeguridad = (req, res, next) => {
        const b64auth = (req.headers.authorization || '').split(' ')[1] || '';
        const [login, password] = Buffer.from(b64auth, 'base64').toString().split(':');
        const adminPass = process.env.PANEL_PASSWORD;
        if (!adminPass) return res.status(500).send('ERROR: PANEL_PASSWORD no configurado.');
        if (login === 'admin' && password === adminPass) return next();
        res.set('WWW-Authenticate', 'Basic realm="La Biblioteca - Acceso Restringido"');
        res.status(401).send('Acceso denegado.');
    };

    // Ruta Principal que sirve el HTML de La Biblioteca
    app.get('/panel', bloqueoSeguridad, (req, res) => {
        res.sendFile(path.join(__dirname, 'panel.html'));
    });

    // API: Datos del Dashboard (Gráficos)
    app.get('/api/stats', bloqueoSeguridad, async (req, res) => {
        try {
            const infractores = await database.obtenerExpedientes();
            let comandos = 0, raids = 0, orgs = 0, links = 0;
            let totalInfracciones = 0;

            infractores.forEach(inf => {
                if (inf.historial) {
                    inf.historial.forEach(delito => {
                        totalInfracciones++;
                        const accion = delito.accion.toLowerCase();
                        if (accion.includes('comando')) comandos++;
                        else if (accion.includes('raid') || accion.includes('dox') || accion.includes('nuke')) raids++;
                        else if (accion.includes('link') || accion.includes('distribución')) links++;
                        else orgs++;
                    });
                }
            });

            res.json({
                totalIds: infractores.length,
                totalCapturas: totalInfracciones,
                distribucion: [comandos, raids, orgs, links]
            });
        } catch (error) { res.status(500).json({ error: 'Fallo al procesar métricas' }); }
    });

    // API: Obtener toda la Blacklist
    app.get('/api/blacklist', bloqueoSeguridad, async (req, res) => {
        try {
            const infractores = await database.obtenerExpedientes();
            res.json(infractores);
        } catch (error) { res.status(500).json({ error: 'Fallo al leer la blacklist' }); }
    });

    // API: Actualizar Notas de Perfilado (Expedientes)
    app.post('/api/expediente/nota', bloqueoSeguridad, async (req, res) => {
        try {
            const { userId, nota } = req.body;
            // Se requiere actualizar database.js para soportar la inyección de notas personalizadas
            await database.actualizarNota(userId, nota); 
            res.json({ success: true });
        } catch (error) { res.status(500).json({ error: 'Fallo al guardar la nota' }); }
    });

    // API: Exportación JSON con formato estandarizado UBFB[cite: 4]
    app.get('/panel/exportar/ubfb', bloqueoSeguridad, async (req, res) => {
        try {
            const infractores = await database.obtenerExpedientes();
            
            const ubfbFormat = infractores.map(inf => {
                let lastAction = "Desconocida";
                if (inf.historial && inf.historial.length > 0) {
                    lastAction = inf.historial[inf.historial.length - 1].accion;
                }
                
                // Mapeo exacto basado en la estructura UBFB[cite: 4]
                return {
                    id: inf.userId,
                    reason: lastAction,
                    punishmentDays: 365,
                    status: "Activo",
                    authorId: "0",
                    authorUsername: "La Biblioteca (Panóptico)",
                    intermediaryId: "0",
                    intermediaryUsername: "La Biblioteca (Panóptico)",
                    proofs: [],
                    createdAt: inf.primerFichaje || new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                };
            });

            res.header('Content-Type', 'application/json');
            res.attachment(`UBFB_Blacklist_Export_${new Date().toISOString().split('T')[0]}.json`);
            res.send(JSON.stringify(ubfbFormat, null, 2));
        } catch (error) { res.status(500).send('Error procesando el JSON UBFB.'); }
    });

    app.listen(PORT, () => console.log(`[LA BIBLIOTECA] Interfaz C4ISR activa en puerto ${PORT}`));
}

module.exports = { iniciar };
