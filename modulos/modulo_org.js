'use strict';

const { MessageEmbed } = require('discord.js-selfbot-v13');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const database = require('../database.js');
const transmisor = require('../web/transmisor.js');

const MAX_LONGITUD_DESCRIPCION_EMBED = 3800;

/**
 * Carga y pre-compila las expresiones regulares de monitoreo organizacional.
 */
function cargarReglasOrg() {
    const reglasPath = path.join(__dirname, '../reglas_alertas.json');
    try {
        const raw = fs.readFileSync(reglasPath, 'utf8');
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];

        return parsed
            .filter(r => r && r.webhookDestino === 'WEBHOOK_Org' && r.patron)
            .map(r => ({
                idRegla: String(r.id_regla || 'Regla-Org'),
                colorHex: Number(r.colorHex) || 0x9D4EDD,
                webhookDestino: r.webhookDestino,
                // No usamos flag 'g' en objetos RegExp persistentes con .exec/.test para evitar mutación de lastIndex,
                // pero con String.prototype.matchAll(new RegExp(patron, 'gi')) o clonando flags es seguro.
                patronFuente: r.patron
            }));
    } catch (error) {
        console.error('[ERROR MÓDULO ORG] Fallo al cargar reglas_alertas.json:', error.message);
        return [];
    }
}

const reglasOrgConfig = cargarReglasOrg();

function generarCasoId(prefijo) {
    return `${prefijo}_${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

/**
 * Escanea menciones de entidades clave de la organización e incluye transcripción de contexto.
 * @param {Object} message - Mensaje de Discord.
 * @param {Array} contextoCache - Últimos 5 mensajes en caché del canal.
 * @returns {Promise<boolean>}
 */
async function ejecutar(message, contextoCache) {
    if (!message?.content || reglasOrgConfig.length === 0) return false;

    const contenidoCrudo = message.content;
    let mencionesDetectadas = [];
    let reglaActivada = null;

    for (const regla of reglasOrgConfig) {
        const regex = new RegExp(regla.patronFuente, 'gi');
        const coincidencias = contenidoCrudo.match(regex);

        if (coincidencias && coincidencias.length > 0) {
            mencionesDetectadas = [...new Set(coincidencias.map(p => p.toLowerCase().trim()))];
            reglaActivada = regla;
            break;
        }
    }

    if (mencionesDetectadas.length === 0 || !reglaActivada) return false;

    const urlWebhook = process.env[reglaActivada.webhookDestino];
    if (!urlWebhook) return true;

    const servidorOrigen = message.guild?.name || 'Sector Privado (DM)';
    const casoId = generarCasoId('OSINT');

    await database.ficharInfractor(
        message.author.id,
        message.author.tag,
        `Mención Organizacional (OSINT): ${mencionesDetectadas.join(', ')}`,
        casoId,
        contenidoCrudo,
        servidorOrigen
    );

    // Formateo seguro del contexto con truncamiento para no exceder límites de Discord (4096 chars)
    let lineasDialogo = [];
    if (Array.isArray(contextoCache) && contextoCache.length > 0) {
        for (const msg of contextoCache) {
            const nombreLimpio = String(msg.authorTag || 'Usuario').replace(/[_*~`>|]/g, '\\$&');
            const textoCorto = String(msg.content || '').replace(/\n+/g, ' ').slice(0, 350);
            const esObjetivo = msg.authorId === message.author.id && msg.content === contenidoCrudo;
            lineasDialogo.push(`> **${nombreLimpio}**: ${textoCorto}${esObjetivo ? '🎯' : ''}`);
        }
    } else {
        const textoCorto = contenidoCrudo.replace(/\n+/g, ' ').slice(0, 350);
        lineasDialogo.push(`> **${message.author.tag}**:${textoCorto} 🎯`);
    }

    const bloqueTranscripcion = lineasDialogo.join('\n');
    const descripcionCompleta = `Firma de red detectada: **${mencionesDetectadas.join(', ')}**\n\n**Transcripción del Segmento:**\n${bloqueTranscripcion}`
        .slice(0, MAX_LONGITUD_DESCRIPCION_EMBED);

    const creacionCuentaUnix = Math.floor((message.author.createdTimestamp || Date.now()) / 1000);
    const avatarURL = message.author.displayAvatarURL({ format: 'png', dynamic: true, size: 128 });

    const panelObservacion = new MessageEmbed()
        .setColor(reglaActivada.colorHex)
        .setAuthor({ name: `Radar de Organización: ${message.author.tag}`, iconURL: avatarURL })
        .setDescription(descripcionCompleta)
        .addFields(
            { name: '👤 Identidad Base', value: `\`${message.author.id}\``, inline: true },
            { name: '📅 Creación', value: `<t:${creacionCuentaUnix}:R>`, inline: true },
            { name: '📍 Rastro', value: `[Cruce de Señal](${message.url})`, inline: true },
            { name: '🌍 Red Origen', value: `**${servidorOrigen}**`, inline: true },
            { name: '📡 Vector Local', value: `<#${message.channel.id}>`, inline: true }
        )
        .setFooter({ text: `ID: ${message.author.id} • Caso: ${casoId} • Monitoreo Pasivo` })
        .setTimestamp();

    await transmisor.enviarWebhook(urlWebhook, panelObservacion.toJSON(), null, []);
    return true;
}

module.exports = { ejecutar };
