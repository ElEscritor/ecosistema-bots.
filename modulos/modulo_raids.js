'use strict';

/* ==========================================================================
   MÓDULO DE DEFENSA ACTIVA: INTERCEPTOR DE RAIDS Y DOXXING (OPTIMIZADO)
   Archivo: modulos/modulo_raids.js
   ========================================================================== */

const { MessageEmbed } = require('discord.js-selfbot-v13');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const database = require('../database.js');
const transmisor = require('../web/transmisor.js');

const CORDCAT_API_KEY = process.env.CORDCAT_API_KEY || '';
const HTTP_TIMEOUT_MS = 2500;

/**
 * Pre-compila en frío las reglas destinadas a WEBHOOK_Raids.
 */
function cargarReglasRaids() {
    const reglasPath = path.join(__dirname, '../reglas_alertas.json');
    try {
        const raw = fs.readFileSync(reglasPath, 'utf8');
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];

        return parsed
            .filter(r => r && r.webhookDestino === 'WEBHOOK_Raids' && r.patron)
            .map(r => ({
                idRegla: String(r.id_regla || 'Regla-Raid'),
                colorHex: Number(r.colorHex) || 16711680,
                webhookDestino: r.webhookDestino,
                regex: new RegExp(r.patron, 'i')
            }));
    } catch (error) {
        console.error('[ERROR MÓDULO RAIDS] Fallo al cargar reglas_alertas.json:', error.message);
        return [];
    }
}

const reglasRaids = cargarReglasRaids();

