const { MongoClient } = require('mongodb');

const mongoUri = process.env.MONGO_URI;
if (!mongoUri) {
    console.error("ERROR CRÍTICO: Falta MONGO_URI en el entorno de producción.");
    process.exit(1);
}

const client = new MongoClient(mongoUri);
let dbCollection;

async function conectarBaseDatos() {
    try {
        await client.connect();
        dbCollection = client.db("panoptico_db").collection("blacklist");
        
        // Creación de índices compuestos para optimizar el motor de búsqueda en milisegundos
        await dbCollection.createIndex({ userId: 1, ultimoAlias: "text" });
        
        console.log("[SISTEMA] Motor MongoDB enlazado y optimizado con índices.");
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
                $setOnInsert: { primerFichaje: new Date().toISOString(), notaOSINT: "" },
                $set: { ultimoAlias: userTag },
                $inc: { totalInfracciones: 1 },
                $push: { 
                    historial: {
                        $each: [nuevoDelito],
                        $slice: -50 // CAPPING DE MEMORIA: Solo retiene las últimas 50 amenazas por sujeto
                    } 
                }
            },
            { upsert: true, returnDocument: 'after' }
        );
        const exp = resultado.value || resultado;
        if (exp && exp.totalInfracciones === 1) return "🟨 **Nuevo Ingreso:** Primer delito registrado.";
        return `🟥 **Reincidente:** Expediente actualizado (Infracción #${exp?.totalInfracciones}).`;
    } catch (error) { return "⚠️ Error de escritura en clúster MongoDB."; }
}

async function obtenerExpedientes(filtro = {}) {
    if (!dbCollection) return [];
    // Aplicación de proyecciones para evitar sobrecarga de red
    return await dbCollection.find(filtro).sort({ totalInfracciones: -1 }).toArray();
}

async function eliminarExpediente(userId) {
    if (!dbCollection) return false;
    try {
        await dbCollection.deleteOne({ userId: userId });
        return true;
    } catch (error) { return false; }
}

async function actualizarNotaOSINT(userId, nota) {
    if (!dbCollection) return false;
    try {
        await dbCollection.updateOne(
            { userId: userId },
            { $set: { notaOSINT: nota } }
        );
        return true;
    } catch (error) { return false; }
}

module.exports = { conectarBaseDatos, ficharInfractor, obtenerExpedientes, eliminarExpediente, actualizarNotaOSINT };
