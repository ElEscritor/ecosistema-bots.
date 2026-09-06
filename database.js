const { MongoClient } = require('mongodb');

const mongoUri = process.env.MONGO_URI;
if (!mongoUri) {
    console.error("ERROR CRÍTICO: Falta MONGO_URI en Render.");
    process.exit(1);
}

const client = new MongoClient(mongoUri);
let dbCollection;

async function conectarBaseDatos() {
    try {
        await client.connect();
        dbCollection = client.db("panoptico_db").collection("blacklist");
        console.log("[SISTEMA] Motor de Expedientes MongoDB enlazado.");
        return dbCollection;
    } catch (error) {
        console.error("[ERROR BD] Fallo de conexión:", error);
    }
}

async function ficharInfractor(userId, userTag, accion, casoId) {
    if (!dbCollection) return "⚠️ BD Inactiva";
    const nuevoDelito = { fecha: new Date().toISOString(), accion: accion, casoId: casoId || 'N/A' };
    try {
        const resultado = await dbCollection.findOneAndUpdate(
            { userId: userId },
            {
                $setOnInsert: { primerFichaje: new Date().toISOString() },
                $set: { ultimoAlias: userTag },
                $inc: { totalInfracciones: 1 },
                $push: { historial: nuevoDelito }
            },
            { upsert: true, returnDocument: 'after' }
        );
        const expediente = resultado.value || resultado;
        if (expediente && expediente.totalInfracciones === 1) return "🟨 **Nuevo Ingreso:** Primer delito.";
        else if (expediente) return `🟥 **Reincidente:** Expediente (Infracción #${expediente.totalInfracciones}).`;
        return "✅ Registro completado.";
    } catch (error) {
        return "⚠️ Error de escritura.";
    }
}

async function consultarExpediente(userId) {
    if (!dbCollection) return null;
    return await dbCollection.findOne({ userId: userId });
}

async function obtenerExpedientes(filtro = {}) {
    if (!dbCollection) return [];
    return await dbCollection.find(filtro).sort({ totalInfracciones: -1 }).toArray();
}

async function eliminarExpediente(userId) {
    if (!dbCollection) return false;
    try {
        await dbCollection.deleteOne({ userId: userId });
        return true;
    } catch (error) { return false; }
}

module.exports = { conectarBaseDatos, ficharInfractor, consultarExpediente, obtenerExpedientes, eliminarExpediente };
