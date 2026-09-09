const express = require('express');
const path = require('path');
const database = require('../database.js');

const app = express();
const PUERTO = process.env.PORT || 3000;

// FORZADO DE CLAVE: Saneamiento de espacios invisibles y respaldo táctico
const rawPassword = process.env.PANEL_PASSWORD || "1930";
const PASSWORD = rawPassword.trim();

app.use(express.json());
app.use(express.static(path.join(__dirname)));

// 1. ENDPOINT DESACOPLADO: Verifica la contraseña sin tocar MongoDB
app.post('/api/login', (req, res) => {
    const { clave } = req.body;
    
    console.log(`[C4ISR AUTH] Intento de acceso detectado.`);
    
    if (clave && clave.trim() === PASSWORD) {
        console.log(`[C4ISR AUTH] Acceso autorizado. Nivel de administrador.`);
        return res.json({ success: true });
    }
    
    console.warn(`[C4ISR AUTH] Acceso denegado. Clave incorrecta.`);
    return res.status(403).json({ error: "Credenciales inválidas" });
});

// 2. BARRERA TÁCTICA: Middleware para proteger el resto de operaciones
function autenticar(req, res, next) {
    const token = req.headers['x-auth-key'];
    if (!token || token !== PASSWORD) {
        return res.status(403).json({ error: "No autorizado." });
    }
    next();
}

// 3. ENDPOINTS DE DATOS (Protegidos)
app.get('/api/datos', autenticar, async (req, res) => {
    try {
        // Carga de la matriz forense
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
        console.error("[API ERROR] Fallo de lectura BD:", error);
        res.status(500).json({ error: "El motor de base de datos no responde." });
    }
});

app.post('/api/notas', autenticar, async (req, res) => {
    const { id, nota } = req.body;
    if (!id) return res.status(400).json({ error: "ID requerido." });
    
    try {
        const exito = await database.actualizarNotaOSINT(id, nota);
        exito ? res.json({ success: true }) : res.status(500).json({ error: "Fallo al guardar." });
    } catch (error) {
        res.status(500).json({ error: "Error interno del motor BD." });
    }
});

app.post('/api/eliminar', autenticar, async (req, res) => {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: "ID requerido." });
    
    try {
        const exito = await database.eliminarExpediente(id);
        exito ? res.json({ success: true }) : res.status(500).json({ error: "Rechazo de orden de purga." });
    } catch (error) {
        res.status(500).json({ error: "Error interno del motor BD." });
    }
});

app.get('/api/exportar', autenticar, async (req, res) => {
    try {
        const cursor = database.obtenerExpedientesCursor({});
        if (!cursor) throw new Error("Motor inactivo");
        
        const todos = await cursor.toArray();
        const jsonData = JSON.stringify(todos, null, 2);
        
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', 'attachment; filename=C4ISR_DATABASE.json');
        res.send(jsonData);
    } catch (error) {
        res.status(500).send("Fallo al compilar la exportación.");
    }
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

function iniciar() {
    app.listen(PUERTO, () => {
        console.log(`[C4ISR SYSTEM] Panel Web activo en puerto ${PUERTO}`);
    });
}

module.exports = { iniciar };
