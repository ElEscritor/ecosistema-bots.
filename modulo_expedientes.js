const { WebhookClient, MessageEmbed } = require('discord.js-selfbot-v13');
const database = require('./database.js');

async function ejecutar(message) {
    if (!message.content.toLowerCase().startsWith('!expediente')) return false;

    const matchId = message.content.match(/\d{17,19}/);
    if (!matchId) return false;

    const userId = matchId[0];
    
    const urlWebhook = process.env.WEBHOOK_Squads; 
    if (!urlWebhook) return true;

    const webhook = new WebhookClient({ url: urlWebhook });
    const expediente = await database.consultarExpediente(userId);

    const panel = new MessageEmbed().setTimestamp();

    if (!expediente) {
        panel.setColor('#2ecc71')
             .setAuthor({ name: 'SISTEMA DE ARCHIVOS PANÓPTICO' })
             .setTitle(`Expediente Limpio`)
             .setDescription(`El identificador \`${userId}\` no consta en las bases de datos criminales.`);
    } else {
        const alias = expediente.ultimoAlias || expediente.nombreUsuario || "Desconocido";
        const totalInfracciones = expediente.totalInfracciones || 1;
        const primerIngreso = expediente.primerFichaje || expediente.fechaFichaje || new Date().toISOString();
        
        const listaDelitos = expediente.historial || [{
            fecha: expediente.fechaFichaje || new Date().toISOString(),
            accion: expediente.accion || "Infracción heredada del sistema antiguo",
            casoId: expediente.casoId || "N/A"
        }];

        let historialTexto = "";
        const ultimosDelitos = listaDelitos.slice().reverse().slice(0, 5);
        
        ultimosDelitos.forEach((delito, index) => {
            const fechaUnix = Math.floor(new Date(delito.fecha).getTime() / 1000);
            historialTexto += `**${index + 1}.** <t:${fechaUnix}:d> - ${delito.accion}\n`;
        });

        if (totalInfracciones > 5) {
            historialTexto += `\n*... y ${totalInfracciones - 5} infracciones más archivadas.*`;
        }

        const fechaIngresoUnix = Math.floor(new Date(primerIngreso).getTime() / 1000);

        panel.setColor('#ed4245')
             .setAuthor({ name: `ARCHIVOS CLASIFICADOS: ${alias.toUpperCase()}` })
             .setTitle(`Expediente Criminal: ${userId}`)
             .setDescription(`Sujeto catalogado como amenaza activa. Desglose de actividad hostil:`)
             .addFields(
                 { name: '📊 Nivel de Reincidencia', value: `${totalInfracciones} infracción/es`, inline: true },
                 { name: '📅 Primer Ingreso', value: `<t:${fechaIngresoUnix}:F>`, inline: true },
                 { name: '📜 Historial Táctico (Últimos movimientos)', value: historialTexto, inline: false }
             );
    }

    webhook.send({ embeds: [panel] }).catch(err => console.error('[FALLO RED EXPEDIENTES]', err.message));
    return true; 
}

module.exports = { ejecutar };
