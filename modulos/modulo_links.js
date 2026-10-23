'use strict';

const { MessageEmbed } = require('discord.js-selfbot-v13');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const database = require('../database.js');
const transmisor = require('../web/transmisor.js');
const servidorWeb = require('../web/servidor.js');

// Regex estricto que extrae ÚNICAMENTE códigos de invitación reales de Discord,
// ignorando cdn.discordapp.com, media.discordapp.net, discord.com/events, imgur, tenor, etc.
const REGEX_INVITE_STRICT = /(?:https?:\/\/)?(?:www\.)?(?:discord\.(?:gg|io|me|li)|discordapp\.com\/invite|discord\.com\/invite)\/([a-zA-Z0-9-]{2,32})/gi;

const RUTAS_DISCORD_RESERVADAS = new Set([
    'events', 'channels', 'assets', 'developers', 'oauth2', 'login',
    'register', 'download', 'nitro', 'safety', 'terms', 'privacy',
    'guidelines', 'billing', 'store', 'template', 'gifts'
]);

// Memoria en RAM para no volver a fichar la misma invitación de alianza repetida en el mismo servidor (TTL 6 horas)
const memoriaLinksVistos = new Map();
const TTL_MEMORIA_LINK_MS = 6 * 60 * 60 * 1000;

function extraerInvitacionesValidas(texto) {
    if (typeof texto !== 'string' || texto.length === 0) return [];
    const codigosUnicos = new Set();
    let match;
    const regex = new RegExp(REGEX_INVITE_STRICT.source, 'gi');

    while ((match = regex.exec(texto)) !== null) {
        const codigo = String(match[1] || '').trim();
        if (!codigo) continue;
        if (RUTAS_DISCORD_RESERVADAS.has(codigo.toLowerCase())) continue;
        codigosUnicos.add(codigo);
    }

    return Array.from(codigosUnicos).map(code => ({
        code,
        url: `https://discord.gg/${code}`
    }));
}

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
                webhookDestino: r.webhookDestino
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

async function ejecutar(message) {
    if (!message?.content || reglasLinksPrecompiladas.length === 0) return false;

    const contenidoCrudo = message.content;
    const invitacionesDetectadas = extraerInvitacionesValidas(contenidoCrudo);

    // Si el mensaje solo tenía links de imágenes (cdn.discordapp.com, imgur) o eventos pero ninguna invitación real, ignorar
    if (invitacionesDetectadas.length === 0) return false;

    const reglaActivada = reglasLinksPrecompiladas[0];
    const servidorOrigen = message.guild?.name || 'Sector Privado (DM)';
    const guildIdOrigen = message.guild?.id || 'DM_SECTOR';
    const ahora = Date.now();

    // Purgar entradas caducadas de la memoria de deduplicación
    if (memoriaLinksVistos.size > 2000) {
        for (const [k, exp] of memoriaLinksVistos.entries()) {
            if (ahora > exp) memoriaLinksVistos.delete(k);
        }
    }

    // Alimentar siempre la memoria topológica de invitaciones en el servidor web
    for (const inv of invitacionesDetectadas) {
        if (typeof servidorWeb.registrarInvitacionViva === 'function') {
            servidorWeb.registrarInvitacionViva({
                code: inv.code,
                url: inv.url,
                origenGuildId: guildIdOrigen,
                origenServerName: servidorOrigen,
                emisorId: message.author.id,
                emisorTag: message.author.tag || 'Usuario',
                fecha: new Date(ahora).toISOString()
            });
        }
    }

    // Filtrar códigos que aún no hayan sido reportados recientemente en este mismo servidor
    const invitacionesNuevas = invitacionesDetectadas.filter(inv => {
        const key = `${guildIdOrigen}:${inv.code.toLowerCase()}`;
        const expira = memoriaLinksVistos.get(key);
        if (expira && ahora < expira) return false;
        memoriaLinksVistos.set(key, ahora + TTL_MEMORIA_LINK_MS);
        return true;
    });

    if (invitacionesNuevas.length === 0) return true;

    const invPrincipal = invitacionesNuevas[0];
    const todosLosLinksStr = invitacionesNuevas.map(i => i.url).join(' | ');
    const casoId = generarCasoId('LNK');

    // Guardamos el enlace limpio al principio del registro para que quede claro en cualquier vista
    const evidenciaConLinkLimpio = `[INVITE_DETECTADA: ${invPrincipal.url}]\n${contenidoCrudo}`;

    const estadoBD = await database.ficharInfractor(
        message.author.id,
        message.author.tag,
        `Distribución de Links: ${reglaActivada.idRegla}`,
        casoId,
        evidenciaConLinkLimpio,
        servidorOrigen
    );

    const urlWebhook = process.env[reglaActivada.webhookDestino];
    if (!urlWebhook) return true;

    const avatarURL = message.author.displayAvatarURL({ format: 'png', dynamic: true, size: 256 });

    const panelForense = new MessageEmbed()
        .setColor(reglaActivada.colorHex)
        .setAuthor({ name: `DETECCIÓN DE INVITACIÓN: ${reglaActivada.idRegla.toUpperCase()}` })
        .setDescription(`**Promoción Analizada:**\n${contenidoCrudo.slice(0, 1500)}`)
        .setThumbnail(avatarURL)
        .addFields(
            { name: '👤 Remitente', value: `**${message.author.tag}**\n\`${message.author.id}\``, inline: true },
            { name: '🌐 Nodo Origen', value: `**${servidorOrigen}**\n<#${message.channel.id}>`, inline: true },
            { name: '🔗 Invitación Aislada', value: `${todosLosLinksStr}`, inline: false },
            { name: '📁 Estado en La Biblioteca', value: String(estadoBD), inline: false }
        )
        .setFooter({ text: `Expediente: ${casoId}` })
        .setTimestamp();

    await transmisor.enviarWebhook(urlWebhook, panelForense.toJSON(), `🔗 **Invitación Oficial Extraída:** ${invPrincipal.url}`, []);
    return true;
}

module.exports = { ejecutar, extraerInvitacionesValidas };
