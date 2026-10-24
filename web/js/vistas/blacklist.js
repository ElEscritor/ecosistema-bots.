'use strict';

/* ==========================================================================
   VISTA: MATRIZ DISCIPLINARIA FORENSE C4ISR v4.0 (CHIPS // ACORDEON INLINE)
   Archivo: js/vistas/blacklist.js
   ========================================================================== */

window.C4ISR_Views = window.C4ISR_Views || {};

const DISCORD_EPOCH_BL = 1420070400000n;

function formatearFechaForense(dateString) {
    if (!dateString) return 'Sin fecha';
    const dateObj = new Date(dateString);
    if (Number.isNaN(dateObj.getTime())) return String(dateString);
    const now = new Date();
    const timeString = dateObj.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    if (dateObj.toDateString() === now.toDateString()) {
        return `Hoy ${timeString}`;
    }
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (dateObj.toDateString() === yesterday.toDateString()) {
        return `Ayer ${timeString}`;
    }
    return `${dateObj.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' })} ${timeString}`;
}

function obtenerAvatarRealOFallback(userId, liveAvatar) {
    if (liveAvatar && typeof liveAvatar === 'string' && liveAvatar.startsWith('http')) {
        return liveAvatar;
    }
    try {
        const index = Number(BigInt(String(userId).replace(/\D/g, '') || '0') % 5n);
        return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
    } catch (_) {
        return 'https://cdn.discordapp.com/embed/avatars/0.png';
    }
}

function analizarBurnerSnowflake(userId) {
    try {
        const clean = String(userId || '').replace(/\D/g, '');
        if (clean.length < 17) return null;
        const ms = Number((BigInt(clean) >> 22n) + DISCORD_EPOCH_BL);
        const dias = Math.floor((Date.now() - ms) / 86400000);
        return { ms, dias, esBurner: dias <= 21 };
    } catch (_) {
        return null;
    }
}

function limpiarResumenEvidencia(rawStr) {
    if (!rawStr || typeof rawStr !== 'string') return '[ Sin evidencia ]';
    if (rawStr.trim().startsWith('<div')) {
        return rawStr.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 220);
    }
    return rawStr.slice(0, 260);
}

const COLORES_VECTOR = {
    'SQUAD': { bg: 'rgba(239, 68, 68, 0.16)', col: '#f87171', border: 'rgba(239, 68, 68, 0.4)' },
    'RAID': { bg: 'rgba(249, 115, 22, 0.16)', col: '#fb923c', border: 'rgba(249, 115, 22, 0.4)' },
    'XN-BAN': { bg: 'rgba(255, 0, 85, 0.2)', col: '#ff2a6d', border: '#ff2a6d' },
    'VPS-5604': { bg: 'rgba(252, 238, 10, 0.15)', col: '#fcee0a', border: 'rgba(252, 238, 10, 0.45)' },
    'LC-GUARD': { bg: 'rgba(239, 68, 68, 0.2)', col: '#fca5a5', border: '#ef4444' },
    'LINK': { bg: 'rgba(192, 132, 252, 0.14)', col: '#c084fc', border: 'rgba(192, 132, 252, 0.38)' },
    'OSINT': { bg: 'rgba(56, 189, 248, 0.14)', col: '#38bdf8', border: 'rgba(56, 189, 248, 0.38)' }
};

