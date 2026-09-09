const express = require('express');
const path = require('path');
const database = require('../database.js');

const app = express();
const PUERTO = process.env.PORT || 3000;

// SANEAMIENTO TÁCTICO: Elimina espacios en blanco residuales que Render pueda inyectar
const rawPassword = process.env.PANEL_PASSWORD || "admin";
const PASSWORD = rawPassword.trim();

app.use(express.json());
app.use(express.static(path.join(__dirname)));

// MIDDLEWARE DE SEGURIDAD ABSOLUTA
function autenticar(req, res, next) {
    const token = req.headers['x-auth-key'];
    if (!token || token !== PASSWORD) {
        return res.status(403).json({ error: "Acceso denegado. Credenciales inválidas." });
    }
    next();
}

// ENDPOINT PRINCIPAL: Ingesta de Telemetría y Perfilado
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
            
            // Construcción de la matriz disciplinaria
            datos.blacklist.push({
                id: exp.userId,
                username: exp.ultimoAlias || 'Desconocido',
                reincidencia: exp.totalInfracciones || 1,
                evidencia: ultimoDelito ? ultimoDelito.mensajeOriginal : 'Evidencia no disponible',
                fecha: ultimoDelito ? ultimoDelito.fecha : (exp.primerFichaje || new Date().toISOString()),
                notas: exp.notasAnalista || ''
            });

            // Extracción de vectores para el radar LinksPortal
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
        console.error("[API C4ISR] Fallo crítico de lectura en MongoDB:", error);
        res.status(500).json({ error: "Desincronización con el clúster MongoDB." });
    }
});

// ENDPOINT: Operaciones Asíncronas (Notas OSINT)
app.post('/api/notas', autenticar, async (req, res) => {
    const { id, nota } = req.body;
    if (!id) return res.status(400).json({ error: "Identificador de objetivo requerido." });
    
    try {
        const exito = await database.actualizarNotaOSINT(id, nota);
        exito ? res.json({ success: true }) : res.status(500).json({ error: "Fallo de encriptación." });
    } catch (error) {
        res.status(500).json({ error: "Fallo interno en base de datos." });
    }
});

// ENDPOINT: Protocolo de Purga
app.post('/api/eliminar', autenticar, async (req, res) => {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: "Identificador de objetivo requerido." });
    
    try {
        const exito = await database.eliminarExpediente(id);
        exito ? res.json({ success: true }) : res.status(500).json({ error: "Rechazo de purga." });
    } catch (error) {
        res.status(500).json({ error: "Fallo interno en base de datos." });
    }
});

// ENDPOINT: Descarga Forense JSON
app.get('/api/exportar', autenticar, async (req, res) => {
    try {
        const cursor = database.obtenerExpedientesCursor({});
        if (!cursor) throw new Error("Motor BD inactivo");
        
        const todos = await cursor.toArray();
        const jsonData = JSON.stringify(todos, null, 2);
        
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', 'attachment; filename=C4ISR_DATABASE.json');
        res.send(jsonData);
    } catch (error) {
        console.error("[API C4ISR] Fallo en exportación:", error);
        res.status(500).send("Fallo irrecuperable al compilar la exportación forense.");
    }
});

// ENRUTAMIENTO SPA
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

function iniciar() {
    app.listen(PUERTO, () => {
        console.log(`[C4ISR] Interfaz Web y API operando activamente en el puerto ${PUERTO}`);
    });
}

module.exports = { iniciar };
