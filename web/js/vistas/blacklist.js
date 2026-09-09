/* ==========================================================================
   VISTA: BLACKLIST TOTAL (CON SIMULADOR DISCORD FORENSE)
   Archivo: js/vistas/blacklist.js
   ========================================================================== */
window.C4ISR_Views = window.C4ISR_Views || {};

function formatDiscordDate(dateString) {
    const dateObj = new Date(dateString);
    if (isNaN(dateObj)) return dateString;
    const now = new Date();
    const timeString = dateObj.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    
    if (dateObj.toDateString() === now.toDateString()) {
        return `Hoy a las ${timeString}`;
    }
    
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (dateObj.toDateString() === yesterday.toDateString()) {
        return `Ayer a las ${timeString}`;
    }
    
    return dateObj.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ` ${timeString}`;
}

window.C4ISR_Views.blacklist = {
    fullData: [],
    filteredData: [],
    currentPage: 1,
    pageSize: 15,

    async render(container) {
        container.innerHTML = `
            <div class="panel-header" style="margin-bottom: 1rem; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem;">
                <span class="panel-title" style="font-size: 1.2rem; color: var(--accent-red); text-shadow: var(--glow-red);">MATRIZ DISCIPLINARIA FORENSE</span>
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
                            <th style="text-align: right;">OPERACIONES</th>
                        </tr>
                    </thead>
                    <tbody id="blacklist-tbody">
                        <tr><td colspan="4" style="text-align: center; color: var(--accent-rz); padding: 2rem;"><span class="cursor-blink">_</span> SINCRONIZANDO MATRIZ...</td></tr>
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

        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                const term = e.target.value.toLowerCase();
                this.filteredData = this.fullData.filter(item => 
                    item.username.toLowerCase().includes(term) || 
                    item.id.includes(term) || 
                    item.evidencia.toLowerCase().includes(term)
                );
                this.currentPage = 1;
                this.renderTable();
            });
        }

        if (btnPrev) {
            btnPrev.addEventListener('click', () => {
                if (this.currentPage > 1) { this.currentPage--; this.renderTable(); }
            });
        }

        if (btnNext) {
            btnNext.addEventListener('click', () => {
                const maxPage = Math.ceil(this.filteredData.length / this.pageSize);
                if (this.currentPage < maxPage) { this.currentPage++; this.renderTable(); }
            });
        }

        if (btnExport) {
            btnExport.addEventListener('click', async () => {
                const originalHTML = btnExport.innerHTML;
                btnExport.innerHTML = '<span class="cursor-blink">_</span> COMPILANDO...';
                try {
                    const blob = await C4ISR_API.exportarBaseDatos();
                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.style.display = 'none'; a.href = url;
                    a.download = `BLACKLIST_C4ISR_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
                    document.body.appendChild(a); a.click(); window.URL.revokeObjectURL(url); a.remove();
                } catch (error) {
                    alert("[!] C4ISR_SYS_ERROR: Servidor denegó la descarga.");
                } finally {
                    btnExport.innerHTML = originalHTML;
                }
            });
        }
    },

    async loadData() {
        const tbody = document.getElementById('blacklist-tbody');
        try {
            const datos = await C4ISR_API.getDatosGlobales();
            this.fullData = datos.blacklist || [];
            this.filteredData = [...this.fullData];
            this.renderTable();
        } catch (error) {
            tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--accent-red); padding: 2rem;">[!] ERROR DE LECTURA DE RED.</td></tr>`;
        }
    },

    renderTable() {
        const tbody = document.getElementById('blacklist-tbody');
        const indicator = document.getElementById('page-indicator');
        
        if (!tbody || !indicator) return;

        if (this.filteredData.length === 0) {
            tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--text-muted); padding: 3rem;">NO SE DETECTAN AMENAZAS.</td></tr>`;
            indicator.textContent = `PÁG 0 / 0`;
            return;
        }

        const maxPage = Math.ceil(this.filteredData.length / this.pageSize);
        indicator.textContent = `PÁG ${this.currentPage} / ${maxPage}`;

        const start = (this.currentPage - 1) * this.pageSize;
        const paginatedData = this.filteredData.slice(start, start + this.pageSize);

        let html = '';

        paginatedData.forEach(infractor => {
            const id = DOMPurify.sanitize(infractor.id);
            const username = DOMPurify.sanitize(infractor.username);
            const evidenciaCruda = DOMPurify.sanitize(infractor.evidencia);
            const fechaFormat = formatDiscordDate(infractor.fecha);
            const nivelReincidencia = parseInt(infractor.reincidencia) || 1;
            
            // Recreación del Chat Nativo de Discord
            const discordMock = `
                <div class="discord-mock">
                    <img src="https://cdn.discordapp.com/embed/avatars/1.png" alt="Avatar Discord">
                    <div class="discord-mock-content">
                        <div class="discord-mock-header">
                            <span class="user role-color" title="Ver Expediente OSINT">${username}</span>
                            <span class="date">${fechaFormat}</span>
                        </div>
                        <div class="discord-mock-body">${evidenciaCruda}</div>
                    </div>
                </div>
            `;

            html += `
                <tr id="row-${id}">
                    <td style="font-family: var(--font-mono); min-width: 150px;">
                        <div style="color: var(--text-main); font-weight: bold; font-size: 1rem;">${username}</div>
                        <div style="color: var(--text-muted); font-size: 0.75rem;">UID: ${id}</div>
                    </td>
                    <td><span class="badge badge-red">NIVEL ${nivelReincidencia}</span></td>
                    <td style="min-width: 350px;">${discordMock}</td>
                    <td style="text-align: right; min-width: 160px;">
                        <button class="btn-action btn-view-profile" data-id="${id}" style="border-color: var(--accent-cyan); color: var(--accent-cyan); margin-right: 0.5rem;" title="Inspeccionar Historial">VER PERFIL</button>
                        <button class="btn-action btn-purge" data-id="${id}" title="Eliminar permanentemente">PURGAR</button>
                    </td>
                </tr>
            `;
        });

        tbody.innerHTML = html;
        this.bindDynamicEvents();
    },

    bindDynamicEvents() {
        // Evento de Purga
        document.querySelectorAll('.btn-purge').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const targetId = e.target.getAttribute('data-id');
                if (!targetId) return;

                if (!window.confirm(`¿Autoriza la eliminación permanente del registro UID: ${targetId}?`)) return;

                const rowEl = document.getElementById(`row-${targetId}`);
                e.target.textContent = '...';
                e.target.disabled = true;

                try {
                    await C4ISR_API.eliminarInfractor(targetId);
                    this.fullData = this.fullData.filter(i => i.id !== targetId);
                    this.filteredData = this.filteredData.filter(i => i.id !== targetId);
                    if (rowEl) {
                        rowEl.style.opacity = '0';
                        setTimeout(() => { this.renderTable(); }, 300);
                    }
                } catch (error) {
                    alert(`[!] Fallo al eliminar el registro.`);
                    e.target.disabled = false;
                }
            });
        });

        // Evento de Redirección a Expedientes OSINT
        document.querySelectorAll('.btn-view-profile, .discord-mock-header .user').forEach(btn => {
            btn.addEventListener('click', (e) => {
                // Obtener ID (ya sea desde el data-id del botón, o subiendo en el DOM si hizo clic en el nombre)
                const targetId = e.target.getAttribute('data-id') || e.target.closest('tr').id.replace('row-', '');
                if (targetId) {
                    // Inyección de variable de entorno global para la SPA
                    window.C4ISR_TARGET_OVERRIDE = targetId;
                    window.AppController.navigate('expedientes');
                }
            });
        });
    },

    destroy() {
        this.fullData = [];
        this.filteredData = [];
    }
};
