'use strict';

/* ==========================================================================
   MÓDULO DE DEFENSA ACTIVA: INTERCEPTOR DE SQUADS Y COMANDOS HOSTILES
   Archivo: modulos/modulo_squads.js
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
 * Escapa caracteres especiales de RegExp para construir un matcher exacto de comando.
 */
function escaparRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Carga los comandos de squads ordenándolos de mayor a menor longitud
 * (para que '.sexopremium' se evalúe antes que '.sexo') y exigiendo fin de palabra o espacio.
 */
function cargarComandosSquads() {
    const comandosPath = path.join(__dirname, '../comandos_squads.json');
    try {
        const raw = fs.readFileSync(comandosPath, 'utf8');
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];

        return parsed
            .filter(c => c && typeof c.comando === 'string' && c.comando.trim().length > 0)
            .sort((a, b) => b.comando.length - a.comando.length)
            .map(c => {
                const cmdLimpio = c.comando.trim();
                return {
                    comando: cmdLimpio,
                    descripcion: String(c.descripcion || 'Comando hostil detectado'),
                    severidad: String(c.severidad || 'CRITICO').toUpperCase(),
                    colorHex: Number(c.colorHex) || 10181046,
                    webhookDestino: String(c.webhookDestino || 'WEBHOOK_Squads'),
                    // Coincide solo si el mensaje empieza por el comando seguido de espacio o fin de línea
                    regex: new RegExp(`^${escaparRegExp(cmdLimpio)}(?:\\s+\vert{}$)`, 'i')
                };
            });
    } catch (error) {
        console.error('[ERROR MÓDULO SQUADS] Fallo al cargar comandos_squads.json:', error.message);
        return [];
    }
}

const comandosSquads = cargarComandosSquads();

function escaparHTML(texto) {
    if (typeof texto !== 'string') return '';
    return texto
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

async function obtenerAvatarBase64(url) {
    try {
        const response = await axios.get(url, {
            responseType: 'arraybuffer',
            timeout: HTTP_TIMEOUT_MS,
            maxContentLength: 2 * 1024 * 1024
        });
        const buffer = Buffer.from(response.data, 'binary').toString('base64');
        const mimeType = response.headers['content-type'] || 'image/png';
        return `data:${mimeType};base64,${buffer}`;
    } catch (_) {
        return url;
    }
}

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
        const flags = data.flags ? `**Marcadores:** ${data.flags}` : 'Historial Limpio';
        const riesgo = data.risk_evaluation ? `**Perfil de Riesgo:** ${data.risk_evaluation}` : 'Bajo/Nulo';
        const vinculadas = Array.isArray(data.linked_accounts) ? `**Alt-Accounts Detectadas:** ${data.linked_accounts.length}` : 'Ninguna';
        return `  ${flags}\n  ${riesgo}\n${vinculadas}`;
    } catch (_) {
        return '  [API Externa fuera de línea]';
    }
}

function generarEvidenciaHTML(mensajeCrudo, authorTag, authorId, avatarB64, fechaStr) {
    const mensajeSeguro = escaparHTML(mensajeCrudo);
    const tagSeguro = escaparHTML(authorTag);
    const idSeguro = escaparHTML(authorId);
    const fechaSegura = escaparHTML(fechaStr);

    return `<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <title>Evidencia Forense de Comando - ${idSeguro}</title>
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
    <div class="watermark">EVIDENCIA FORENSE COMANDO SQUAD | C4ISR COMMAND CENTER | UID: ${idSeguro}</div>
</body>
</html>`;
}

