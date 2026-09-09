/* ==========================================================================
   VISTA: BLACKLIST TOTAL (CON SIMULADOR DISCORD FORENSE Y PAGINACIÓN)
   Archivo: js/vistas/blacklist.js
   ========================================================================== */
window.C4ISR_Views = window.C4ISR_Views || {};

window.C4ISR_Views.blacklist = {
    // Controladores de estado local para la memoria dinámica
    fullData: [],
    filteredData: [],
    currentPage: 1,
    pageSize: 15,

    async render(container) {
        // 1. Inyectar esqueleto estructural con herramientas de filtrado
        container.innerHTML = `
            <div class="panel-header" style="margin-bottom: 1rem; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem;">
                <span class="panel-title" style="font-size: 1.2rem; color: var(--accent-red); text-shadow: var(--glow-red);">REGISTRO DISCIPLINARIO FORENSE (BLACKLIST)</span>
                
                <button id="btn-export-json" class="btn-export" title="Descargar base de datos forense">
                    <span style="font-size: 1.2rem;">📥</span> EXPORTAR MATRIZ JSON
                </button>
            </div>
            
            <div class="toolbar-tactical">
                <input type="text" id="blacklist-search" class="search-input" placeholder="🔍 Buscar por ID, Alias o palabra clave..." autocomplete="off">
                
                <div style="display:flex; gap: 1rem; align-items: center;">
                    <button id="btn-prev" class="btn-action" title="Página Anterior">◀ ANTERIOR</button>
                    <span id="page-indicator" style="font-family: var(--font-mono); color: var(--accent-rz); font-weight: bold; min-width: 80px; text-align: center;">PÁG 1 / 1</span>
                    <button id="btn-next" class="btn-action" title="Página Siguiente">SIGUIENTE ▶</button>
                </div>
            </div>

            <div class="table-responsive">
                <table class="matrix-table">
                    <thead>
                        <tr>
                            <th>IDENTIDAD DE RED</th>
                            <th>NIVEL</th>
                            <th style="width: 50%;">RECREACIÓN FORENSE DEL EVENTO</th>
                            <th style="text-align: right;">ACCIÓN DE PURGA</th>
                        </tr>
                    </thead>
                    <tbody id="blacklist-tbody">
                        <tr>
                            <td colspan="4" style="text-align: center; color: var(--accent-cyan); font-family: var(--font-mono); padding: 2rem;">
                                <span class="cursor-blink">_</span> SINCRONIZANDO MATRIZ DE DEFENSA...
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        `;

        this.bindEvents();
        await this.loadData();
    },

    bindEvents() {
        const searchInput = document.getElementById('blacklist-search');
        const btnPrev = document.getElementById('btn-prev');
        const btnNext = document.getElementById('btn-next');
        const btnExport = document.getElementById('btn-export-json');

        // Búsqueda en tiempo real
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                const term = e.target.value.toLowerCase();
                this.filteredData = this.fullData.filter(item => 
                    item.username.toLowerCase().includes(term) || 
                    item.id.includes(term) || 
                    item.evidencia.toLowerCase().includes(term)
                );
                this.currentPage = 1; // Reinicia a la primera página tras filtrar
                this.renderTable();
            });
        }

        // Paginación: Anterior
        if (btnPrev) {
            btnPrev.addEventListener('click', () => {
                if (this.currentPage > 1) {
                    this.currentPage--;
                    this.renderTable();
                }
            });
        }

        // Paginación: Siguiente
        if (btnNext) {
            btnNext.addEventListener('click', () => {
                const maxPage = Math.ceil(this.filteredData.length / this.pageSize);
                if (this.currentPage < maxPage) {
                    this.currentPage++;
                    this.renderTable();
                }
            });
        }

        // Exportación de Base de Datos
        if (btnExport) {
            btnExport.addEventListener('click', async () => {
                const originalHTML = btnExport.innerHTML;
                btnExport.innerHTML = '<span class="cursor-blink">_</span> COMPILANDO...';
                btnExport.style.pointerEvents = 'none';

                try {
                    const blob = await C4ISR_API.exportarBaseDatos();
                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.style.display = 'none';
                    a.href = url;
                    const fechaGeneracion = new Date().toISOString().replace(/[:.]/g, '-');
                    a.download = `BLACKLIST_C4ISR_${fechaGeneracion}.json`;
                    
                    document.body.appendChild(a);
                    a.click();
                    
                    window.URL.revokeObjectURL(url);
                    a.remove();
                } catch (error) {
                    console.error("[Blacklist] Fallo en exportación:", error);
                    alert("[!] C4ISR_SYS_ERROR: Servidor denegó la descarga.");
                } finally {
                    btnExport.innerHTML = originalHTML;
                    btnExport.style.pointerEvents = 'auto';
                }
            });
        }
    },

    async loadData() {
        const tbody = document.getElementById('blacklist-tbody');
        try {
            const datos = await C4ISR_API.getDatosGlobales();
            this.fullData = datos.blacklist || [];
            this.filteredData = [...this.fullData]; // Clon inicial para el filtrado
            
            this.renderTable();
        } catch (error) {
            console.error("[Blacklist] Error de desincronización:", error);
            tbody.innerHTML = `
                <tr>
                    <td colspan="4" style="text-align: center; color: var(--accent-red); padding: 2rem; font-weight: bold;">
                        [!] ERROR DE LECTURA: CORRUPCIÓN EN EL ENLACE DE RED CON EL ENJAMBRE.
                    </td>
                </tr>
            `;
        }
    },

    renderTable() {
        const tbody = document.getElementById('blacklist-tbody');
        const indicator = document.getElementById('page-indicator');
        
        if (!tbody || !indicator) return;

        if (this.filteredData.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="4" style="text-align: center; color: var(--text-muted); padding: 3rem;">
                        [ SISTEMA SEGURO ] NO SE DETECTAN AMENAZAS QUE COINCIDAN CON LOS CRITERIOS.
                    </td>
                </tr>
            `;
            indicator.textContent = `PÁG 0 / 0`;
            return;
        }

        const maxPage = Math.ceil(this.filteredData.length / this.pageSize);
        indicator.textContent = `PÁG ${this.currentPage} / ${maxPage}`;

        // Cálculo algorítmico del fragmento a mostrar
        const start = (this.currentPage - 1) * this.pageSize;
        const end = start + this.pageSize;
        const paginatedData = this.filteredData.slice(start, end);

        let html = '';

        paginatedData.forEach(infractor => {
            const id = DOMPurify.sanitize(infractor.id);
            const username = DOMPurify.sanitize(infractor.username);
            const evidenciaCruda = DOMPurify.sanitize(infractor.evidencia);
            const servidorOrigen = DOMPurify.sanitize(infractor.servidor || 'Sector Desconocido');
            const fechaOriginal = DOMPurify.sanitize(infractor.fecha);
            
            // Formateo estético de la fecha para el UI de Discord
            const dateObj = new Date(fechaOriginal);
            const fechaFormat = !isNaN(dateObj) ? dateObj.toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' }) : fechaOriginal;

            const nivelReincidencia = parseInt(infractor.reincidencia) || 1;
            const esCritico = nivelReincidencia >= 2 ? 'critical' : '';

            // Construcción del Simulador Nativo de Discord (Forense)
            const discordMock = `
                <div class="discord-mock">
                    <img src="https://cdn.discordapp.com/embed/avatars/0.png" alt="Avatar Genérico" onerror="this.src='data:image/svg+xml;utf8,<svg xmlns=\\'http://www.w3.org/2000/svg\\' viewBox=\\'0 0 100 100\\'><circle cx=\\'50\\' cy=\\'50\\' r=\\'50\\' fill=\\'%232c2f33\\'/><text x=\\'50\\' y=\\'55\\' font-size=\\'40\\' fill=\\'%23ffffff\\' text-anchor=\\'middle\\' dominant-baseline=\\'middle\\'>?</text></svg>'">
                    <div class="discord-mock-content">
                        <div class="discord-mock-header">
                            <span class="user">${username}</span>
                            <span class="date">${fechaFormat} en ${servidorOrigen}</span>
                        </div>
                        <div class="discord-mock-body">${evidenciaCruda}</div>
                    </div>
                </div>
            `;

            html += `
                <tr id="row-${id}" class="${esCritico}">
                    <td style="font-family: var(--font-mono); min-width: 150px;">
                        <div style="color: var(--text-main); font-weight: bold; font-size: 1rem;">${username}</div>
                        <div style="color: var(--text-muted); font-size: 0.75rem;">UID: ${id}</div>
                    </td>
                    <td>
                        <span class="badge badge-red" style="white-space: nowrap;">NIVEL ${nivelReincidencia}</span>
                    </td>
                    <td style="min-width: 350px;">
                        ${discordMock}
                    </td>
                    <td style="text-align: right; min-width: 100px;">
                        <button class="btn-action btn-purge" data-id="${id}" title="Eliminar registro permanentemente">
                            PURGAR
                        </button>
                    </td>
                </tr>
            `;
        });

        tbody.innerHTML = html;
        this.bindPurgeEvents();
    },

    bindPurgeEvents() {
        const purgeButtons = document.querySelectorAll('.btn-purge');
        
        purgeButtons.forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const targetId = e.target.getAttribute('data-id');
                if (!targetId) return;

                const hasAuthorization = window.confirm(`[ ADVERTENCIA CRÍTICA ]\n\n¿Autoriza la eliminación permanente del registro UID: ${targetId}?\nEsta acción destruirá la evidencia forense asociada de manera irreversible.`);
                if (!hasAuthorization) return;

                const rowEl = document.getElementById(`row-${targetId}`);
                const originalText = e.target.textContent;
                
                e.target.textContent = 'EJECUTANDO...';
                e.target.disabled = true;

                try {
                    await C4ISR_API.eliminarInfractor(targetId);
                    
                    // Eliminar lógicamente el dato de la memoria
                    this.fullData = this.fullData.filter(i => i.id !== targetId);
                    this.filteredData = this.filteredData.filter(i => i.id !== targetId);

                    // Efecto visual y recarga de tabla
                    if (rowEl) {
                        rowEl.style.backgroundColor = 'rgba(255, 51, 51, 0.3)';
                        rowEl.style.boxShadow = 'var(--glow-red)';
                        rowEl.style.transition = 'all 0.4s ease-out';
                        rowEl.style.opacity = '0';
                        
                        setTimeout(() => {
                            this.renderTable(); // Re-renderiza para ajustar paginación automáticamente
                        }, 400);
                    }
                } catch (error) {
                    console.error("[Blacklist] Error durante la purga:", error);
                    alert(`[!] Fallo al eliminar el registro. El servidor denegó la petición.`);
                    e.target.textContent = originalText;
                    e.target.disabled = false;
                }
            });
        });
    },

    destroy() {
        // Liberación total de memoria al cambiar de módulo
        this.fullData = [];
        this.filteredData = [];
    }
};
