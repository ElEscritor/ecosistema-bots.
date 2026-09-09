/* ==========================================================================
   VISTA: BLACKLIST TOTAL (REGISTRO DISCIPLINARIO)
   Archivo: js/vistas/blacklist.js
   Objetivo: Tabla matriz de infractores, purga permanente y exportación JSON
   ========================================================================== */

window.C4ISR_Views = window.C4ISR_Views || {};

window.C4ISR_Views.blacklist = {
    async render(container) {
        // 1. Inyectar esqueleto de la vista con el botón de exportación en la cabecera
        container.innerHTML = `
            <div class="panel-header" style="margin-bottom: 1.5rem; display: flex; justify-content: space-between; align-items: center;">
                <span class="panel-title" style="font-size: 1.2rem; color: var(--accent-red); text-shadow: var(--glow-red);">REGISTRO DISCIPLINARIO (BLACKLIST)</span>
                
                <button id="btn-export-json" class="btn-export" title="Descargar base de datos forense">
                    <span style="font-size: 1.2rem;">📥</span> EXPORTAR MATRIZ JSON
                </button>
            </div>
            
            <div class="table-responsive">
                <table class="matrix-table">
                    <thead>
                        <tr>
                            <th>IDENTIDAD DE RED</th>
                            <th>REINCIDENCIA</th>
                            <th>EVIDENCIA (SANEADA)</th>
                            <th>FECHA INTERCEPCIÓN</th>
                            <th style="text-align: right;">PROTOCOLO</th>
                        </tr>
                    </thead>
                    <tbody id="blacklist-tbody">
                        <tr>
                            <td colspan="5" style="text-align: center; color: var(--accent-cyan); font-family: var(--font-mono); padding: 2rem;">
                                <span class="cursor-blink">_</span> SINCRONIZANDO CON NÚCLEO...
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        `;

        // 2. Activar listener del botón de exportación antes de la carga asíncrona
        this.bindExportEvent();

        // 3. Obtener y renderizar los datos de la matriz
        await this.loadData();
    },

    async loadData() {
        const tbody = document.getElementById('blacklist-tbody');
        
        try {
            const datos = await C4ISR_API.getDatosGlobales();
            const blacklist = datos.blacklist || [];

            if (blacklist.length === 0) {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="5" style="text-align: center; color: var(--text-muted); padding: 3rem;">
                            [ SISTEMA SEGURO ] NO SE DETECTAN AMENAZAS EN EL REGISTRO ACTUAL.
                        </td>
                    </tr>
                `;
                return;
            }

            let filasHTML = '';

            blacklist.forEach(infractor => {
                // Saneamiento riguroso de cada celda contra XSS
                const id = DOMPurify.sanitize(infractor.id || 'N/A');
                const username = DOMPurify.sanitize(infractor.username || 'USUARIO_DESCONOCIDO');
                const nivelReincidencia = parseInt(infractor.reincidencia) || 1;
                const evidencia = DOMPurify.sanitize(infractor.evidencia || '[ SIN CONTEXTO CRÍTICO ]');
                const fecha = DOMPurify.sanitize(infractor.fecha || 'DESCONOCIDA');

                // Lógica térmica para insignias de nivel de amenaza
                let claseBadge = 'badge-green';
                let esCritico = '';
                
                if (nivelReincidencia === 1) {
                    claseBadge = 'badge-amber';
                } else if (nivelReincidencia >= 2) {
                    claseBadge = 'badge-red';
                    esCritico = 'critical'; // Activa el hover rojo intenso definido en modulos.css
                }

                filasHTML += `
                    <tr id="row-${id}" class="${esCritico}">
                        <td style="font-family: var(--font-mono);">
                            <div style="color: var(--text-main); font-weight: bold; font-size: 1rem;">${username}</div>
                            <div style="color: var(--text-muted); font-size: 0.75rem;">UID: ${id}</div>
                        </td>
                        <td>
                            <span class="badge ${claseBadge}">NIVEL ${nivelReincidencia}</span>
                        </td>
                        <td style="max-width: 300px;">
                            <div style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-family: var(--font-mono); font-size: 0.85rem; color: var(--text-main);" title="${evidencia}">
                                ${evidencia}
                            </div>
                        </td>
                        <td style="color: var(--text-muted); font-family: var(--font-mono); font-size: 0.85rem;">
                            ${fecha}
                        </td>
                        <td style="text-align: right;">
                            <button class="btn-action btn-purge" data-id="${id}" title="Eliminar registro permanentemente">
                                PURGAR
                            </button>
                        </td>
                    </tr>
                `;
            });

            tbody.innerHTML = filasHTML;

            // 4. Activar listeners de los botones de purga inyectados
            this.bindPurgeEvents();

        } catch (error) {
            console.error("[Blacklist] Error al recuperar registros disciplinarios:", error);
            tbody.innerHTML = `
                <tr>
                    <td colspan="5" style="text-align: center; color: var(--accent-red); padding: 2rem; font-weight: bold;">
                        [!] ERROR DE LECTURA: CORRUPCIÓN EN EL ENLACE CON LA BASE DE DATOS.
                    </td>
                </tr>
            `;
        }
    },

    bindExportEvent() {
        const btnExport = document.getElementById('btn-export-json');
        if (!btnExport) return;

        btnExport.addEventListener('click', async () => {
            const originalHTML = btnExport.innerHTML;
            btnExport.innerHTML = '<span class="cursor-blink">_</span> COMPILANDO...';
            btnExport.style.pointerEvents = 'none';

            try {
                // Solicita el archivo binario al endpoint
                const blob = await C4ISR_API.exportarBaseDatos();
                
                // Crea una URL temporal en memoria y fuerza la descarga HTML5
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.style.display = 'none';
                a.href = url;
                
                // Generar nombre de archivo con marca de tiempo táctica
                const fechaGeneracion = new Date().toISOString().replace(/[:.]/g, '-');
                a.download = `C4ISR_DATABASE_EXPORT_${fechaGeneracion}.json`;
                
                document.body.appendChild(a);
                a.click();
                
                // Limpieza de memoria
                window.URL.revokeObjectURL(url);
                a.remove();
                
            } catch (error) {
                console.error("[Blacklist] Fallo en exportación de base de datos:", error);
                alert("[!] C4ISR_SYS_ERROR: La descarga del volcado forense fue rechazada por el servidor.");
            } finally {
                btnExport.innerHTML = originalHTML;
                btnExport.style.pointerEvents = 'auto';
            }
        });
    },

    bindPurgeEvents() {
        const purgeButtons = document.querySelectorAll('.btn-purge');
        
        purgeButtons.forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const targetId = e.target.getAttribute('data-id');
                if (!targetId) return;

                // Confirmación de seguridad estricta
                const hasAuthorization = window.confirm(`[ ADVERTENCIA CRÍTICA ]\n\n¿Autoriza la eliminación permanente del registro UID: ${targetId}?\nEsta acción destruirá la evidencia forense asociada de manera irreversible.`);
                if (!hasAuthorization) return;

                const rowEl = document.getElementById(`row-${targetId}`);
                const originalText = e.target.textContent;
                
                e.target.textContent = 'EJECUTANDO...';
                e.target.disabled = true;

                try {
                    await C4ISR_API.eliminarInfractor(targetId);
                    
                    // Efecto visual de desintegración
                    if (rowEl) {
                        rowEl.style.backgroundColor = 'rgba(255, 51, 51, 0.3)';
                        rowEl.style.boxShadow = 'var(--glow-red)';
                        rowEl.style.transition = 'all 0.4s ease-out';
                        rowEl.style.opacity = '0';
                        
                        setTimeout(() => {
                            rowEl.remove();
                            // Evaluar si la tabla quedó vacía para mostrar el mensaje de sistema limpio
                            const tbody = document.getElementById('blacklist-tbody');
                            if (tbody && tbody.children.length === 0) {
                                tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 3rem;">[ SISTEMA SEGURO ] NO SE DETECTAN AMENAZAS EN EL REGISTRO ACTUAL.</td></tr>`;
                            }
                        }, 400);
                    }
                } catch (error) {
                    console.error("[Blacklist] Error de desincronización durante la purga:", error);
                    alert(`[!] C4ISR_SYS_ERROR: Fallo al eliminar el registro ${targetId}. El servidor denegó la petición.`);
                    e.target.textContent = originalText;
                    e.target.disabled = false;
                }
            });
        });
    },

    destroy() {
        // Espacio para liberación explícita de listeners globales si se hubieran añadido al document/window
    }
};