function escaparHTML(texto) {
    if (typeof texto !== 'string') return '';
    return texto
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Descarga el avatar del usuario y lo codifica en Base64 para preservación offline.
 */
async function obtenerAvatarBase64(url) {
    try {
        const response = await axios.get(url, {
            responseType: 'arraybuffer',
            timeout: HTTP_TIMEOUT_MS,
            maxContentLength: 2 * 1024 * 1024 // Límite de 2MB por seguridad
        });
        const buffer = Buffer.from(response.data, 'binary').toString('base64');
        const mimeType = response.headers['content-type'] || 'image/png';
        return `data:${mimeType};base64,${buffer}`;
    } catch (_) {
        return url;
    }
}

/**
 * Consulta la reputación del usuario en CordCat de forma no bloqueante.
 */
async function consultarCordCat(userId) {
    if (!CORDCAT_API_KEY) {
        return '  [CORDCAT_API_KEY no configurada en el entorno]';
    }
    try {
        const res = await axios.get(`https://api.cordcat.com/v1/users/${userId}`, {
            headers: { Authorization: `Bearer ${CORDCAT_API_KEY}` },
            timeout: HTTP_TIMEOUT_MS
        });
        const data = res.data || {};
        const flags = data.flags ? `**Marcadores:** ${data.flags}` : 'Ninguno detectado';
        const riesgo = data.risk_evaluation ? `**Nivel de Riesgo:** ${data.risk_evaluation}` : 'Evaluación Pendiente';
        const vinculadas = Array.isArray(data.linked_accounts) ? `**Cuentas Vinculadas:** ${data.linked_accounts.length}` : '0';
        return `  ${flags}\n  ${riesgo}\n${vinculadas}`;
    } catch (_) {
        return '  [API CordCat Inactiva o Latencia Excesiva]';
    }
}

/**
 * Genera el documento HTML estático con los datos escapados.
 */
function generarEvidenciaHTML(mensajeCrudo, authorTag, authorId, avatarB64, fechaStr) {
    const mensajeSeguro = escaparHTML(mensajeCrudo);
    const tagSeguro = escaparHTML(authorTag);
    const idSeguro = escaparHTML(authorId);
    const fechaSegura = escaparHTML(fechaStr);

    return `<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <title>Evidencia Forense - ${idSeguro}</title>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Noto+Sans:wght@400;500;600&display=swap');
        body { background-color: #313338; color: #dbdee1; font-family: 'gg sans', 'Noto Sans', sans-serif; padding: 15px 20px; margin: 0; }
        .message-container { display: flex; padding: 2px 0; margin-top: 17px; }
        .message-container:hover { background-color: #2e3035; }
        .avatar { width: 40px; height: 40px; border-radius: 50%; margin-right: 16px; margin-top: 2px; object-fit: cover; background-color: #1e1f22; }
        .content { display: flex; flex-direction: column; width: 100%; }
        .header { display: flex; align-items: baseline; margin-bottom: 4px; }
        .username { color: #ffffff; font-weight: 500; font-size: 16px; margin-right: 8px; }
        .timestamp { color: #949ba4; font-size: 12px; font-weight: 400; }
        .text { font-size: 16px; line-height: 1.375rem; white-space: pre-wrap; word-break: break-word; color: #dbdee1; }
        .watermark { margin-top: 40px; padding-top: 15px; border-top: 1px solid rgba(255, 255, 255, 0.05); color: #7A7093; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; }
    </style>
</head>
<body>
    <div class="message-container">
        <img class="avatar" src="${avatarB64}" alt="Avatar">
        <div class="content">
            <div class="header">
                <span class="username">${tagSeguro}</span>
                <span class="timestamp">${fechaSegura}</span>
            </div>
            <div class="text">${mensajeSeguro}</div>
        </div>
    </div>
    <div class="watermark">EVIDENCIA FORENSE INMUTABLE | C4ISR COMMAND CENTER | UID: ${idSeguro}</div>
</body>
</html>`;
}

/**
 * Compila la transcripción de texto plano del canal.
 */
function compilarContextoClinico(message, contextoCache, servidorOrigen, casoId) {
    let txt = `[ REGISTRO FORENSE TÁCTICO ]\n`;
    txt += `Sujeto: ${message.author.tag} (${message.author.id})\n`;
    txt += `Nodo de Origen: ${servidorOrigen}\n`;
    txt += `ID de Caso: ${casoId}\n\n`;
    txt += `--- TRANSCRIPCIÓN DE EVENTOS ---\n`;

    const traducirVectores = (str) => String(str || '')
        .replace(/<@!?[0-9]+>/g, '[@Usuario_Mencionado]')
        .replace(/<#[0-9]+>/g, '[#Canal_Vinculado]')
        .replace(/<@&[0-9]+>/g, '[@Rol_Mencionado]');

    if (Array.isArray(contextoCache) && contextoCache.length > 0) {
        for (const msg of contextoCache) {
            const time = new Date(msg.createdTimestamp || Date.now()).toISOString().split('T')[1].slice(0, 8);
            txt += `[${time}] ${msg.authorTag}:${traducirVectores(msg.content)}\n`;
        }
    } else {
        txt += '[00:00:00] Memoria volátil de canal vacía al momento de la intercepción.\n';
    }

    return txt;
}

/**
 * Evalúa patrones de Raid/Doxxing y despacha evidencia forense ejecutando I/O en paralelo.
 */
async function ejecutar(message, contextoCache) {
    if (!message?.content || reglasRaids.length === 0) return false;

    const contenidoMensaje = message.content;
    let reglaActivada = null;

    for (const regla of reglasRaids) {
        if (regla.regex.test(contenidoMensaje)) {
            reglaActivada = regla;
            break;
        }
    }

    if (!reglaActivada) return false;

    const urlWebhook = process.env[reglaActivada.webhookDestino];
    if (!urlWebhook) return true;

    const casoId = `CASO_${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const servidorOrigen = message.guild?.name || 'Sector Privado (DM)';
    const avatarURLOriginal = message.author.displayAvatarURL({ format: 'png', dynamic: true, size: 256 });

    // Ejecución concurrente de las 3 operaciones de red independientes (BD + CordCat + Avatar CDN)
    const [estadoBD, infoCordCat, avatarB64] = await Promise.all([
        database.ficharInfractor(
            message.author.id,
            message.author.tag,
            `Alusión a Raid/Dox: ${reglaActivada.idRegla}`,
            casoId,
            contenidoMensaje,
            servidorOrigen
        ),
        consultarCordCat(message.author.id),
        obtenerAvatarBase64(avatarURLOriginal)
    ]);

    const opcionesFecha = {
        timeZone: 'Europe/Madrid',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
    };
    const fechaExactaStr = new Date(message.createdTimestamp || Date.now()).toLocaleString('es-ES', opcionesFecha);

    const contextoTxtData = compilarContextoClinico(message, contextoCache, servidorOrigen, casoId);
    const htmlData = generarEvidenciaHTML(contenidoMensaje, message.author.tag, message.author.id, avatarB64, fechaExactaStr);

    const panelForense = new MessageEmbed()
        .setColor(reglaActivada.colorHex)
        .setAuthor({ name: `AMENAZA CONFIRMADA: ${message.author.tag}`, iconURL: avatarURLOriginal })
        .setTitle(`Clasificación de Riesgo: ${reglaActivada.idRegla.toUpperCase()}`)
        .setDescription(`**Transmisión Interceptada:**\n\`\`\`text\n${contenidoMensaje.slice(0, 800)}\n\`\`\``)
        .setThumbnail(avatarURLOriginal)
        .addFields(
            { name: 'Identificador', value: `\`${message.author.id}\``, inline: true },
            { name: 'Rastreo de Red', value: `[Cruce de Señal](${message.url})`, inline: true },
            { name: 'Coordenada Origen', value: `**${servidorOrigen}**\n<#${message.channel.id}>`, inline: true },
            { name: 'Estado de Base de Datos', value: String(estadoBD), inline: false },
            { name: 'Inteligencia de Fuentes Externas (CordCat)', value: infoCordCat, inline: false }
        )
        .setFooter({ text: `C4ISR Case ID: ${casoId} \vert{} HORA DE IMPACTO:${fechaExactaStr}` });

    const archivosAdjuntos = [
        { nombre: `EVIDENCIA_RAID_${message.author.id}.html`, buffer: htmlData, mimetype: 'text/html' },
        { nombre: `TELEMETRIA_${message.author.id}.txt`, buffer: contextoTxtData, mimetype: 'text/plain' }
    ];

    await transmisor.enviarWebhook(urlWebhook, panelForense.toJSON(), null, archivosAdjuntos);
    return true;
}

module.exports = { ejecutar };
