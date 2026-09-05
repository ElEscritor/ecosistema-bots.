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
             .setDescription(`El identificador \`${userId}\` no consta en las bases de datos criminales de la infraestructura.`);
    } else {
        let historialTexto = "";
        
        // BLINDAJE DE SEGURIDAD: Si expediente.historial es undefined, se asigna un array vacío [] para evitar el fallo de .slice()
        const listaDelitos = expediente.historial || [];
        
        if (listaDelitos.length === 0) {
            historialTexto = "No hay infracciones detalladas en el registro.";
        } else {
            const ultimosDelitos = listaDelitos.slice().reverse().slice(0, 5);
            
            ultimosDelitos.forEach((delito, index) => {
                const fechaUnix = delito.fecha ? Math.floor(new Date(delito.fecha).getTime() / 1000) : Math.floor(Date.now() / 1000);
                historialTexto += `**${index + 1}.** <t:${fechaUnix}:d> - ${delito.accion || 'Infracción registrada'}\n`;
            });

            if (expediente.totalInfracciones > 5) {
                historialTexto += `\n*... y ${expediente.totalInfracciones - 5} infracciones más archivadas.*`;
            }
        }

        const fechaIngresoUnix = expediente.primerFichaje ? Math.floor(new Date(expediente.primerFichaje).getTime() / 1000) : Math.floor(Date.now() / 1000);
        const aliasUsuario = expediente.ultimoAlias || "Sujeto Desconocido";

        panel.setColor('#ed4245')
             .setAuthor({ name: `ARCHIVOS CLASIFICADOS: ${aliasUsuario.toUpperCase()}` })
             .setTitle(`Expediente Criminal: ${userId}`)
             .setDescription(`Este sujeto representa una amenaza activa. A continuación se desglosa su registro de actividad hostil.`)
             .addFields(
                 { name: '📊 Nivel de Reincidencia', value: `${expediente.totalInfracciones || 1} infracción/es registradas`, inline: true },
                 { name: '📅 Fecha del Primer Ingreso', value: `<t:${fechaIngresoUnix}:F>`, inline: true },
                 { name: '📜 Historial Táctico (Últimos movimientos)', value: historialTexto, inline: false }
             );
    }

    webhook.send({ embeds: [panel] }).catch(err => console.error('[FALLO RED EXPEDIENTES]', err.message));
    
    return true; 
}

module.exports = { ejecutar };
