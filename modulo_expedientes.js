const { WebhookClient, MessageEmbed } = require('discord.js-selfbot-v13');
const database = require('./database.js'); // Importamos el motor de BD

async function ejecutar(message) {
    // Si el mensaje no es el comando de consulta, lo ignoramos rápido
    if (!message.content.toLowerCase().startsWith('!expediente')) return false;

    // Extraer el ID (busca una cadena de 17 a 19 números)
    const matchId = message.content.match(/\d{17,19}/);
    if (!matchId) return false; // Si no hay un ID válido, no hace nada

    const userId = matchId[0];
    
    // El destino de esta consulta (puedes mandarlo al webhook que prefieras)
    const urlWebhook = process.env.WEBHOOK_Squads; 
    if (!urlWebhook) return true;

    const webhook = new WebhookClient({ url: urlWebhook });

    // Consultar a MongoDB
    const expediente = await database.consultarExpediente(userId);

    const panel = new MessageEmbed().setTimestamp();

    if (!expediente) {
        panel.setColor('#2ecc71')
             .setAuthor({ name: 'SISTEMA DE ARCHIVOS PANÓPTICO' })
             .setTitle(`Expediente Limpio`)
             .setDescription(`El identificador \`${userId}\` no consta en las bases de datos criminales de la infraestructura.`);
    } else {
        // Construir el historial formateado
        let historialTexto = "";
        
        // Invertimos el array para que los delitos más recientes salgan primero, y limitamos a los últimos 5 para no romper el Embed
        const ultimosDelitos = expediente.historial.slice().reverse().slice(0, 5);
        
        ultimosDelitos.forEach((delito, index) => {
            const fechaUnix = Math.floor(new Date(delito.fecha).getTime() / 1000);
            historialTexto += `**${index + 1}.** <t:${fechaUnix}:d> - ${delito.accion}\n`;
        });

        if (expediente.totalInfracciones > 5) {
            historialTexto += `\n*... y ${expediente.totalInfracciones - 5} infracciones más archivadas.*`;
        }

        const fechaIngresoUnix = Math.floor(new Date(expediente.primerFichaje).getTime() / 1000);

        panel.setColor('#ed4245')
             .setAuthor({ name: `ARCHIVOS CLASIFICADOS: ${expediente.ultimoAlias.toUpperCase()}` })
             .setTitle(`Expediente Criminal: ${userId}`)
             .setDescription(`Este sujeto representa una amenaza activa. A continuación se desglosa su registro de actividad hostil.`)
             .addFields(
                 { name: '📊 Nivel de Reincidencia', value: `${expediente.totalInfracciones} infracción/es registradas`, inline: true },
                 { name: '📅 Fecha del Primer Ingreso', value: `<t:${fechaIngresoUnix}:F>`, inline: true },
                 { name: '📜 Historial Táctico (Últimos movimientos)', value: historialTexto, inline: false }
             );
    }

    webhook.send({ embeds: [panel] }).catch(err => console.error('[FALLO RED EXPEDIENTES]', err.message));
    
    return true; // Atrapó el comando, detiene la cascada
}

module.exports = { ejecutar };
