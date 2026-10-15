'use strict';

const axios = require('axios');

const MAX_REINTENTOS_WEBHOOK = 3;
const TIMEOUT_RED_MS = 10000;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Envía payloads y archivos adjuntos a Webhooks de Discord respetando Rate Limits (HTTP 429).
 * @param {string} url - URL del Webhook de Discord.
 * @param {Object} embed - Objeto embed serializado.
 * @param {string|null} content - Texto opcional fuera del embed.
 * @param {Array<{nombre: string, buffer: string|Buffer, mimetype: string}>} adjuntos - Archivos a adjuntar.
 */
async function enviarWebhook(url, embed, content = null, adjuntos = []) {
    if (!url || typeof url !== 'string') return;

    const payload = { embeds: embed ? [embed] : [] };
    if (content) payload.content = content;

    for (let intento = 1; intento <= MAX_REINTENTOS_WEBHOOK; intento++) {
        try {
            if (Array.isArray(adjuntos) && adjuntos.length > 0) {
                const form = new FormData();
                form.append('payload_json', JSON.stringify(payload));

                adjuntos.forEach((archivo, index) => {
                    const contenidoBlob = typeof archivo.buffer === 'string'
                        ? [archivo.buffer]
                        : [ new Uint8Array(archivo.buffer) ];
                    const blob = new Blob(contenidoBlob, { type: archivo.mimetype || 'application/octet-stream' });
                    form.append(`files[${index}]`, blob, archivo.nombre || `evidencia_${index}.dat`);
                });

                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), TIMEOUT_RED_MS);

                const respuesta = await fetch(url, {
                    method: 'POST',
                    body: form,
                    signal: controller.signal
                });
                clearTimeout(timer);

                if (respuesta.status === 429) {
                    const data429 = await respuesta.json().catch(() => ({}));
                    const esperaMs = Math.ceil((Number(data429.retry_after) || 2) * 1000) + 250;
                    console.warn(`[TRANSMISOR] Rate Limit (429) en Webhook con adjuntos. Reintentando en ${esperaMs}ms...`);
                    await delay(esperaMs);
                    continue;
                }

                if (!respuesta.ok) {
                    throw new Error(`Código HTTP ${respuesta.status}`);
                }
                return;
            } else {
                await axios.post(url, payload, { timeout: TIMEOUT_RED_MS });
                return;
            }
        } catch (error) {
            const status = error.response?.status;
            if (status === 429 && intento < MAX_REINTENTOS_WEBHOOK) {
                const retryAfter = Number(error.response?.data?.retry_after) || 2;
                const esperaMs = Math.ceil(retryAfter * 1000) + 250;
                console.warn(`[TRANSMISOR] Rate Limit (429) en Webhook. Reintentando en ${esperaMs}ms...`);
                await delay(esperaMs);
                continue;
            }

            if (intento === MAX_REINTENTOS_WEBHOOK) {
                console.error(`[TRANSMISOR] Fallo definitivo enviando al Webhook tras ${intento} intentos:`, error.message);
            } else {
                await delay(intento * 1000);
            }
        }
    }
}

module.exports = { enviarWebhook };
