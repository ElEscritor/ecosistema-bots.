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

        if (!adminPass) return res.status(500).send('ERROR: Configura PANEL_PASSWORD en Render.');
        if (login === 'admin' && password === adminPass) return next();
        
        res.set('WWW-Authenticate', 'Basic realm="La Biblioteca"');
        res.status(401).send('Acceso denegado.');
    };

    // Servir la interfaz gráfica principal
    app.get(['/', '/panel'], bloqueoSeguridad, (req, res) => {
        res.sendFile(path.join(__dirname, 'panel.html'));
    });

    // API: Suministro de datos globales para el Dashboard y las Tablas
    app.get('/api/datos', bloqueoSeguridad, async (req, res) => {
        try {
            const infractores = await database.obtenerExpedientes();
            res.json(infractores);
        } catch (error) { res.status(500).json({ error: 'Fallo al leer la base de datos' }); }
    });

    // API: Inyección de notas OSINT desde el panel frontal
    app.post('/api/notas', bloqueoSeguridad, async (req, res) => {
        try {
            const { userId, nota } = req.body;
            await database.actualizarNotaOSINT(userId, nota);
            res.json({ success: true });
        } catch (error) { res.status(500).json({ error: 'Fallo al guardar la nota' }); }
    });

    // API: Eliminación de expedientes
    app.post('/api/eliminar', bloqueoSeguridad, async (req, res) => {
        try {
            const { userId } = req.body;
            await database.eliminarExpediente(userId);
            res.json({ success: true });
        } catch (error) { res.status(500).json({ error: 'Fallo al eliminar expediente' }); }
    });

    // API: Motor de Exportación UBFB-JSON
    app.get('/panel/exportar/ubfb', bloqueoSeguridad, async (req, res) => {
        try {
            const infractores = await database.obtenerExpedientes();
            
            const exportacionUBFB = infractores.map(inf => {
                let razonPrincipal = "Comportamiento Hostil";
                if (inf.historial && inf.historial.length > 0) {
                    const ultimaAccion = inf.historial[inf.historial.length - 1].accion.toLowerCase();
                    if (ultimaAccion.includes('raid') || ultimaAccion.includes('nuke')) razonPrincipal = "Raider";
                    else if (ultimaAccion.includes('link')) razonPrincipal = "Spam al md";
                    else if (ultimaAccion.includes('dox')) razonPrincipal = "Dox";
                    else if (ultimaAccion.includes('estafa')) razonPrincipal = "Estafa";
                    else if (ultimaAccion.includes('squad')) razonPrincipal = "Miembro de una squad";
                }
                
                return {
                    id: inf.userId,
                    reason: razonPrincipal,
                    punishmentDays: razonPrincipal === "Dox" ? null : 180,
                    status: "Activo",
                    authorId: "0",
                    authorUsername: "La Biblioteca (Inteligencia)",
                    intermediaryId: "0",
                    intermediaryUsername: "Sistema Automatizado",
                    proofs: [],
                    createdAt: inf.primerFichaje || new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                };
            });

            res.header('Content-Type', 'application/json');
            res.attachment(`UBFB_Blacklist_${new Date().toISOString().split('T')[0]}.json`);
            res.send(JSON.stringify(exportacionUBFB, null, 2));
        } catch (error) { res.status(500).send('Error procesando el JSON UBFB.'); }
    });

    app.listen(PORT, () => console.log(`[LA BIBLIOTECA] C4ISR operativo en puerto ${PORT}`));
}

module.exports = { iniciar };
