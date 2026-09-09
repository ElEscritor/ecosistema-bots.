const express = require('express');
const path = require('path');
const database = require('../database.js');

const app = express();
const PUERTO = process.env.PORT || 3000;

// CREDENCIALES FIJADAS PARA LA BIBLIOTECA
const PASSWORD = "1930";
const USUARIO_MAESTRO = "Admin";

// Memoria volátil de telemetría de los bots exploradores
let estadoEnjambre = []; 

// Límite ampliado a 50mb para permitir importar JSON masivos sin que Express colapse
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname)));

// Función expuesta para inyección de telemetría desde index.js
function actualizarEnjambre(datos) {
    estadoEnjambre = datos;
}

// 1. ENDPOINT DE AUTENTICACIÓN AISLADO (El que permite que el index.html te deje entrar)
app.post('/api/login', (req, res) => {
    const { usuario, clave } = req.body;
    
    if (usuario === USUARIO_MAESTRO && clave === PASSWORD) {
        console.log(`[C4ISR AUTH] Acceso autorizado para Operador: ${usuario}`);
        return res.json({ success: true });
    }
    
    console.warn(`[C4ISR AUTH] Bloqueo de intruso. Usuario intentado: ${usuario}`);
    return res.status(403).json({ error: "Credenciales inválidas" });
});

// 2. MIDDLEWARE DE PROTECCIÓN PARA OPERACIONES DE DATOS
function autenticar(req, res, next) {
    const token = req.headers['x-auth-key'];
    if (token !== PASSWORD) {
        return res.status(403).json({ error: "Clave incorrecta" });
    }
    next();
}

// 3. ENDPOINT CENTRAL: Construcción del Payload de la SPA
app.get('/api/datos', autenticar, async (req, res) => {
    try {
        const expedientes = await database.obtenerExpedientes({});
        const hace24Horas = new Date(Date.now() - 86400000);
        
        const datos = {
            total_registros: expedientes.length,
            alertas_recientes: expedientes.filter(e => new Date(e.primerFichaje) > hace24Horas).length,
            enjambre: estadoEnjambre, // Transmisión del estado vivo de los bots
            blacklist: [],
            links: []
        };

        expedientes.forEach(exp => {
            // A. Extracción de vectores para el LinksPortal
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

            // B. Filtrado Forense Estricto para la Blacklist (Ignora Links y OSINT general)
            if (exp.historial) {
                const delitosGraves = exp.historial.filter(d => 
                    !d.accion.includes('Links') && !d.accion.includes('OSINT')
                );
                
                if (delitosGraves.length > 0) {
                    const ultimoGrave = delitosGraves[delitosGraves.length - 1];
                    datos.blacklist.push({
                        id: exp.userId,
                        username: exp.ultimoAlias || 'Desconocido',
                        reincidencia: exp.totalInfracciones || 1,
                        evidencia: ultimoGrave.mensajeOriginal,
                        fecha: ultimoGrave.fecha,
                        servidor: ultimoGrave.servidor || 'Sector Desconocido'
                    });
                }
            }

            // C. Inyección para usuarios agregados manualmente que aún no tienen historial
            if ((!exp.historial || exp.historial.length === 0) && !datos.blacklist.find(b => b.id === exp.userId)) {
                 datos.blacklist.push({
                    id: exp.userId,
                    username: exp.ultimoAlias || 'Identidad Desconocida',
                    reincidencia: 0,
                    evidencia: "[ SIN REGISTROS ACTIVOS ]",
                    fecha: exp.primerFichaje || new Date().toISOString(),
                    servidor: "N/A",
                    notas: exp.notasAnalista || ''
                 });
            }
        });

        res.json(datos);
    } catch (error) {
        console.error("[API C4ISR] Fallo en recuperación del clúster BD:", error);
        res.status(500).json({ error: "Desincronización de Base de Datos" });
    }
});

// ENDPOINT: Mutación de Notas OSINT
app.post('/api/notas', autenticar, async (req, res) => {
    const { id, nota } = req.body;
    if (!id) return res.status(400).json({ error: "Identificador de objetivo requerido." });
    
    try {
        const exito = await database.actualizarNotaOSINT(id, nota);
        exito ? res.json({ success: true }) : res.status(500).json({ error: "Fallo de encriptación." });
    } catch (error) {
        res.status(500).json({ error: "Fallo BD" });
    }
});

// ENDPOINT: Ejecución de Purga
app.post('/api/eliminar', autenticar, async (req, res) => {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: "Identificador de objetivo requerido." });
    
    try {
        const exito = await database.eliminarExpediente(id);
        exito ? res.json({ success: true }) : res.status(500).json({ error: "Fallo de eliminación." });
    } catch (error) {
        res.status(500).json({ error: "Fallo BD" });
    }
});

// ENDPOINT: Descarga Segura de Matriz
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

// ENDPOINT: Inyección Manual de Expediente
app.post('/api/objetivos/manual', autenticar, async (req, res) => {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: "ID requerido." });
    try {
        const exito = await database.inyectarObjetivoManual(id);
        exito ? res.json({ success: true }) : res.status(500).json({ error: "Fallo al inyectar." });
    } catch (error) { res.status(500).json({ error: "Error interno BD" }); }
});

// ENDPOINT: Importación Masiva JSON
app.post('/api/objetivos/importar', autenticar, async (req, res) => {
    const { matriz } = req.body;
    if (!matriz || !Array.isArray(matriz)) return res.status(400).json({ error: "Matriz JSON inválida." });
    try {
        const exito = await database.importarMatriz(matriz);
        exito ? res.json({ success: true }) : res.status(500).json({ error: "Fallo al importar." });
    } catch (error) { res.status(500).json({ error: "Error interno BD" }); }
});

// ENRUTAMIENTO SPA: Sirve el archivo visual estático
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

function iniciar() {
    app.listen(PUERTO, () => console.log(`[LA BIBLIOTECA] Servidor operando activamente en puerto ${PUERTO}`));
}
module.exports = { iniciar, actualizarEnjambre };
