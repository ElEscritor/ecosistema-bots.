'use strict';

const { MessageEmbed } = require('discord.js-selfbot-v13');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const database = require('../database.js');
const transmisor = require('../web/transmisor.js');

const REGEX_EXTRACCION_URL = /(https?:\/\/[^\s<>]+|(?:www\.)?(?:discord\.(?:gg|io|me|li)|discordapp\.com\/invite|discord\.com\/invite)\/[a-zA-Z0-9-]+)/i;

/**
 * Carga y pre-compila en memoria las reglas destinadas a WEBHOOK_Links.
 */
function cargarReglasLinks() {
    const reglasPath = path.join(__dirname, '../reglas_alertas.json');
    try {
        const raw = fs.readFileSync(reglasPath, 'utf8');
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];

        return parsed
            .filter(r => r && r.webhookDestino === 'WEBHOOK_Links' && r.patron)
            .map(r => ({
                idRegla: String(r.id_regla || 'Regla-Link'),
                colorHex: Number(r.colorHex) || 16753920,
                webhookDestino: r.webhookDestino,
                regex: new RegExp(r.patron, 'i')
            }));
    } catch (error) {
        console.error('[ERROR MÓDULO LINKS] Fallo al cargar reglas_alertas.json:', error.message);
        return [];
    }
}

const reglasLinksPrecompiladas = cargarReglasLinks();

function generarCasoId(prefijo) {
    return `${prefijo}_${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

/**
 * Evalúa si el mensaje contiene vectores de invitación o enlaces externos monitoreados.
 * @param {Object} message - Mensaje de Discord.
 * @returns {Promise<boolean>}
 */
async function ejecutar(message) {
    if (!message?.content || reglasLinksPrecompiladas.length === 0) return false;

    const contenidoCrudo = message.content;
    let reglaActivada = null;

    for (const regla of reglasLinksPrecompiladas) {
        if (regla.regex.test(contenidoCrudo)) {
            reglaActivada = regla;
            break;
        }
    }

    if (!reglaActivada) return false;

    const urlWebhook = process.env[reglaActivada.webhookDestino];
    if (!urlWebhook) return true;

    const casoId = generarCasoId('LNK');
    const matchEnlace = contenidoCrudo.match(REGEX_EXTRACCION_URL);
    const enlaceAislado = matchEnlace ? matchEnlace[0] : null;
    const servidorOrigen = message.guild?.name || 'Sector Privado (DM)';

    const estadoBD = await database.ficharInfractor(
        message.author.id,
        message.author.tag,
        `Distribución de Links: ${reglaActivada.idRegla}`,
        casoId,
        contenidoCrudo,
        servidorOrigen
    );

    const avatarURL = message.author.displayAvatarURL({ format: 'png', dynamic: true, size: 256 });
    const panelForense = new MessageEmbed()
        .setColor(reglaActivada.colorHex)
        .setAuthor({ name: `DETECCIÓN DE ENLACE: ${reglaActivada.idRegla.toUpperCase()}` })
        .setDescription(`**Promoción Analizada:**\n${contenidoCrudo.slice(0, 1500)}`)
        .setThumbnail(avatarURL)
        .addFields(
            { name: '👤 Remitente', value: `**${message.author.tag}**\n\`${message.author.id}\``, inline: true },
            { name: '📍 Nodo Origen', value: `**${servidorOrigen}**\n<#${message.channel.id}>`, inline: true },
            { name: '🛡️ Estado en La Biblioteca', value: String(estadoBD), inline: false }
        )
        .setFooter({ text: `Expediente: ${casoId}` })
        .setTimestamp();

    const contenidoExtra = enlaceAislado ? `🔗 **URL Aislada:** ${enlaceAislado}` : null;

    await transmisor.enviarWebhook(urlWebhook, panelForense.toJSON(), contenidoExtra, []);
    return true;
}

module.exports = { ejecutar };
