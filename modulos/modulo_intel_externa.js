// Cola silenciosa en segundo plano (1 consulta cada 4.5s) para iluminar el Índice de Infección en el Mapa
const colaAutoScan = [];
const usuariosYaAutoEscaneados = new Set();
let autoScanActivo = false;

function encolarVerificacionAutomatica(userId, callbackExito) {
    const cleanId = String(userId || '').trim();
    if (!cleanId || usuariosYaAutoEscaneados.has(cleanId)) return;
    if (colaAutoScan.length >= 250) return;

    usuariosYaAutoEscaneados.add(cleanId);
    colaAutoScan.push({ userId: cleanId, callbackExito });
    procesarColaAutoScan();
}

async function procesarColaAutoScan() {
    if (autoScanActivo || colaAutoScan.length === 0) return;
    autoScanActivo = true;

    while (colaAutoScan.length > 0) {
        const item = colaAutoScan.shift();
        try {
            const resultado = await consultarPerfilExternoCompleto(item.userId, false);
            if (typeof item.callbackExito === 'function') {
                await item.callbackExito(resultado);
            }
        } catch (_) {}
        await new Promise(r => setTimeout(r, 4500));
    }

    autoScanActivo = false;
}

module.exports = {
    consultarPerfilExternoCompleto,
    consultarWhoisIp,
    encolarVerificacionAutomatica,
    agregarReglaDinamica,
    obtenerArsenalDinamico,
    restaurarArsenalDinamico
};
