const express = require('express');
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

        if (!adminPass) return res.status(500).send('ERROR: PANEL_PASSWORD no configurado en el entorno.');
        if (login === 'admin' && password === adminPass) return next();
        
        res.set('WWW-Authenticate', 'Basic realm="La Biblioteca - C4ISR"');
        res.status(401).send('Acceso denegado. Se requiere autorización táctica.');
    };

    // Renderizado de la Interfaz SPA
    app.get(['/', '/panel'], bloqueoSeguridad, (req, res) => {
        res.sendFile(path.join(__dirname, 'panel.html'));
    });

    // API: Telemetría Global
    app.get('/api/datos', bloqueoSeguridad, async (req, res) => {
        try {
            const infractores = await database.obtenerExpedientes();
            res.json(infractores);
        } catch (error) { res.status(500).json({ error: 'Fallo al leer la base de datos' }); }
    });

    // API: Inyección de OSINT
    app.post('/api/notas', bloqueoSeguridad, async (req, res) => {
        try {
            const { userId, nota } = req.body;
            await database.actualizarNotaOSINT(userId, nota);
            res.json({ success: true });
        } catch (error) { res.status(500).json({ error: 'Fallo al sincronizar inteligencia' }); }
    });

    // API: Purga de Expedientes
    app.post('/api/eliminar', bloqueoSeguridad, async (req, res) => {
        try {
            const { userId } = req.body;
            await database.eliminarExpediente(userId);
            res.json({ success: true });
        } catch (error) { res.status(500).json({ error: 'Fallo al purgar datos' }); }
    });

    // API: Exportación Agnóstica de Seguridad
    app.get('/api/exportar', bloqueoSeguridad, async (req, res) => {
        try {
            const infractores = await database.obtenerExpedientes();
            
            const exportacionEstandar = infractores.map(inf => {
                let categoria = "Comportamiento Hostil";
                let evidencia = "Evidencia no disponible";
                let nodoOrigen = "Desconocido";
                
                if (inf.historial && inf.historial.length > 0) {
                    const ultimo = inf.historial[inf.historial.length - 1];
                    const accion = ultimo.accion.toLowerCase();
                    evidencia = ultimo.mensajeOriginal || evidencia;
                    nodoOrigen = ultimo.servidor || nodoOrigen;

                    if (accion.includes('raid') || accion.includes('nuke')) categoria = "Ataque Masivo / Raider";
                    else if (accion.includes('link') || accion.includes('distribución')) categoria = "Spam / Distribución Maliciosa";
                    else if (accion.includes('dox') || accion.includes('ip')) categoria = "Doxing / Exposición de Datos";
                    else if (accion.includes('squad') || accion.includes('comando')) categoria = "Ejecución de Carga Táctica";
                    else if (accion.includes('palabra-clave')) categoria = "Mención de Organización (OSINT)";
                }
                
                return {
                    subject_id: inf.userId,
                    known_alias: inf.ultimoAlias || inf.nombreUsuario || "Desconocido",
                    threat_category: categoria,
                    raw_intercepted_payload: evidencia,
                    origin_node: nodoOrigen,
                    osint_notes: inf.notaOSINT || "",
                    timestamp_utc: inf.primerFichaje || new Date().toISOString()
                };
            });

            res.header('Content-Type', 'application/json');
            res.attachment(`Blacklist_Intelligence_${new Date().toISOString().split('T')[0]}.json`);
            res.send(JSON.stringify(exportacionEstandar, null, 2));
        } catch (error) { res.status(500).send('Error procesando el paquete de exportación.'); }
    });

    app.listen(PORT, () => console.log(`[LA BIBLIOTECA] C4ISR operativo en puerto ${PORT}`));
}

module.exports = { iniciar };
