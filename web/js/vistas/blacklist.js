'use strict';

/* ==========================================================================
   VISTA: BLACKLIST TOTAL (AUDITORÍA FORENSE Y GESTIÓN DISCIPLINARIA)
   Archivo: js/vistas/blacklist.js
   ========================================================================== */

window.C4ISR_Views = window.C4ISR_Views || {};

function formatearFechaForense(dateString) {
    if (!dateString) return 'Fecha desconocida';
    const dateObj = new Date(dateString);
    if (Number.isNaN(dateObj.getTime())) return String(dateString);

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

    return `${dateObj.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' })} ${timeString}`;
}

function obtenerAvatarPorDefecto(userId) {
    try {
        const index = Number(BigInt(String(userId).replace(/\D/g, '') || '0') % 5n);
        return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
    } catch (_) {
        return 'https://cdn.discordapp.com/embed/avatars/0.png';
    }
}

window.C4ISR_Views.blacklist = {
    fullData: [],
    filteredData: [],
    currentPage: 1,
    pageSize: 15,
    searchDebounceTimer: null,

    async render(container) {
        container.innerHTML = `
            <div class="panel-header" style="margin-bottom: 1.15rem;">
                <div>
                    <span class="panel-title" style="font-size: 1.1rem; color: var(--accent-rz);">MATRIZ DISCIPLINARIA FORENSE</span>
                    <span id="blacklist-counter-badge" class="badge badge-red" style="margin-left: 0.75rem;">0 SUJETOS</span>
                </div>
                <button id="btn-export-json" class="btn-export" type="button" title="Descargar base de datos completa en JSON">
                    <span>📥</span> EXPORTAR BASE DE DATOS (JSON)
                </button>
            </div>

            <div class="toolbar-tactical">
                <input type="text" id="blacklist-search" class="search-input" placeholder="🔍 Filtrar por UID, Alias, Servidor o Evidencia..." autocomplete="off">
                <div style="display: flex; gap: 0.75rem; align-items: center;">
                    <button id="btn-prev" class="btn-action" type="button">◀ ANTERIOR</button>
                    <span id="page-indicator" style="font-family: var(--font-mono); color: var(--text-secondary); font-size: 0.8rem; min-width: 90px; text-align: center;">PÁG 1 / 1</span>
                    <button id="btn-next" class="btn-action" type="button">SIGUIENTE ▶</button>
                </div>
            </div>

            <div class="table-responsive">
                <table class="matrix-table">
                    <thead>
                        <tr>
                            <th style="width: 22%;">IDENTIDAD DEL OBJETIVO</th>
                            <th style="width: 12%;">REINCIDENCIA</th>
                            <th style="width: 48%;">ÚLTIMA EVIDENCIA INTERCEPTADA</th>
                            <th style="width: 18%; text-align: right;">ACCIONES</th>
                        </tr>
                    </thead>
                    <tbody id="blacklist-tbody">
                        <tr>
                            <td colspan="4" style="text-align: center; color: var(--text-muted); padding: 2.5rem; font-family: var(--font-mono);">
                                [ SISTEMA ] Sincronizando registros disciplinarios...
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

        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                if (this.searchDebounceTimer) clearTimeout(this.searchDebounceTimer);
                this.searchDebounceTimer = setTimeout(() => {
                    const term = e.target.value.toLowerCase().trim();
                    this.filteredData = this.fullData.filter(item =>
                        String(item.username || '').toLowerCase().includes(term) ||
                        String(item.id || '').includes(term) ||
                        String(item.evidencia || '').toLowerCase().includes(term) ||
                        String(item.servidor || '').toLowerCase().includes(term)
                    );
                    this.currentPage = 1;
                    this.renderTable();
                }, 120);
            });
        }

        if (btnPrev) {
            btnPrev.addEventListener('click', () => {
                if (this.currentPage > 1) {
                    this.currentPage--;
                    this.renderTable();
                }
            });
        }

        if (btnNext) {
            btnNext.addEventListener('click', () => {
                const maxPage = Math.max(1, Math.ceil(this.filteredData.length / this.pageSize));
                if (this.currentPage < maxPage) {
                    this.currentPage++;
                    this.renderTable();
                }
            });
        }

        if (btnExport) {
            btnExport.addEventListener('click', async () => {
                const originalHTML = btnExport.innerHTML;
                btnExport.innerHTML = 'COMPILANDO...';
                btnExport.disabled = true;
                try {
                    const blob = await window.C4ISR_API.exportarBaseDatos();
                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.style.display = 'none';
                    a.href = url;
                    a.download = `C4ISR_DATABASE_${new Date().toISOString().slice(0, 10)}.json`;
                    document.body.appendChild(a);
                    a.click();
                    window.URL.revokeObjectURL(url);
                    a.remove();
                } catch (error) {
                    alert('[!] Error al exportar la base de datos.');
                } finally {
                    btnExport.innerHTML = originalHTML;
                    btnExport.disabled = false;
                }
            });
        }
    },

    async loadData() {
        const tbody = document.getElementById('blacklist-tbody');
        try {
            const datos = await window.C4ISR_API.getDatosGlobales();
            this.fullData = Array.isArray(datos.blacklist) ? datos.blacklist : [];
            this.filteredData = [...this.fullData];
            this.renderTable();
        } catch (error) {
            if (tbody) {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="4" style="text-align: center; color: var(--accent-red); padding: 2rem; font-family: var(--font-mono);">
                            [!] ERROR DE LECTURA DE RED AL CONSULTAR LA BLACKLIST.
                        </td>
                    </tr>`;
            }
        }
    },

    renderTable() {
        const tbody = document.getElementById('blacklist-tbody');
        const indicator = document.getElementById('page-indicator');
        const counterBadge = document.getElementById('blacklist-counter-badge');
        if (!tbody || !indicator) return;

        if (counterBadge) {
            counterBadge.textContent = `${this.filteredData.length} SUJETO(S)`;
        }

        if (this.filteredData.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="4" style="text-align: center; color: var(--text-muted); padding: 3rem; font-family: var(--font-mono);">
                        NO SE ENCONTRARON REGISTROS QUE COINCIDAN CON EL FILTRO.
                    </td>
                </tr>`;
            indicator.textContent = 'PÁG 0 / 0';
            return;
        }

        const maxPage = Math.max(1, Math.ceil(this.filteredData.length / this.pageSize));
        if (this.currentPage > maxPage) this.currentPage = maxPage;
        indicator.textContent = `PÁG ${this.currentPage} / ${maxPage}`;

        const start = (this.currentPage - 1) * this.pageSize;
        const paginatedData = this.filteredData.slice(start, start + this.pageSize);

        tbody.innerHTML = paginatedData.map(infractor => {
            const id = DOMPurify.sanitize(String(infractor.id || ''));
            const username = DOMPurify.sanitize(String(infractor.username || 'Desconocido'));
            const servidor = DOMPurify.sanitize(String(infractor.servidor || 'N/A'));
            const evidenciaSaneada = DOMPurify.sanitize(String(infractor.evidencia || '[ Sin evidencia ]'));
            const fechaFormat = formatearFechaForense(infractor.fecha);
            const nivelReincidencia = Number.parseInt(infractor.reincidencia, 10) || 0;

            const badgeClass = nivelReincidencia >= 3
                ? 'badge-red'
                : (nivelReincidencia >= 1 ? 'badge-amber' : 'badge-green');
            const avatarUrl = obtenerAvatarPorDefecto(id);

            return `
                <tr id="row-${id}">
                    <td style="font-family: var(--font-mono);">
                        <div style="color: var(--text-main); font-weight: 600; font-size: 0.92rem;">${username}</div>
                        <div class="selectable" style="color: var(--text-muted); font-size: 0.74rem; margin-top: 2px;">UID: ${id}</div>
                        <div style="color: var(--accent-rz); font-size: 0.7rem; margin-top: 4px;">📍 ${servidor}</div>
                    </td>
                    <td>
                        <span class="badge ${badgeClass}">NIVEL ${nivelReincidencia}</span>
                    </td>
                    <td>
                        <div class="discord-mock">
                            <img src="${avatarUrl}" alt="Avatar">
                            <div class="discord-mock-content">
                                <div class="discord-mock-header">
                                    <span class="user role-color btn-view-profile" data-id="${id}" style="cursor: pointer;" title="Abrir expediente completo">${username}</span>
                                    <span class="date">${fechaFormat}</span>
                                </div>
                                <div class="discord-mock-body">${evidenciaSaneada}</div>
                            </div>
                        </div>
                    </td>
                    <td style="text-align: right; white-space: nowrap;">
                        <button class="btn-action btn-view-profile" data-id="${id}" type="button" style="margin-right: 0.4rem;">EXPEDIENTE</button>
                        <button class="btn-action btn-purge" data-id="${id}" type="button">PURGAR</button>
                    </td>
                </tr>
            `;
        }).join('');

        this.bindDynamicEvents();
    },

    bindDynamicEvents() {
        document.querySelectorAll('#blacklist-tbody .btn-purge').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const targetId = e.currentTarget.getAttribute('data-id');
                if (!targetId) return;

                if (!window.confirm(`¿Confirmar eliminación permanente del expediente UID: ${targetId}?`)) return;

                const botonActual = e.currentTarget;
                botonActual.textContent = '...';
                botonActual.disabled = true;

                try {
                    await window.C4ISR_API.eliminarInfractor(targetId);
                    this.fullData = this.fullData.filter(i => String(i.id) !== targetId);
                    this.filteredData = this.filteredData.filter(i => String(i.id) !== targetId);
                    this.renderTable();
                } catch (error) {
                    alert('[!] No se pudo eliminar el registro.');
                    botonActual.textContent = 'PURGAR';
                    botonActual.disabled = false;
                }
            });
        });

        document.querySelectorAll('#blacklist-tbody .btn-view-profile').forEach(el => {
            el.addEventListener('click', (e) => {
                const targetId = e.currentTarget.getAttribute('data-id');
                if (targetId) {
                    window.C4ISR_TARGET_OVERRIDE = targetId;
                    window.AppController.navigate('expedientes');
                }
            });
        });
    },

    destroy() {
        if (this.searchDebounceTimer) clearTimeout(this.searchDebounceTimer);
        this.fullData = [];
        this.filteredData = [];
    }
};
