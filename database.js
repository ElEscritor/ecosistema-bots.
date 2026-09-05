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
        console.log("[SISTEMA] Conexión a expedientes de MongoDB establecida.");
        return dbCollection;
    } catch (error) {
        console.error("[ERROR BD] Fallo de conexión:", error);
    }
}

// Función centralizada para añadir delitos al expediente
async function ficharInfractor(userId, userTag, accion, casoId) {
    if (!dbCollection) return "⚠️ BD Inactiva";

    const nuevoDelito = {
        fecha: new Date().toISOString(),
        accion: accion,
        casoId: casoId
    };

    const resultado = await dbCollection.findOneAndUpdate(
        { userId: userId },
        {
            $setOnInsert: { userId: userId, primerFichaje: new Date().toISOString() }, // Solo se crea la primera vez
            $set: { ultimoAlias: userTag }, // Se actualiza si el usuario cambió de nombre
            $inc: { totalInfracciones: 1 }, // Suma +1 al historial
            $push: { historial: nuevoDelito } // Añade el delito a la lista
        },
        { upsert: true, returnDocument: 'after' } // upsert: true lo crea si no existe
    );

    const expediente = resultado.value || resultado;
    
    if (expediente.totalInfracciones === 1) {
        return "🟨 **Nuevo Ingreso:** Primer delito registrado.";
    } else {
        return `🟥 **Reincidente:** Expediente actualizado (Infracción #${expediente.totalInfracciones}).`;
    }
}

// Función para extraer el expediente completo
async function consultarExpediente(userId) {
    if (!dbCollection) return null;
    return await dbCollection.findOne({ userId: userId });
}

module.exports = { conectarBaseDatos, ficharInfractor, consultarExpediente };
