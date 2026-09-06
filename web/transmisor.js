// web/transmisor.js
async function enviarWebhook(urlWebhook, embedJSON, contenidoTexto = null, archivos = []) {
    try {
        const formData = new FormData();
        
        const payload = { embeds: [embedJSON] };
        if (contenidoTexto) payload.content = contenidoTexto;
        
        formData.append('payload_json', JSON.stringify(payload));

        // Adjuntar archivos (HTML forense y TXT)
        archivos.forEach((archivo, index) => {
            const blob = new Blob([archivo.buffer], { type: archivo.mimetype });
            formData.append(`files[${index}]`, blob, archivo.nombre);
        });

        const response = await fetch(urlWebhook, { method: 'POST', body: formData });
        
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return true;
    } catch (err) {
        console.error('[TRANSMISOR PROXY] Fallo al enviar al Webhook:', err.message);
        return false;
    }
}

module.exports = { enviarWebhook };