const express = require('express');
const path = require('path');
const database = require('../database.js');

const app = express();
const PUERTO = process.env.PORT || 3000;

// CREDENCIALES FIJAS DEL SISTEMA TÁCTICO
const PASSWORD = "1930";
const USUARIO_MAESTRO = "Admin";
let estadoEnjambre = []; // Memoria volátil del estado de los bots

app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Función expuesta para que index.js envíe el pulso de vida de los bots
function actualizarEnjambre(datos) {
    estadoEnjambre = datos;
}

// ENDPOINT DE AUTENTICACIÓN AISLADO
app.post('/api/login', (req, res) => {
    const { usuario, clave } = req.body;
    if (usuario === USUARIO_MAESTRO && clave === PASSWORD) {
        return res.json({ success: true });
    }
    return res.status(403).json({ error: "Credenciales inválidas" });
});

// BARRERA MIDDLEWARE
function autenticar(req, res, next) {
    const token = req.headers['x-auth-key'];
    if (token !== PASSWORD) return res.status(403).json({ error: "Clave incorrecta" });
    next();
}

app.get('/api/datos', autenticar, async (req, res) => {
    try {
        const expedientes = await database.obtenerExpedientes({});
        const hace24Horas = new Date(Date.now() - 86400000);
        
        const datos = {
            total_registros: expedientes.length,
            alertas_recientes: expedientes.filter(e => new Date(e.primerFichaje) > hace24Horas).length,
            enjambre: estadoEnjambre, // Transmisión del estado de los bots en vivo
            blacklist: [],
            links: []
        };

        expedientes.forEach(exp => {
            // Extracción de Links para el portal LinksPortal
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

            // FILTRO FORENSE BLACKLIST: Excluir delitos menores (OSINT y Links)
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
                        servidor: ultimoGrave.servidor || 'Desconocido',
                        avatar: exp.avatar || 'https://cdn.discordapp.com/embed/avatars/0.png'
                    });
                }
            }
        });
        res.json(datos);
    } catch (error) {
        console.error("[API ERROR] Fallo BD:", error);
        res.status(500).json({ error: "Fallo BD" });
    }
});

app.post('/api/notas', autenticar, async (req, res) => {
    try {
        await database.actualizarNotaOSINT(req.body.id, req.body.nota);
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: "Fallo BD" }); }
});

app.post('/api/eliminar', autenticar, async (req, res) => {
    try {
        await database.eliminarExpediente(req.body.id);
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: "Fallo BD" }); }
});

app.get('/api/exportar', autenticar, async (req, res) => {
    try {
        const cursor = database.obtenerExpedientesCursor({});
        const todos = await cursor.toArray();
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', 'attachment; filename=C4ISR_DATABASE.json');
        res.send(JSON.stringify(todos, null, 2));
    } catch (error) { res.status(500).send("Fallo exportación"); }
});

app.get('*', (req, res) => { res.sendFile(path.join(__dirname, 'index.html')); });

function iniciar() { 
    app.listen(PUERTO, () => console.log(`[C4ISR] Servidor activo puerto ${PUERTO}`)); 
}
module.exports = { iniciar, actualizarEnjambre };
