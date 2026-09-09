const axios = require('axios');

async function enviarWebhook(url, embed, content = null, adjuntos = []) {
    try {
        if (adjuntos && adjuntos.length > 0) {
            // Empaquetado nativo de archivos para evasión de firmas
            const form = new FormData(); 
            const payload = { embeds: [embed] };
            if (content) payload.content = content;

            form.append('payload_json', JSON.stringify(payload));

            adjuntos.forEach((archivo, index) => {
                const blob = new Blob([archivo.buffer], { type: archivo.mimetype });
                form.append(`files[${index}]`, blob, archivo.nombre);
            });

            const respuesta = await fetch(url, { 
                method: 'POST', 
                body: form 
            });

            if (!respuesta.ok) {
                throw new Error(`Código HTTP ${respuesta.status}`);
            }
        } else {
            // Transmisión estándar mediante Axios si no hay volcado de archivos
            const payload = { embeds: [embed] };
            if (content) payload.content = content;
            await axios.post(url, payload);
        }
    } catch (error) {
        console.error("[TRANSMISOR] Fracaso de ofuscación de red hacia el Webhook.", error.message);
    }
}

module.exports = { enviarWebhook };
