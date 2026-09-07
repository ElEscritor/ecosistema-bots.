const { MongoClient } = require('mongodb');

const mongoUri = process.env.MONGO_URI;
if (!mongoUri) {
    console.error("ERROR CRÍTICO: Falta MONGO_URI en el entorno.");
    process.exit(1);
}

const client = new MongoClient(mongoUri);
let dbCollection;

async function conectarBaseDatos() {
    try {
        await client.connect();
        dbCollection = client.db("panoptico_db").collection("blacklist");
        await dbCollection.createIndex({ userId: 1 });
        console.log("[SISTEMA] Motor MongoDB enlazado.");
        return dbCollection;
    } catch (error) { console.error("[ERROR BD]", error); }
}

async function ficharInfractor(userId, userTag, accion, casoId, mensajeCrudo = "Evidencia no disponible", servidorOrigen = "Sector Desconocido") {
    if (!dbCollection) return "⚠️ BD Inactiva";
    
    const nuevoDelito = { 
        fecha: new Date().toISOString(), 
        accion: accion, 
        casoId: casoId || 'N/A',
        mensajeOriginal: mensajeCrudo,
        servidor: servidorOrigen
    };
    
    try {
        const resultado = await dbCollection.findOneAndUpdate(
            { userId: userId },
            {
                $setOnInsert: { primerFichaje: new Date().toISOString(), notasAnalista: "", perfiladoAutomatico: [] },
                $set: { ultimoAlias: userTag },
                $inc: { totalInfracciones: 1 },
                $push: { historial: { $each: [nuevoDelito], $slice: -50 } }
            },
            { upsert: true, returnDocument: 'after' }
        );
        return "Registro completado.";
    } catch (error) { return "⚠️ Error de escritura."; }
}

async function obtenerExpedientes() {
    if (!dbCollection) return [];
    return await dbCollection.find({}).sort({ totalInfracciones: -1 }).toArray();
}

// Retorna un cursor en lugar de un array masivo para evitar desbordamientos de RAM (OOM)
async function obtenerCursorExpedientes() {
    if (!dbCollection) return null;
    return dbCollection.find({});
}

async function eliminarExpediente(userId) {
    if (!dbCollection) return false;
    try { await dbCollection.deleteOne({ userId: userId }); return true; } catch (error) { return false; }
}

async function actualizarNotaOSINT(userId, nota) {
    if (!dbCollection) return false;
    try {
        await dbCollection.updateOne({ userId: userId }, { $set: { notasAnalista: nota } });
        return true;
    } catch (error) { return false; }
}

module.exports = { conectarBaseDatos, ficharInfractor, obtenerExpedientes, eliminarExpediente, actualizarNotaOSINT, obtenerCursorExpedientes };
