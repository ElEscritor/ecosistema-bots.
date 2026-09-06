const { MongoClient } = require('mongodb');

const mongoUri = process.env.MONGO_URI;
if (!mongoUri) {
    console.error("ERROR CRÍTICO: Falta MONGO_URI.");
    process.exit(1);
}

const client = new MongoClient(mongoUri);
let dbCollection;

async function conectarBaseDatos() {
    try {
        await client.connect();
        dbCollection = client.db("panoptico_db").collection("blacklist");
        console.log("[SISTEMA] Motor MongoDB enlazado.");
        return dbCollection;
    } catch (error) { console.error("[ERROR BD]", error); }
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
        const exp = resultado.value || resultado;
        if (exp && exp.totalInfracciones === 1) return "🟨 **Nuevo Ingreso:** Primer delito.";
        return `🟥 **Reincidente:** Expediente actualizado (Infracción #${exp?.totalInfracciones}).`;
    } catch (error) { return "⚠️ Error de escritura."; }
}

// Funciones para la Web
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

module.exports = { conectarBaseDatos, ficharInfractor, obtenerExpedientes, eliminarExpediente };
