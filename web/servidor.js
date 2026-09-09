const express = require('express');
const path = require('path');
const database = require('../database.js');

const app = express();
const PUERTO = process.env.PORT || 3000;
const PASSWORD = process.env.PANEL_PASSWORD;

// Configuración para procesar JSON y servir la carpeta actual (web) como recursos estáticos
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Middleware táctico: Bloquea cualquier petición a la API que no tenga la clave maestra en la cabecera
function autenticar(req, res, next) {
    const token = req.headers['x-auth-key'];
    if (!PASSWORD || token !== PASSWORD) {
        return res.status(403).json({ error: "Acceso denegado. Credenciales inválidas." });
    }
    next();
}

// ENDPOINT: Recopilación de telemetría y perfiles para el Dashboard y OSINT
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
            // Mapeo forense para la tabla de la Blacklist
            const ultimoDelito = exp.historial && exp.historial.length > 0 ? exp.historial[exp.historial.length - 1] : null;
            
            datos.blacklist.push({
                id: exp.userId,
                username: exp.ultimoAlias || 'Desconocido',
                reincidencia: exp.totalInfracciones || 1,
                evidencia: ultimoDelito ? ultimoDelito.mensajeOriginal : 'Evidencia no disponible',
                fecha: ultimoDelito ? ultimoDelito.fecha : exp.primerFichaje,
                notas: exp.notasAnalista || ''
            });

            // Extracción de vectores para el LinksPortal
            if (exp.historial) {
                exp.historial.forEach(delito => {
                    if (delito.accion && delito.accion.includes('Links')) {
                        const urlMatch = delito.mensajeOriginal.match(/(https?:\/\/[^\s]+|discord\.gg\/[^\s]+)/i);
                        datos.links.push({
                            serverName: delito.servidor,
                            mensaje: delito.mensajeOriginal,
                            url: urlMatch ? urlMatch[0] : '#',
                            fecha: delito.fecha
                        });
                    }
                });
            }
        });

        res.json(datos);
    } catch (error) {
        console.error("[API] Fallo de lectura:", error);
        res.status(500).json({ error: "Desincronización con el clúster MongoDB." });
    }
});

// ENDPOINT: Escritura asíncrona de notas de inteligencia
app.post('/api/notas', autenticar, async (req, res) => {
    const { id, nota } = req.body;
    if (!id) return res.status(400).json({ error: "Identificador de objetivo requerido." });
    
    const exito = await database.actualizarNotaOSINT(id, nota);
    exito ? res.json({ success: true }) : res.status(500).json({ error: "Fallo de encriptación en base de datos." });
});

// ENDPOINT: Ejecución de purga de infractores
app.post('/api/eliminar', autenticar, async (req, res) => {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: "Identificador de objetivo requerido." });
    
    const exito = await database.eliminarExpediente(id);
    exito ? res.json({ success: true }) : res.status(500).json({ error: "El clúster rechazó la orden de purga." });
});

// ENDPOINT: Volcado binario de la matriz forense (JSON)
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
        res.status(500).send("Fallo irrecuperable al compilar la exportación forense.");
    }
});

// ENRUTADOR SPA: Cualquier petición ajena a la API redirige al esqueleto visual
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

function iniciar() {
    app.listen(PUERTO, () => {
        console.log(`[C4ISR] Interfaz Web y API operando activamente en el puerto ${PUERTO}`);
    });
}

module.exports = { iniciar };