function compilarContextoClinico(message, contextoCache, servidorOrigen, casoId) {
    let txt = `[ REGISTRO FORENSE DE COMANDOS ]\n`;
    txt += `Sujeto: ${message.author.tag} (${message.author.id})\n`;
    txt += `Servidor Afectado: ${servidorOrigen}\n`;
    txt += `ID de Referencia: ${casoId}\n\n`;
    txt += `--- TRANSCRIPCIÓN DEL CANAL ---\n`;

    const traducirVectores = (str) => String(str || '')
        .replace(/<@!?[0-9]+>/g, '[@Usuario]')
        .replace(/<#[0-9]+>/g, '[#Canal]')
        .replace(/<@&[0-9]+>/g, '[@Rol]');

    if (Array.isArray(contextoCache) && contextoCache.length > 0) {
        for (const msg of contextoCache) {
            const time = new Date(msg.createdTimestamp || Date.now()).toISOString().split('T')[1].slice(0, 8);
            txt += `[${time}] ${msg.authorTag}:${traducirVectores(msg.content)}\n`;
        }
    } else {
        txt += '[00:00:00] No hay datos residuales en la memoria caché del canal.\n';
    }

    return txt;
}

/**
 * Intercepta comandos de ataque/nuke verificando delimitadores exactos y ejecutando I/O concurrente.
 */
async function ejecutar(message, contextoCache) {
    if (!message?.content || comandosSquads.length === 0) return false;

    const contenidoTrim = message.content.trim();
    let comandoDetectado = null;

    for (const cmd of comandosSquads) {
        if (cmd.regex.test(contenidoTrim)) {
            comandoDetectado = cmd;
            break;
        }
    }

    if (!comandoDetectado) return false;

    const urlWebhook = process.env[comandoDetectado.webhookDestino];
    if (!urlWebhook) return true;

    const casoId = `SQD_${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const servidorOrigen = message.guild?.name || 'Sector Privado (DM)';
    const avatarURLOriginal = message.author.displayAvatarURL({ format: 'png', dynamic: true, size: 256 });

    const promesaBD = comandoDetectado.severidad === 'CRITICO'
        ? database.ficharInfractor(
            message.author.id,
            message.author.tag,
            `Ejecución de Comando Crítico: ${comandoDetectado.comando} (${comandoDetectado.descripcion})`,
            casoId,
            message.content,
            servidorOrigen
        )
        : Promise.resolve('Registro Táctico Omitido');

    // Ejecución en paralelo de Base de Datos, API CordCat y descarga de Avatar
    const [estadoBD, infoCordCat, avatarB64] = await Promise.all([
        promesaBD,
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
    const htmlData = generarEvidenciaHTML(message.content, message.author.tag, message.author.id, avatarB64, fechaExactaStr);

    const panelForense = new MessageEmbed()
        .setColor(comandoDetectado.colorHex)
        .setAuthor({ name: `INFRACCIÓN DE COMANDO: ${message.author.tag}`, iconURL: avatarURLOriginal })
        .setTitle(`Evaluación de Severidad: ${comandoDetectado.severidad}`)
        .setDescription(`**Payload Ejecutado:**\n\`\`\`text\n${message.content.slice(0, 800)}\n\`\`\``)
        .setThumbnail(avatarURLOriginal)
        .addFields(
            { name: 'Identificador Único', value: `\`${message.author.id}\``, inline: true },
            { name: 'Localización Exacta', value: `[Rastrear Nodo](${message.url})`, inline: true },
            { name: 'Sistema Comprometido', value: `**${servidorOrigen}**\n<#${message.channel.id}>`, inline: true },
            { name: 'Persistencia de Datos', value: String(estadoBD), inline: false },
            { name: 'Auditoría de Red Externa', value: infoCordCat, inline: false }
        )
        .setFooter({ text: `C4ISR Squad Case: ${casoId} | HORA DE IMPACTO: ${fechaExactaStr}` });

    const archivosAdjuntos = [
        { nombre: `EVIDENCIA_SQUAD_${message.author.id}.html`, buffer: htmlData, mimetype: 'text/html' },
        { nombre: `CONTEXTO_${message.author.id}.txt`, buffer: contextoTxtData, mimetype: 'text/plain' }
    ];

    await transmisor.enviarWebhook(urlWebhook, panelForense.toJSON(), null, archivosAdjuntos);
    return true;
}

module.exports = { ejecutar };