window.C4ISR_Views.blacklist = {
    fullData: [],
    filteredData: [],
    filterChip: 'THREATS', // 'ALL' | 'THREATS' | 'REINCIDENT' | 'BURNERS' | 'EXTERNAL_BAN' | 'OSINT_ONLY'
    sortBy: 'REINCIDENCE', // 'REINCIDENCE' | 'RECENT' | 'NEWEST_ACCOUNT'
    searchTerm: '',
    expandedRowIds: new Set(),
    currentPage: 1,
    pageSize: 15,
    searchDebounceTimer: null,

    async render(container) {
        container.innerHTML = `
            <style>
                .bl-chip-group {
                    display: flex;
                    gap: 0.4rem;
                    flex-wrap: wrap;
                }
                .bl-chip {
                    background: rgba(255, 255, 255, 0.03);
                    border: 1px solid rgba(255, 255, 255, 0.12);
                    color: var(--text-secondary);
                    font-family: var(--font-mono);
                    font-size: 0.7rem;
                    padding: 0.36rem 0.7rem;
                    border-radius: 5px;
                    cursor: pointer;
                    transition: all 0.14s ease;
                }
                .bl-chip.active, .bl-chip:hover {
                    background: rgba(255, 42, 109, 0.16);
                    border-color: var(--accent-rz);
                    color: #ffffff;
                }
                .vector-pill {
                    display: inline-block;
                    padding: 1px 6px;
                    border-radius: 3px;
                    font-family: var(--font-mono);
                    font-size: 0.63rem;
                    font-weight: 700;
                    margin-right: 4px;
                    margin-top: 3px;
                }
                .inline-dossier-row td {
                    background: rgba(9, 8, 13, 0.95) !important;
                    border-left: 3px solid #00f0ff;
                    padding: 1rem 1.25rem !important;
                }
            </style>

            <div class="panel-header" style="margin-bottom: 0.9rem;">
                <div style="display: flex; align-items: center; gap: 0.65rem; flex-wrap: wrap;">
                    <span class="panel-title" style="font-size: 1.05rem; color: var(--accent-rz);">MATRIZ DISCIPLINARIA FORENSE // CONTROL DE AMENAZAS</span>
                    <span id="blacklist-counter-badge" class="badge badge-red">0 SUJETOS</span>
                </div>
                <div style="display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap;">
                    <div class="bl-chip-group">
                        <button class="bl-chip active" data-chip="THREATS" type="button" title="Oculta perfiles puramente pasivos de OSINT y muestra infractores reales">AMENAZAS / INFRACTORES</button>
                        <button class="bl-chip" data-chip="ALL" type="button">TODOS LOS REGISTROS</button>
                        <button class="bl-chip" data-chip="REINCIDENT" type="button">REINCIDENTES (3+)</button>
                        <button class="bl-chip" data-chip="EXTERNAL_BAN" type="button">BANEADOS XN / VPS</button>
                        <button class="bl-chip" data-chip="BURNERS" type="button">CUENTAS BURNER (&lt;21D)</button>
                        <button class="bl-chip" data-chip="OSINT_ONLY" type="button">SOLO OSINT</button>
                    </div>
                    <button id="btn-export-json" class="btn-export" type="button">EXPORTAR BD (JSON)</button>
                </div>
            </div>

            <div class="toolbar-tactical" style="margin-bottom: 1rem; padding: 0.65rem 1rem;">
                <div style="display: flex; gap: 0.6rem; align-items: center; flex: 1; flex-wrap: wrap;">
                    <input type="text" id="blacklist-search" class="search-input" style="width: 320px;" placeholder="Filtrar por UID, Alias, Pais, Servidor o Evidencia..." autocomplete="off">
                    <select id="blacklist-sort" style="background: var(--bg-input); color: var(--text-main); border: 1px solid rgba(255,255,255,0.14); border-radius: 4px; padding: 0.45rem 0.65rem; font-family: var(--font-mono); font-size: 0.74rem;">
                        <option value="REINCIDENCE">ORDENAR: MAYOR REINCIDENCIA</option>
                        <option value="RECENT">ORDENAR: ACTIVIDAD MAS RECIENTE</option>
                        <option value="NEWEST_ACCOUNT">ORDENAR: CUENTA MAS NUEVA (BURNER)</option>
                    </select>
                </div>
                <div style="display: flex; gap: 0.65rem; align-items: center;">
                    <button id="btn-prev" class="btn-action" type="button">&larr; ANTERIOR</button>
                    <span id="page-indicator" style="font-family: var(--font-mono); color: var(--text-secondary); font-size: 0.78rem; min-width: 85px; text-align: center;">PAG 1 / 1</span>
                    <button id="btn-next" class="btn-action" type="button">SIGUIENTE &rarr;</button>
                </div>
            </div>

            <div class="table-responsive">
                <table class="matrix-table">
                    <thead>
                        <tr>
                            <th style="width: 25%;">IDENTIDAD Y VECTORES</th>
                            <th style="width: 12%;">AMENAZA</th>
                            <th style="width: 45%;">ULTIMA EVIDENCIA INTERCEPTADA</th>
                            <th style="width: 18%; text-align: right;">OPERACIONES</th>
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

    applyFiltersAndSort() {
        this.filteredData = this.fullData.filter(item => {
            const reinc = Number(item.reincidencia) || 0;
            const extHostil = Boolean(item.intelExterna?.amenazaConfirmada);
            const sf = analizarBurnerSnowflake(item.id);

            if (this.filterChip === 'THREATS') {
                if (reinc === 0 && !extHostil && !(item.vectores || []).includes('LINK')) return false;
            } else if (this.filterChip === 'REINCIDENT') {
                if (reinc < 3) return false;
            } else if (this.filterChip === 'EXTERNAL_BAN') {
                if (!extHostil) return false;
            } else if (this.filterChip === 'BURNERS') {
                if (!sf || !sf.esBurner) return false;
            } else if (this.filterChip === 'OSINT_ONLY') {
                if (reinc > 0 || extHostil) return false;
            }

            if (this.searchTerm) {
                const matchName = String(item.username || '').toLowerCase().includes(this.searchTerm);
                const matchId = String(item.id || '').includes(this.searchTerm);
                const matchEv = String(item.evidencia || '').toLowerCase().includes(this.searchTerm);
                const matchSrv = String(item.servidor || '').toLowerCase().includes(this.searchTerm);
                const matchPais = String(item.perfilOsint?.pais || '').toLowerCase().includes(this.searchTerm);
                return matchName || matchId || matchEv || matchSrv || matchPais;
            }
            return true;
        });

        this.filteredData.sort((a, b) => {
            if (this.sortBy === 'RECENT') {
                return new Date(b.fecha || 0) - new Date(a.fecha || 0);
            }
            if (this.sortBy === 'NEWEST_ACCOUNT') {
                const sfA = analizarBurnerSnowflake(a.id)?.ms || 0;
                const sfB = analizarBurnerSnowflake(b.id)?.ms || 0;
                return sfB - sfA;
            }
            const diffReinc = (Number(b.reincidencia) || 0) - (Number(a.reincidencia) || 0);
            if (diffReinc !== 0) return diffReinc;
            return new Date(b.fecha || 0) - new Date(a.fecha || 0);
        });

        this.currentPage = 1;
        this.renderTable();
    },

    bindEvents() {
        const searchInput = document.getElementById('blacklist-search');
        const sortSelect = document.getElementById('blacklist-sort');
        const btnPrev = document.getElementById('btn-prev');
        const btnNext = document.getElementById('btn-next');
        const btnExport = document.getElementById('btn-export-json');

        document.querySelectorAll('.bl-chip').forEach(chip => {
            chip.addEventListener('click', () => {
                document.querySelectorAll('.bl-chip').forEach(c => c.classList.remove('active'));
                chip.classList.add('active');
                this.filterChip = chip.getAttribute('data-chip') || 'ALL';
                this.applyFiltersAndSort();
            });
        });

        if (sortSelect) {
            sortSelect.addEventListener('change', (e) => {
                this.sortBy = e.target.value;
                this.applyFiltersAndSort();
            });
        }

        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                if (this.searchDebounceTimer) clearTimeout(this.searchDebounceTimer);
                this.searchDebounceTimer = setTimeout(() => {
                    this.searchTerm = e.target.value.toLowerCase().trim();
                    this.applyFiltersAndSort();
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
                } catch (_) {
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
            // Si aún no hay amenazas graves, mostrar TODOS por defecto para que la tabla nunca parezca vacía
            const hayAmenazas = this.fullData.some(item => (Number(item.reincidencia) || 0) > 0 || item.intelExterna?.amenazaConfirmada);
            if (!hayAmenazas) {
                this.filterChip = 'ALL';
                document.querySelectorAll('.bl-chip').forEach(c => {
                    c.classList.toggle('active', c.getAttribute('data-chip') === 'ALL');
                });
            }
            this.applyFiltersAndSort();
        } catch (_) {
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
                        NO SE ENCONTRARON SUJETOS PARA ESTE FILTRO TACTICO.
                    </td>
                </tr>`;
            indicator.textContent = 'PAG 0 / 0';
            return;
        }

        const maxPage = Math.max(1, Math.ceil(this.filteredData.length / this.pageSize));
        if (this.currentPage > maxPage) this.currentPage = maxPage;
        indicator.textContent = `PAG ${this.currentPage} / ${maxPage}`;

        const start = (this.currentPage - 1) * this.pageSize;
        const paginatedData = this.filteredData.slice(start, start + this.pageSize);

        const rowsHtml = [];

        for (const infractor of paginatedData) {
            const id = DOMPurify.sanitize(String(infractor.id || ''));
            const username = DOMPurify.sanitize(String(infractor.username || 'Desconocido'));
            const servidor = DOMPurify.sanitize(String(infractor.servidor || 'N/A'));
            const resumenEvidencia = DOMPurify.sanitize(limpiarResumenEvidencia(infractor.evidencia));
            const fechaFormat = formatearFechaForense(infractor.fecha);
            const nivelReincidencia = Number.parseInt(infractor.reincidencia, 10) || 0;
            const sf = analizarBurnerSnowflake(infractor.id);
            const isExpanded = this.expandedRowIds.has(id);

            const badgeClass = (nivelReincidencia >= 3 || infractor.intelExterna?.amenazaConfirmada)
                ? 'badge-red'
                : (nivelReincidencia >= 1 ? 'badge-amber' : 'badge-green');
            const avatarUrl = DOMPurify.sanitize(obtenerAvatarRealOFallback(id, infractor.avatar));

            const vectoresPills = (infractor.vectores || []).map(v => {
                const st = COLORES_VECTOR[v] || COLORES_VECTOR.OSINT;
                return `<span class="vector-pill" style="background:${st.bg};color:${st.col};border:1px solid ${st.border};">${DOMPurify.sanitize(v)}</span>`;
            }).join('');

            const burnerPill = sf?.esBurner
                ? `<span class="vector-pill" style="background:rgba(255,0,60,0.2);color:#ff003c;border:1px solid #ff003c;">BURNER ${sf.dias}d</span>`
                : '';

            const geoTag = infractor.perfilOsint?.pais
                ? `<span style="color:#38bdf8;font-size:0.69rem;margin-left:6px;">&#127758; ${DOMPurify.sanitize(infractor.perfilOsint.pais)}</span>`
                : '';

            rowsHtml.push(`
                <tr id="row-${id}">
                    <td style="font-family: var(--font-mono);">
                        <div style="display: flex; align-items: center; gap: 0.7rem;">
                            <img src="${avatarUrl}" alt="Av" style="width: 38px; height: 38px; border-radius: 50%; object-fit: cover; border: 1.5px solid var(--accent-rz); flex-shrink: 0;">
                            <div style="min-width: 0;">
                                <div style="color: var(--text-main); font-weight: 700; font-size: 0.9rem;">${infractor.enWatchlist ? '&#9733; ' : ''}${username}${geoTag}</div>
                                <div class="selectable" style="color: var(--text-muted); font-size: 0.72rem;">UID: ${id}</div>
                                <div style="margin-top: 2px;">${vectoresPills}${burnerPill}</div>
                            </div>
                        </div>
                    </td>
                    <td>
                        <span class="badge ${badgeClass}">NIVEL ${nivelReincidencia}</span>
                        <div style="color: var(--text-muted); font-family: var(--font-mono); font-size: 0.68rem; margin-top: 4px;">&#11042; ${servidor}</div>
                    </td>
                    <td>
                        <div class="discord-mock" style="margin-top: 0;">
                            <div class="discord-mock-content">
                                <div class="discord-mock-header">
                                    <span class="user role-color btn-view-profile" data-id="${id}" style="cursor: pointer;">${username}</span>
                                    <span class="date">${fechaFormat}</span>
                                </div>
                                <div class="discord-mock-body" style="font-size: 0.8rem;">${resumenEvidencia}</div>
                            </div>
                        </div>
                    </td>
                    <td style="text-align: right; white-space: nowrap;">
                        <button class="btn-action btn-toggle-accordion" data-id="${id}" type="button" style="margin-right: 0.3rem;">${isExpanded ? 'PLEGAR &#9652;' : 'HISTORIAL &#9662;'}</button>
                        <button class="btn-action btn-view-profile" data-id="${id}" type="button" style="margin-right: 0.3rem;">DOSSIER</button>
                        <button class="btn-action btn-purge" data-id="${id}" type="button">PURGAR</button>
                    </td>
                </tr>
            `);

            // Fila Desplegable Inline (Acordeon con los ultimos 5 eventos y servidores comunes)
            if (isExpanded) {
                const ultimosEventos = Array.isArray(infractor.historial)
                    ? infractor.historial.slice(-5).reverse()
                    : [];

                const eventosHtml = ultimosEventos.map(ev => `
                    <div style="padding: 6px 10px; border-left: 2px solid var(--accent-rz); background: rgba(255,255,255,0.02); margin-bottom: 5px; font-family: var(--font-mono); font-size: 0.72rem;">
                        <div style="display:flex;justify-content:space-between;color:var(--accent-amber);">
                            <span><b>[${DOMPurify.sanitize(String(ev.casoId || 'REG'))}]</b> ${DOMPurify.sanitize(String(ev.accion || ''))}</span>
                            <span>&#11042; ${DOMPurify.sanitize(String(ev.servidor || 'N/A'))} &bull; ${formatearFechaForense(ev.fecha)}</span>
                        </div>
                        <div style="color:var(--text-secondary);margin-top:3px;">${DOMPurify.sanitize(limpiarResumenEvidencia(ev.mensajeOriginal))}</div>
                    </div>
                `).join('');

                const serversStr = Array.isArray(infractor.servidoresLista) && infractor.servidoresLista.length > 0
                    ? infractor.servidoresLista.map(s => DOMPurify.sanitize(s)).join(' &bull; ')
                    : servidor;

                rowsHtml.push(`
                    <tr class="inline-dossier-row">
                        <td colspan="4">
                            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.6rem;font-family:var(--font-mono);font-size:0.74rem;">
                                <div><strong style="color:#00f0ff;">SERVIDORES CONOCIDOS DEL OBJETIVO:</strong> <span style="color:var(--text-main);">${serversStr}</span></div>
                                <button class="btn-action btn-locate-map" data-id="${id}" type="button" style="border-color:#00f0ff;color:#00f0ff;">&#9678; LOCALIZAR EN MAPA ESTELAR</button>
                            </div>
                            ${eventosHtml || '<div style="color:var(--text-muted);font-family:var(--font-mono);font-size:0.73rem;">Sin desglose adicional de eventos.</div>'}
                        </td>
                    </tr>
                `);
            }
        }

        tbody.innerHTML = rowsHtml.join('');
        this.bindDynamicEvents();
    },

    bindDynamicEvents() {
        document.querySelectorAll('#blacklist-tbody .btn-toggle-accordion').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const targetId = e.currentTarget.getAttribute('data-id');
                if (!targetId) return;
                if (this.expandedRowIds.has(targetId)) {
                    this.expandedRowIds.delete(targetId);
                } else {
                    this.expandedRowIds.add(targetId);
                }
                this.renderTable();
            });
        });

        document.querySelectorAll('#blacklist-tbody .btn-locate-map').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const targetId = e.currentTarget.getAttribute('data-id');
                if (targetId && window.C4ISR_Views.red) {
                    window.C4ISR_Views.red.searchTerm = String(targetId);
                    window.AppController.navigate('red');
                }
            });
        });

        document.querySelectorAll('#blacklist-tbody .btn-purge').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const targetId = e.currentTarget.getAttribute('data-id');
                if (!targetId) return;
                if (!window.confirm(`Confirmar eliminacion permanente del expediente UID: ${targetId}?`)) return;

                const botonActual = e.currentTarget;
                botonActual.textContent = '...';
                botonActual.disabled = true;

                try {
                    await window.C4ISR_API.eliminarInfractor(targetId);
                    this.fullData = this.fullData.filter(i => String(i.id) !== targetId);
                    this.filteredData = this.filteredData.filter(i => String(i.id) !== targetId);
                    this.renderTable();
                } catch (_) {
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
        this.expandedRowIds.clear();
    }
};
