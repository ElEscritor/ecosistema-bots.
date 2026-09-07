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
        
        // Creación de índices compuestos para búsquedas sub-milimétricas y ordenamiento
        await dbCollection.createIndex({ userId: 1, ultimoAlias: "text" });
        await dbCollection.createIndex({ totalInfracciones: -1 });
        
        console.log("[SISTEMA] Motor MongoDB enlazado y optimizado con índices tácticos.");
        return dbCollection;
    } catch (error) { console.error("[ERROR BD] Fallo de conexión al clúster:", error); }
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
                $setOnInsert: { 
                    primerFichaje: new Date().toISOString(), 
                    notasAnalista: "", 
                    perfiladoAutomatico: [] // Aislamiento de datos para el futuro Modulo_expediente
                },
                $set: { ultimoAlias: userTag },
                $inc: { totalInfracciones: 1 },
                $push: { 
                    historial: {
                        $each: [nuevoDelito],
                        $slice: -50 // Capping de seguridad: Evita el desbordamiento de memoria por arrays infinitos
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

// Retiene toArray para compatibilidad con la tabla web actual, pero la limitamos a 500 para evitar crasheos inmediatos
async function obtenerExpedientes(filtro = {}) {
    if (!dbCollection) return [];
    return await dbCollection.find(filtro).sort({ totalInfracciones: -1 }).limit(500).toArray();
}

// Nueva función de paginación para evitar el colapso del DOM en el futuro
async function obtenerExpedientesPaginados(filtro = {}, pagina = 1, limite = 50) {
    if (!dbCollection) return { datos: [], total: 0 };
    const skip = (pagina - 1) * limite;
    const datos = await dbCollection.find(filtro).sort({ totalInfracciones: -1 }).skip(skip).limit(limite).toArray();
    const total = await dbCollection.countDocuments(filtro);
    return { datos, total };
}

// Nueva función de Stream (Cursor) para la exportación UBFB en bruto sin saturar la RAM
function obtenerExpedientesCursor(filtro = {}) {
    if (!dbCollection) return null;
    return dbCollection.find(filtro).sort({ primerFichaje: -1 });
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
            { $set: { notasAnalista: nota } }
        );
        return true;
    } catch (error) { return false; }
}

module.exports = { 
    conectarBaseDatos, 
    ficharInfractor, 
    obtenerExpedientes, 
    obtenerExpedientesPaginados,
    obtenerExpedientesCursor,
    eliminarExpediente, 
    actualizarNotaOSINT 
};
