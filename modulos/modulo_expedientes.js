'use strict';

const { MessageEmbed } = require('discord.js-selfbot-v13');
const database = require('../database.js');
const transmisor = require('../web/transmisor.js');

const REGEX_COMANDO_EXPEDIENTE = /^!expediente\s+(?:<@!?(\d{17,20})>|(\d{17,20}))/i;

/**
 * Consulta un expediente en MongoDB y despacha el informe al Webhook configurado.
 * @param {Object} message - Mensaje de Discord.
 * @returns {Promise<boolean>}
 */
async function ejecutar(message) {
    if (!message?.content) return false;

    const match = message.content.trim().match(REGEX_COMANDO_EXPEDIENTE);
    if (!match) return false;

    const userId = match[1] || match[2];
    const urlWebhook = process.env.WEBHOOK_Squads;
    if (!urlWebhook) return true;

    try {
        const resultados = await database.obtenerExpedientes({ userId });
        const expediente = Array.isArray(resultados) && resultados.length > 0 ? resultados[0] : null;

        const panel = new MessageEmbed().setTimestamp();

        if (!expediente) {
            panel
                .setColor(0x2ecc71)
                .setAuthor({ name: 'SISTEMA DE ARCHIVOS PANÓPTICO' })
                .setTitle('Expediente Limpio')
                .setDescription(`El identificador \`${userId}\` no consta en los registros de amenazas.`);
        } else {
            const alias = String(expediente.ultimoAlias || expediente.nombreUsuario || 'Desconocido').slice(0, 100);
            const totalInfracciones = Number(expediente.totalInfracciones) || 1;
            const primerIngreso = expediente.primerFichaje || expediente.fechaFichaje || new Date().toISOString();

            const listaDelitos = Array.isArray(expediente.historial) && expediente.historial.length > 0
                ? expediente.historial
                : [{
                    fecha: primerIngreso,
                    accion: expediente.accion || 'Infracción registrada sin desglose histórico',
                    casoId: expediente.casoId || 'N/A'
                }];

            const ultimosDelitos = listaDelitos.slice(-5).reverse();
            const lineasHistorial = ultimosDelitos.map((delito, index) => {
                const timestampMs = Date.parse(delito.fecha);
                const fechaUnix = Number.isNaN(timestampMs) ? Math.floor(Date.now() / 1000) : Math.floor(timestampMs / 1000);
                const accionLimpia = String(delito.accion || 'Sin descripción').slice(0, 140);
                return `**${index + 1}.** <t:${fechaUnix}:d> —${accionLimpia}`;
            });

            if (totalInfracciones > 5) {
                lineasHistorial.push(`\n*... y ${totalInfracciones - 5} infracciones adicionales en archivo.*`);
            }

            const ingresoMs = Date.parse(primerIngreso);
            const fechaIngresoUnix = Number.isNaN(ingresoMs) ? Math.floor(Date.now() / 1000) : Math.floor(ingresoMs / 1000);

            panel
                .setColor(0xed4245)
                .setAuthor({ name: `ARCHIVOS CLASIFICADOS: ${alias.toUpperCase()}` })
                .setTitle(`Expediente Criminal: ${userId}`)
                .setDescription('Sujeto catalogado como amenaza activa. Desglose de actividad hostil:')
                .addFields(
                    { name: '📊 Nivel de Reincidencia', value: `${totalInfracciones} infracción(es)`, inline: true },
                    { name: '📅 Primer Ingreso', value: `<t:${fechaIngresoUnix}:F>`, inline: true },
                    { name: '📜 Historial Táctico (Últimos movimientos)', value: lineasHistorial.join('\n').slice(0, 1024), inline: false }
                );
        }

        await transmisor.enviarWebhook(urlWebhook, panel.toJSON(), null, []);
    } catch (error) {
        console.error(`[ERROR MÓDULO EXPEDIENTES] Fallo al consultar ID ${userId}:`, error.message);
    }

    return true;
}

module.exports = { ejecutar };
