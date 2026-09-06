// web/servidor.js (Fragmento de la ruta app.get('/panel', ...))

// ... código anterior de autenticación y consulta ...
            let filasHTML = '';
            infractores.forEach(inf => {
                const alias = inf.ultimoAlias || inf.nombreUsuario || 'Desconocido';
                const total = inf.totalInfracciones || 1;
                const fecha = new Date(inf.primerFichaje || inf.fechaFichaje).toLocaleDateString('es-ES');
                const ultimaAccion = inf.historial?.slice(-1)[0]?.accion || inf.accion || "Desconocida";

                // Serializar el historial y protegerlo en Base64 para evitar conflictos de comillas en HTML
                const historialData = JSON.stringify(inf.historial || [{ 
                    fecha: inf.primerFichaje || new Date().toISOString(), 
                    accion: inf.accion || 'Registro heredado', 
                    casoId: inf.casoId || 'N/A' 
                }]);
                const encodedHistorial = Buffer.from(historialData).toString('base64');

                filasHTML += `
                    <tr>
                        <td><a href="#" class="id-link" data-historial="${encodedHistorial}" data-userid="${inf.userId}" data-alias="${alias}">${inf.userId}</a></td>
                        <td class="alias-text">${alias}</td>
                        <td class="infracciones-count">${total}</td>
                        <td>${fecha}</td>
                        <td class="ultima-actividad">${ultimaAccion}</td>
                        <td style="text-align: right;">
                            <form method="POST" action="/panel/eliminar" style="margin: 0;">
                                <input type="hidden" name="userId" value="${inf.userId}">
                                <button type="submit" class="btn btn-purge" onclick="return confirm('ATENCIÓN: ¿Borrar expediente de ${alias}?')">🗑️ Purga</button>
                            </form>
                        </td>
                    </tr>
                `;
            });
// ... resto del archivo servidor.js ...