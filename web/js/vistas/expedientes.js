'use strict';

/* ==========================================================================
   VISTA: ESTACION CENTRAL DE EXPEDIENTES C4ISR v4.0 (3 COLUMNAS // MUGSHOT)
   Archivo: js/vistas/expedientes.js
   ========================================================================== */

window.C4ISR_Views = window.C4ISR_Views || {};

const DISCORD_EPOCH_BI = 1420070400000n;

function formatearFechaCorta(dateString) {
    if (!dateString) return 'Sin fecha';
    const d = new Date(dateString);
    if (Number.isNaN(d.getTime())) return String(dateString);
    return `${d.toLocaleDateString('es-ES')} ${d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`;
}

function decodificarSnowflake(userId) {
    try {
        const clean = String(userId || '').replace(/\D/g, '');
        if (clean.length < 17) return null;
        const ms = Number((BigInt(clean) >> 22n) + DISCORD_EPOCH_BI);
        const dias = Math.floor((Date.now() - ms) / 86400000);
        const fecha = new Date(ms).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
        return { fecha, dias, esBurner: dias <= 21 };
    } catch (_) {
        return null;
    }
}

function obtenerAvatarFallback(userId, customAvatar) {
    if (customAvatar && typeof customAvatar === 'string' && customAvatar.startsWith('http')) {
        return customAvatar;
    }
    try {
        const index = Number(BigInt(String(userId).replace(/\D/g, '') || '0') % 5n);
        return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
    } catch (_) {
        return 'https://cdn.discordapp.com/embed/avatars/0.png';
    }
}

window.C4ISR_Views.expedientes = {
    saveTimeout: null,
    currentTargetId: null,
    globalData: null,
    filteredRoster: [],
    rosterFilterMode: 'ALL', // 'ALL' | 'THREAT' | 'VIP' | 'BURNER' | 'OSINT'
    searchTerm: '',
    boundKeyNav: null,

    async render(container) {
        container.innerHTML = `
            <style>
                .exp-workstation {
                    display: grid;
                    grid-template-columns: 270px 1fr 340px;
                    gap: 0.9rem;
                    height: calc(100vh - 165px);
                    min-height: 520px;
                }
                .exp-col {
                    background: rgba(17, 15, 23, 0.88);
                    border: 1px solid rgba(255, 255, 255, 0.07);
                    border-radius: var(--radius-md);
                    display: flex;
                    flex-direction: column;
                    overflow: hidden;
                }
                .roster-pills {
                    display: flex;
                    gap: 4px;
                    padding: 6px 8px;
                    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
                    flex-wrap: wrap;
                    background: rgba(9, 8, 12, 0.5);
                }
                .roster-pill {
                    background: rgba(255, 255, 255, 0.03);
                    border: 1px solid rgba(255, 255, 255, 0.1);
                    color: var(--text-muted);
                    font-family: var(--font-mono);
                    font-size: 0.64rem;
                    padding: 3px 6px;
                    border-radius: 4px;
                    cursor: pointer;
                    flex: 1;
                    text-align: center;
                }
                .roster-pill.active, .roster-pill:hover {
                    background: rgba(0, 240, 255, 0.14);
                    border-color: #00f0ff;
                    color: #ffffff;
                }
                .roster-item {
                    display: flex;
                    align-items: center;
                    gap: 9px;
                    padding: 8px 10px;
                    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
                    cursor: pointer;
                    transition: background 0.12s ease;
                }
                .roster-item:hover {
                    background: rgba(255, 255, 255, 0.03);
                }
                .roster-item.active {
                    background: rgba(255, 42, 109, 0.14);
                    border-left: 3px solid var(--accent-rz);
                }
                .mugshot-banner {
                    padding: 1rem 1.15rem;
                    background: linear-gradient(135deg, rgba(255, 42, 109, 0.10) 0%, rgba(9, 8, 12, 0.92) 100%);
                    border-bottom: 1px solid rgba(255, 42, 109, 0.25);
                    display: flex;
                    justify-content: space-between;
                    align-items: flex-start;
                    gap: 1rem;
                    flex-wrap: wrap;
                }
                .osint-chip-grid {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 6px;
                    margin-top: 8px;
                }
                .osint-chip {
                    background: rgba(0, 240, 255, 0.08);
                    border: 1px solid rgba(0, 240, 255, 0.28);
                    color: #e2e8f0;
                    font-family: var(--font-mono);
                    font-size: 0.69rem;
                    padding: 3px 8px;
                    border-radius: 4px;
                }
                .osint-structured-card {
                    background: rgba(11, 13, 22, 0.92);
                    border: 1px solid rgba(0, 240, 255, 0.28);
                    border-left: 3px solid #00f0ff;
                    border-radius: 6px;
                    padding: 0.85rem 1rem;
                    margin-top: 4px;
                }
                @media screen and (max-width: 1120px) {
                    .exp-workstation {
                        grid-template-columns: 240px 1fr;
                        height: auto;
                    }
                    .exp-col-right {
                        grid-column: 1 / -1;
                        min-height: 420px;
                    }
                }
                @media screen and (max-width: 780px) {
                    .exp-workstation {
                        grid-template-columns: 1fr;
                    }
                }
            </style>

            <div class="panel-header" style="margin-bottom: 0.75rem; padding-bottom: 0.55rem;">
                <div style="display: flex; align-items: center; gap: 0.6rem;">
                    <span class="panel-title" style="font-size: 1.02rem; color: var(--accent-rz);">ESTACION FORENSE DE EXPEDIENTES // DOSSIERS E INTELIGENCIA</span>
                    <span id="exp-total-badge" class="badge badge-green">0 ARCHIVOS</span>
                </div>
                <div style="display: flex; gap: 0.45rem; flex-wrap: wrap;">
                    <button id="btn-toggle-arsenal" class="btn-action" type="button">+ REGLA / COMANDO EN VIVO</button>
                    <button id="btn-add-target" class="btn-action" type="button">+ INYECTAR UID</button>
                    <button id="btn-import-targets" class="btn-export" type="button">IMPORTAR JSON</button>
                    <input type="file" id="file-import-input" accept=".json,application/json" class="hidden">
                </div>
            </div>

            <!-- Barra Desplegable Arsenal en Vivo -->
            <div id="arsenal-live-bar" class="toolbar-tactical hidden" style="border-color: #00f0ff; margin-bottom: 0.75rem; padding: 0.6rem 0.9rem;">
                <div style="display: flex; align-items: center; gap: 0.5rem; flex-grow: 1; flex-wrap: wrap;">
                    <span style="font-family: var(--font-mono); font-size: 0.74rem; color: #00f0ff;">[ ARSENAL EN VIVO ]</span>
                    <select id="select-arsenal-type" style="background: var(--bg-input); color: #00f0ff; border: 1px solid rgba(0,240,255,0.35); border-radius: 4px; padding: 0.4rem; font-family: var(--font-mono); font-size: 0.73rem;">
                        <option value="COMANDO_SQUAD">COMANDO SQUAD (Ej: .cbot)</option>
                        <option value="PALABRA_RAID">PALABRA CLAVE RAID</option>
                    </select>
                    <input type="text" id="input-arsenal-val" class="search-input" style="width: 190px; padding: 0.4rem 0.6rem;" placeholder="Ej: .cbot">
                    <input type="text" id="input-arsenal-desc" class="search-input" style="flex: 1; min-width: 160px; padding: 0.4rem 0.6rem;" placeholder="Descripcion...">
                    <button id="btn-save-arsenal" class="btn-export" type="button">ACTIVAR</button>
                </div>
            </div>

            <!-- Barra Desplegable Inyeccion Manual UID -->
            <div id="manual-inject-bar" class="toolbar-tactical hidden" style="border-color: var(--accent-rz); margin-bottom: 0.75rem; padding: 0.6rem 0.9rem;">
                <div style="display: flex; align-items: center; gap: 0.6rem; flex-grow: 1; flex-wrap: wrap;">
                    <span style="font-family: var(--font-mono); font-size: 0.75rem; color: var(--accent-rz);">[ INYECTAR OBJETIVO ]</span>
                    <input type="text" id="input-manual-uid" class="search-input" style="padding: 0.4rem 0.7rem;" placeholder="Pegar Discord UID (17 a 20 digitos)..." maxlength="20">
                    <button id="btn-confirm-uid" class="btn-action" type="button">REGISTRAR Y ABRIR</button>
                    <button id="btn-cancel-uid" class="btn-action btn-purge" type="button">CANCELAR</button>
                </div>
            </div>

            <div class="exp-workstation">
                <!-- COLUMNA 1: DIRECTORIO FIJO DE SUJETOS -->
                <aside class="exp-col">
                    <div style="padding: 8px; border-bottom: 1px solid rgba(255,255,255,0.06);">
                        <input type="text" id="osint-search" class="search-input" style="width: 100%; padding: 0.42rem 0.65rem; font-size: 0.74rem;" placeholder="Filtrar por nombre, UID o pais..." autocomplete="off">
                    </div>
                    <div class="roster-pills">
                        <button class="roster-pill active" data-filter="ALL" type="button">TODOS</button>
                        <button class="roster-pill" data-filter="THREAT" type="button">GRAVES</button>
                        <button class="roster-pill" data-filter="VIP" type="button">VIP</button>
                        <button class="roster-pill" data-filter="BURNER" type="button">BURNER</button>
                        <button class="roster-pill" data-filter="OSINT" type="button">OSINT</button>
                    </div>
                    <div id="osint-roster-list" style="flex: 1; overflow-y: auto;"></div>
                </aside>

                <!-- COLUMNA 2: FICHA POLICIAL (MUGSHOT) + LINEA DE TIEMPO INTELIGENTE -->
                <section class="exp-col">
                    <div id="osint-mugshot-header" class="mugshot-banner">
                        <div style="color: var(--text-muted); font-family: var(--font-mono); font-size: 0.8rem;">
                            Selecciona un sujeto en la columna izquierda...
                        </div>
                    </div>
                    <div class="osint-content" id="osint-raw-logs" style="padding: 0.9rem 1.1rem;"></div>
                </section>

                <!-- COLUMNA 3: ESCANER APIS EXTERNAS (XN / VPS / LC) + DOSSIER DEL ANALISTA -->
                <aside class="exp-col exp-col-right">
                    <div style="padding: 0.65rem 0.9rem; border-bottom: 1px solid rgba(255,255,255,0.07); display: flex; justify-content: space-between; align-items: center; background: rgba(9, 8, 12, 0.6);">
                        <span style="font-family: var(--font-mono); font-size: 0.73rem; font-weight: 700; color: #00f0ff;">REDES EXTERNAS (XN / VPS / LC)</span>
                        <button id="btn-scan-ext-apis" class="btn-action" type="button" style="font-size: 0.66rem; padding: 3px 8px; border-color: #00f0ff; color: #00f0ff;">ESCANEAR AHORA</button>
                    </div>
                    <div id="external-intel-box" style="padding: 0.75rem 0.9rem; max-height: 225px; overflow-y: auto; border-bottom: 1px solid rgba(255,255,255,0.07); font-family: var(--font-mono); font-size: 0.72rem;">
                        <div style="color: var(--text-muted);">Pulsa "ESCANEAR AHORA" para interrogar XN Protect, VPS 5604 y LC Guard en tiempo real.</div>
                    </div>

                    <div style="padding: 0.6rem 0.9rem; border-bottom: 1px solid rgba(255,255,255,0.06); display: flex; justify-content: space-between; align-items: center;">
                        <span style="font-family: var(--font-mono); font-size: 0.73rem; font-weight: 700; color: var(--text-main);">NOTAS DEL ANALISTA</span>
                        <span id="osint-save-status" class="badge badge-green">SINCRONIZADO</span>
                    </div>
                    <div style="flex: 1; padding: 0.65rem; display: flex;">
                        <textarea id="osint-notes-editor" class="editor-textarea" style="min-height: 150px; font-size: 0.79rem;" placeholder="Conclusiones forenses, cuentas espejo vinculadas, servidores donde opera o evidencia adicional..."></textarea>
                    </div>
                </aside>
            </div>
        `;

        try {
            this.globalData = await window.C4ISR_API.getDatosGlobales();
            this.bindEvents();
            this.applyRosterFilters();

            if (window.C4ISR_TARGET_OVERRIDE) {
                const targetId = String(window.C4ISR_TARGET_OVERRIDE);
                window.C4ISR_TARGET_OVERRIDE = null;
                this.loadTargetWorkspace(targetId);
            } else if (this.filteredRoster.length > 0) {
                this.loadTargetWorkspace(this.filteredRoster[0].id);
            }
        } catch (error) {
            console.error('[Expedientes] Error cargando vista:', error);
            container.innerHTML = `
                <div class="login-error" style="display: block;">
                    [!] ERROR CRITICO AL CONECTAR CON EL ARCHIVO DE EXPEDIENTES.
                </div>`;
        }
    },

    obtenerListaUnificada() {
        if (!this.globalData) return [];
        const baseBlacklist = Array.isArray(this.globalData.blacklist) ? this.globalData.blacklist : [];
        return [...baseBlacklist].sort((a, b) => new Date(b.fecha || 0) - new Date(a.fecha || 0));
    },

    applyRosterFilters() {
        const todos = this.obtenerListaUnificada();
        const badgeTotal = document.getElementById('exp-total-badge');
        if (badgeTotal) badgeTotal.textContent = `${todos.length} SUJETOS`;

        this.filteredRoster = todos.filter(u => {
            if (this.rosterFilterMode === 'THREAT') {
                const hasGrave = (u.reincidencia || 0) > 0 || Boolean(u.intelExterna?.amenazaConfirmada);
                if (!hasGrave) return false;
            } else if (this.rosterFilterMode === 'VIP') {
                if (!u.enWatchlist) return false;
            } else if (this.rosterFilterMode === 'BURNER') {
                const sf = decodificarSnowflake(u.id);
                if (!sf || !sf.esBurner) return false;
            } else if (this.rosterFilterMode === 'OSINT') {
                if (!u.perfilOsint && !(u.vectores || []).includes('OSINT')) return false;
            }

            if (this.searchTerm) {
                const nameMatch = String(u.username || '').toLowerCase().includes(this.searchTerm);
                const idMatch = String(u.id || '').includes(this.searchTerm);
                const aliasMatch = Array.isArray(u.historialAliases) &&
                    u.historialAliases.some(a => String(a).toLowerCase().includes(this.searchTerm));
                const paisMatch = String(u.perfilOsint?.pais || '').toLowerCase().includes(this.searchTerm) ||
                    String(u.perfilOsint?.region || '').toLowerCase().includes(this.searchTerm);
                return nameMatch || idMatch || aliasMatch || paisMatch;
            }
            return true;
        });

        this.renderRosterList();
    },

    renderRosterList() {
        const listEl = document.getElementById('osint-roster-list');
        if (!listEl) return;

        if (this.filteredRoster.length === 0) {
            listEl.innerHTML = `
                <div style="padding: 1.25rem; color: var(--text-muted); font-family: var(--font-mono); font-size: 0.74rem; text-align: center;">
                    Sin sujetos para este filtro.
                </div>`;
            return;
        }

        listEl.innerHTML = this.filteredRoster.slice(0, 120).map(u => {
            const id = DOMPurify.sanitize(String(u.id || ''));
            const username = DOMPurify.sanitize(String(u.username || 'Desconocido'));
            const isActive = String(this.currentTargetId) === String(u.id);
            const avatarUrl = DOMPurify.sanitize(obtenerAvatarFallback(u.id, u.avatar));
            const sf = decodificarSnowflake(u.id);
            const isHostile = (u.reincidencia || 0) > 0 || Boolean(u.intelExterna?.amenazaConfirmada);
            const dotCol = u.enWatchlist ? '#fcee0a' : (isHostile ? '#ff0055' : '#10b981');
            const paisTag = u.perfilOsint?.pais ? `<span style="color:#38bdf8;">&bull; ${DOMPurify.sanitize(u.perfilOsint.pais)}</span>` : '';

            return `
                <div class="roster-item ${isActive ? 'active' : ''}" data-id="${id}">
                    <img src="${avatarUrl}" alt="Av" style="width: 34px; height: 34px; border-radius: 50%; object-fit: cover; border: 1.5px solid ${dotCol}; flex-shrink: 0;">
                    <div style="min-width: 0; flex: 1;">
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <span style="font-weight: 600; color: var(--text-main); font-size: 0.81rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${u.enWatchlist ? '&#9733; ' : ''}${username}</span>
                            ${sf?.esBurner ? '<span style="color:#ff003c;font-family:var(--font-mono);font-size:0.6rem;font-weight:700;">BURNER</span>' : ''}
                        </div>
                        <div style="font-family: var(--font-mono); font-size: 0.67rem; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                            ${id.slice(-8)} ${paisTag}
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        listEl.querySelectorAll('.roster-item').forEach(item => {
            item.addEventListener('click', () => {
                const targetId = item.getAttribute('data-id');
                this.loadTargetWorkspace(targetId);
            });
        });
    },

    bindEvents() {
        const searchInput = document.getElementById('osint-search');
        const editor = document.getElementById('osint-notes-editor');
        const btnAdd = document.getElementById('btn-add-target');
        const manualBar = document.getElementById('manual-inject-bar');
        const inputManualUid = document.getElementById('input-manual-uid');
        const btnConfirmUid = document.getElementById('btn-confirm-uid');
        const btnCancelUid = document.getElementById('btn-cancel-uid');
        const btnImport = document.getElementById('btn-import-targets');
        const fileInput = document.getElementById('file-import-input');
        const btnArsenal = document.getElementById('btn-toggle-arsenal');
        const arsenalBar = document.getElementById('arsenal-live-bar');
        const btnSaveArsenal = document.getElementById('btn-save-arsenal');
        const btnScanApis = document.getElementById('btn-scan-ext-apis');

        document.querySelectorAll('.roster-pill').forEach(pill => {
            pill.addEventListener('click', () => {
                document.querySelectorAll('.roster-pill').forEach(p => p.classList.remove('active'));
                pill.classList.add('active');
                this.rosterFilterMode = pill.getAttribute('data-filter') || 'ALL';
                this.applyRosterFilters();
            });
        });

        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                this.searchTerm = e.target.value.toLowerCase().trim();
                this.applyRosterFilters();
            });
        }

        if (btnScanApis) {
            btnScanApis.addEventListener('click', () => {
                if (this.currentTargetId) this.ejecutarEscaneoExterno(this.currentTargetId);
            });
        }

        if (btnArsenal && arsenalBar) {
            btnArsenal.addEventListener('click', () => arsenalBar.classList.toggle('hidden'));
        }

        if (btnSaveArsenal) {
            btnSaveArsenal.addEventListener('click', async () => {
                const tipo = document.getElementById('select-arsenal-type')?.value;
                const valor = document.getElementById('input-arsenal-val')?.value.trim();
                const desc = document.getElementById('input-arsenal-desc')?.value.trim();
                if (!valor) return;
                btnSaveArsenal.disabled = true;
                btnSaveArsenal.textContent = '...';
                try {
                    await window.C4ISR_API.agregarReglaArsenal(tipo, valor, desc);
                    document.getElementById('input-arsenal-val').value = '';
                    document.getElementById('input-arsenal-desc').value = '';
                    arsenalBar.classList.add('hidden');
                } catch (err) {
                    alert(`[!] Error: ${err.message}`);
                } finally {
                    btnSaveArsenal.disabled = false;
                    btnSaveArsenal.textContent = 'ACTIVAR';
                }
            });
        }

        if (editor) {
            editor.addEventListener('input', () => {
                if (!this.currentTargetId) return;
                this.updateSaveStatus('saving');
                if (this.saveTimeout) clearTimeout(this.saveTimeout);
                this.saveTimeout = setTimeout(() => {
                    this.saveNotes(this.currentTargetId, editor.value);
                }, 800);
            });
        }

        if (btnAdd && manualBar) {
            btnAdd.addEventListener('click', () => {
                manualBar.classList.toggle('hidden');
                if (!manualBar.classList.contains('hidden') && inputManualUid) inputManualUid.focus();
            });
        }

        if (btnCancelUid && manualBar) {
            btnCancelUid.addEventListener('click', () => {
                manualBar.classList.add('hidden');
                if (inputManualUid) inputManualUid.value = '';
            });
        }

        if (btnConfirmUid && inputManualUid) {
            btnConfirmUid.addEventListener('click', async () => {
                const uid = inputManualUid.value.trim();
                if (!/^\d{17,20}$/.test(uid)) {
                    alert('[!] UID invalido (17 a 20 digitos).');
                    return;
                }
                btnConfirmUid.disabled = true;
                try {
                    await window.C4ISR_API.agregarObjetivoManual(uid);
                    window.C4ISR_TARGET_OVERRIDE = uid;
                    await window.AppController.navigate('expedientes');
                } catch (_) {
                    btnConfirmUid.disabled = false;
                }
            });
        }

        if (btnImport && fileInput) {
            btnImport.addEventListener('click', () => fileInput.click());
            fileInput.addEventListener('change', async (e) => {
                const archivo = e.target.files?.[0];
                if (!archivo) return;
                try {
                    const texto = await archivo.text();
                    const jsonParsed = JSON.parse(texto);
                    const matriz = Array.isArray(jsonParsed) ? jsonParsed : (jsonParsed.blacklist || jsonParsed.datos || []);
                    if (Array.isArray(matriz) && matriz.length > 0) {
                        await window.C4ISR_API.importarMatriz(matriz);
                        await window.AppController.navigate('expedientes');
                    }
                } catch (error) {
                    alert(`[!] Error importando JSON: ${error.message}`);
                } finally {
                    fileInput.value = '';
                }
            });
        }
    },

    renderExistingIntelBox(user) {
        const box = document.getElementById('external-intel-box');
        if (!box) return;
        const ext = user.intelExterna;
        if (!ext) {
            box.innerHTML = `<div style="color: var(--text-muted);">Sin escaneo reciente guardado. Pulsa "ESCANEAR AHORA" para interrogar XN Protect, VPS 5604 y LC Guard.</div>`;
            return;
        }

        let html = `<div>`;
        if (ext.xnBaneado) {
            html += `<div style="color:#ff003c;margin-bottom:5px;">&#9679; <strong>XN PROTECT:</strong> BANEADO &mdash; ${DOMPurify.sanitize(ext.xnRazon || '')} ${ext.xnPrueba ? `<a href="${DOMPurify.sanitize(ext.xnPrueba)}" target="_blank" rel="noopener noreferrer" style="color:#00f0ff;">[PRUEBA]</a>` : ''}</div>`;
        } else {
            html += `<div style="color:#10b981;margin-bottom:4px;">&#9679; <strong>XN PROTECT:</strong> Limpio</div>`;
        }

        if (ext.vpsDetectado && Array.isArray(ext.vpsRegistros)) {
            html += `<div style="color:#ff003c;margin-bottom:4px;">&#9679; <strong>VPS 5604 SQUADS (${ext.vpsRegistros.length}):</strong></div>`;
            for (const r of ext.vpsRegistros) {
                html += `<div style="padding:4px 7px;border-left:2px solid #ff003c;background:rgba(255,0,60,0.08);margin-bottom:4px;font-size:0.69rem;">`;
                html += `<b>${DOMPurify.sanitize(r.servicio || 'VPS')}</b>: ${DOMPurify.sanitize(r.razon || '')}`;
                html += `</div>`;
            }
        } else {
            html += `<div style="color:#10b981;margin-bottom:4px;">&#9679; <strong>VPS 5604:</strong> Sin registros</div>`;
        }

        if (ext.lcSancionado) {
            html += `<div style="color:#ff003c;">&#9679; <strong>LC GUARD:</strong> SANCIONADO ACTIVO</div>`;
        } else {
            html += `<div style="color:#10b981;">&#9679; <strong>LC GUARD:</strong> Limpio</div>`;
        }
        html += `</div>`;
        box.innerHTML = html;
    },

    async ejecutarEscaneoExterno(userId) {
        const box = document.getElementById('external-intel-box');
        if (!box) return;
        box.innerHTML = `<div style="color:#00f0ff;">[ INTERROGANDO APIS ] Consultando XN Protect, VPS 5604 y LC Guard...</div>`;

        try {
            const intel = await window.C4ISR_API.consultarIntelExterna(userId);
            const xn = intel.xnProtect || {};
            const sq = intel.vpsSquads || {};
            const kw = intel.vpsKeywords || {};
            const lc = intel.lcGuard || {};

            let html = `<div>`;
            if (xn.baneado) {
                html += `<div style="color:#ff003c;margin-bottom:6px;">&#9679; <strong>XN PROTECT:</strong> POSITIVO &mdash; ${DOMPurify.sanitize(xn.razon)}`;
                if (xn.pruebaUrl) {
                    const safeProof = DOMPurify.sanitize(xn.pruebaUrl);
                    html += `<div style="margin-top:4px;"><a href="${safeProof}" target="_blank" rel="noopener noreferrer" style="color:#00f0ff;text-decoration:underline;">[Ver Captura de Prueba]</a></div>`;
                }
                html += `</div>`;
            } else {
                html += `<div style="color:#10b981;margin-bottom:4px;">&#9679; <strong>XN PROTECT:</strong> Limpio</div>`;
            }

            if (sq.detectado && Array.isArray(sq.registros)) {
                html += `<div style="color:#ff003c;margin-bottom:4px;">&#9679; <strong>VPS 5604 SQUADS (${sq.registros.length}):</strong></div>`;
                for (const r of sq.registros) {
                    html += `<div style="padding:4px 7px;border-left:2px solid #ff003c;background:rgba(255,0,60,0.08);margin-bottom:4px;font-size:0.69rem;">`;
                    html += `<b>${DOMPurify.sanitize(r.servicio)}</b> (${DOMPurify.sanitize(r.fecha)}): ${DOMPurify.sanitize(r.razon)}`;
                    html += `</div>`;
                }
            } else {
                html += `<div style="color:#10b981;margin-bottom:4px;">&#9679; <strong>VPS 5604 SQUADS:</strong> Limpio</div>`;
            }

            if (kw.detectado) {
                html += `<div style="color:#fbbf24;margin-bottom:4px;">&#9679; <strong>VPS KEYWORDS:</strong> ${kw.registros.length} registro(s)</div>`;
            }

            if (lc.sancionado) {
                html += `<div style="color:#ff003c;margin-bottom:6px;">&#9679; <strong>LC GUARD:</strong> SANCIONADO ACTIVO</div>`;
            } else {
                html += `<div style="color:#10b981;margin-bottom:6px;">&#9679; <strong>LC GUARD:</strong> Limpio</div>`;
            }

            html += `<button id="btn-inject-intel-notes" class="btn-action" type="button" style="width:100%;font-size:0.68rem;padding:4px;">VOLCAR RESULTADO A NOTAS</button>`;
            html += `</div>`;
            box.innerHTML = html;

            const btnVolcar = document.getElementById('btn-inject-intel-notes');
            const editor = document.getElementById('osint-notes-editor');
            if (btnVolcar && editor) {
                btnVolcar.addEventListener('click', () => {
                    const bloqueTexto = `\n--- [INTEL EXTERNA ${new Date().toLocaleDateString('es-ES')}] ---\n` +
                        `XN Protect: ${xn.baneado ? `BANEADO (${xn.razon}) ${xn.pruebaUrl || ''}` : 'Limpio'}\n` +
                        `VPS 5604 Squads: ${sq.detectado ? sq.registros.map(r => `[${r.servicio}] ${r.razon}`).join(' | ') : 'Limpio'}\n` +
                        `LC Guard: ${lc.sancionado ? 'SANCIONADO' : 'Limpio'}\n`;
                    editor.value = (editor.value + bloqueTexto).trim();
                    this.saveNotes(this.currentTargetId, editor.value);
                    btnVolcar.textContent = 'VOLCADO CON EXITO';
                });
            }
        } catch (err) {
            box.innerHTML = `<div style="color:var(--accent-red);">[!] Error consultando APIs: ${DOMPurify.sanitize(err.message)}</div>`;
        }
    },

    exportarDossierClasificadoHTML(user) {
        if (!user) return;
        const sf = decodificarSnowflake(user.id);
        const aliases = Array.isArray(user.historialAliases) && user.historialAliases.length > 0
            ? user.historialAliases.join(', ')
            : user.username;
        const historial = Array.isArray(user.historial) ? user.historial : [];

        function escaparSimple(str) {
            return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        }

        const filasEventos = historial.map(h => `
            <div style="border-left:3px solid #ff2a6d;padding:10px 14px;margin-bottom:12px;background:#171420;border-radius:4px;">
                <div style="color:#ff2a6d;font-weight:bold;font-size:12px;">[${escaparSimple(h.casoId || 'CASO')}] ${escaparSimple(h.accion || 'Evento')} &bull; Servidor: ${escaparSimple(h.servidor || 'N/A')} &bull; ${escaparSimple(h.fecha || '')}</div>
                <div style="color:#e2e8f0;font-family:monospace;font-size:13px;margin-top:6px;">${h.mensajeOriginal || ''}</div>
            </div>
        `).join('');

        const docHTML = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>DOSSIER CLASIFICADO C4ISR // UID ${escaparSimple(user.id)}</title>
<style>
    body { background:#09080c; color:#f1f5f9; font-family:'JetBrains Mono',Consolas,monospace; padding:30px; max-width:960px; margin:0 auto; }
    .header { border:1px solid #ff2a6d; border-left:6px solid #ff2a6d; padding:20px; background:#110f17; margin-bottom:24px; }
    .title { color:#ff2a6d; font-size:22px; font-weight:bold; letter-spacing:2px; }
    .grid { display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-top:14px; font-size:13px; }
    .section { background:#110f17; border:1px solid rgba(255,255,255,0.08); padding:18px; margin-bottom:20px; border-radius:6px; }
    .sec-title { color:#fcee0a; font-weight:bold; margin-bottom:10px; font-size:14px; }
</style>
</head>
<body>
    <div class="header">
        <div class="title">LA BIBLIOTECA // DOSSIER FORENSE CLASIFICADO</div>
        <div class="grid">
            <div><strong>OBJETIVO ACTUAL:</strong> ${escaparSimple(user.username)}</div>
            <div><strong>DISCORD UID:</strong> ${escaparSimple(user.id)}</div>
            <div><strong>CREACION CUENTA:</strong> ${sf ? `${sf.fecha} (${sf.dias} dias)` : 'N/A'}</div>
            <div><strong>HISTORIAL DE ALIAS:</strong> ${escaparSimple(aliases)}</div>
            <div><strong>NIVEL REINCIDENCIA:</strong> ${user.reincidencia || 0} infracciones</div>
            <div><strong>EMITIDO EL:</strong> ${new Date().toISOString()}</div>
        </div>
    </div>
    <div class="section">
        <div class="sec-title">[ NOTAS Y CONCLUSIONES DEL ANALISTA ]</div>
        <pre style="white-space:pre-wrap;color:#34d399;font-family:monospace;">${escaparSimple(user.notas || 'Sin notas manuales registradas.')}</pre>
    </div>
    <div class="section">
        <div class="sec-title">[ HISTORIAL INMUTABLE DE EVIDENCIAS INTERCEPTADAS (${historial.length}) ]</div>
        ${filasEventos || 'Sin eventos registrados.'}
    </div>
</body>
</html>`;

        const blob = new Blob([docHTML], { type: 'text/html;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `DOSSIER_C4ISR_${user.id}.html`;
        document.body.appendChild(a);
        a.click();
        URL.revokeObjectURL(url);
        a.remove();
    },

    loadTargetWorkspace(targetId) {
        this.currentTargetId = String(targetId);
        this.renderRosterList();

        const mugshotHeader = document.getElementById('osint-mugshot-header');
        const rawLogsContainer = document.getElementById('osint-raw-logs');
        const editor = document.getElementById('osint-notes-editor');

        const lista = this.obtenerListaUnificada();
        const user = lista.find(u => String(u.id) === this.currentTargetId);

        if (!user || !mugshotHeader || !rawLogsContainer || !editor) return;

        this.updateSaveStatus('loaded');
        editor.value = user.notas || '';
        this.renderExistingIntelBox(user);

        const usernameSeguro = DOMPurify.sanitize(String(user.username || 'Identidad Desconocida'));
        const idSeguro = DOMPurify.sanitize(String(user.id));
        const avatarUrl = DOMPurify.sanitize(obtenerAvatarFallback(user.id, user.avatar));
        const sf = decodificarSnowflake(user.id);
        const sfBadge = sf
            ? `<span class="badge ${sf.esBurner ? 'badge-red' : 'badge-green'}">CUENTA: ${sf.fecha} (${sf.dias}d) ${sf.esBurner ? '// BURNER' : ''}</span>`
            : '';

        const aliasesList = Array.isArray(user.historialAliases) && user.historialAliases.length > 0
            ? user.historialAliases.map(a => DOMPurify.sanitize(String(a))).join(' &rarr; ')
            : usernameSeguro;

        // Chips de Geolocalizacion e Identidad OSINT
        const osint = user.perfilOsint || {};
        const chips = [];
        if (osint.pais) chips.push(`<span class="osint-chip">&#127758; <b>Pais:</b> ${DOMPurify.sanitize(osint.pais)}</span>`);
        if (osint.region) chips.push(`<span class="osint-chip">&#128205; <b>Region:</b> ${DOMPurify.sanitize(osint.region)}</span>`);
        if (osint.ciudadDeclarada) chips.push(`<span class="osint-chip"><b>Localidad:</b> ${DOMPurify.sanitize(osint.ciudadDeclarada)}</span>`);
        if (osint.edad) chips.push(`<span class="osint-chip"><b>Edad:</b> ${DOMPurify.sanitize(osint.edad)}</span>`);
        if (osint.nombreReal) chips.push(`<span class="osint-chip"><b>Nombre:</b> ${DOMPurify.sanitize(osint.nombreReal)}</span>`);
        if (Array.isArray(osint.redes) && osint.redes.length > 0) {
            chips.push(`<span class="osint-chip"><b>Redes:</b> ${DOMPurify.sanitize(osint.redes.join(', '))}</span>`);
        }

        mugshotHeader.innerHTML = `
            <div style="display: flex; gap: 1rem; align-items: center; min-width: 0; flex: 1;">
                <img src="${avatarUrl}" alt="Avatar" style="width: 64px; height: 64px; border-radius: 50%; object-fit: cover; border: 2px solid var(--accent-rz); box-shadow: var(--glow-rz); flex-shrink: 0;">
                <div style="min-width: 0; flex: 1;">
                    <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
                        <span style="font-size: 1.15rem; font-weight: 700; color: #ffffff; font-family: var(--font-mono);">${usernameSeguro}</span>
                        <span class="badge ${user.reincidencia > 0 ? 'badge-red' : 'badge-amber'}">NIVEL ${user.reincidencia || 0}</span>
                        ${sfBadge}
                    </div>
                    <div class="selectable" style="font-family: var(--font-mono); font-size: 0.73rem; color: var(--text-muted); margin-top: 3px;">
                        UID: ${idSeguro} &nbsp;|&nbsp; ALIAS: <strong style="color: var(--accent-amber);">${aliasesList}</strong>
                    </div>
                    ${chips.length > 0 ? `<div class="osint-chip-grid">${chips.join('')}</div>` : ''}
                </div>
            </div>
            <div style="display: flex; gap: 0.4rem; flex-wrap: wrap;">
                <button id="btn-jump-starmap" class="btn-action" type="button" style="border-color: #00f0ff; color: #00f0ff;">&#9678; VER EN MAPA</button>
                <button id="btn-exp-watchlist" class="btn-action" type="button" style="border-color: #fcee0a; color: ${user.enWatchlist ? '#09080c' : '#fcee0a'}; background: ${user.enWatchlist ? '#fcee0a' : 'transparent'}; font-weight: 700;">&#9733; ${user.enWatchlist ? 'VIP ACTIVO' : 'VIP'}</button>
                <button id="btn-export-dossier-html" class="btn-export" type="button">DOSSIER (.HTML)</button>
            </div>
        `;

        const btnJumpMap = document.getElementById('btn-jump-starmap');
        if (btnJumpMap) {
            btnJumpMap.addEventListener('click', () => {
                window.C4ISR_Views.red.searchTerm = String(user.id);
                window.AppController.navigate('red');
            });
        }

        const btnVip = document.getElementById('btn-exp-watchlist');
        if (btnVip) {
            btnVip.addEventListener('click', async () => {
                try {
                    const res = await window.C4ISR_API.toggleWatchlistUsuario(String(user.id));
                    user.enWatchlist = Boolean(res.enWatchlist);
                    this.loadTargetWorkspace(user.id);
                } catch (_) {}
            });
        }

        const btnDossierHtml = document.getElementById('btn-export-dossier-html');
        if (btnDossierHtml) {
            btnDossierHtml.addEventListener('click', () => this.exportarDossierClasificadoHTML(user));
        }

        const historial = Array.isArray(user.historial) && user.historial.length > 0
            ? [...user.historial].reverse()
            : [{
                fecha: user.fecha,
                accion: 'Registro Inicial',
                casoId: 'N/A',
                servidor: user.servidor || 'N/A',
                mensajeOriginal: user.evidencia || '[ SIN REGISTROS ACTIVOS ]'
            }];

        // Renderizado Diferenciado: Tarjetas OSINT estructuradas sin pre-wrap vs Burbujas de Chat Discord
        rawLogsContainer.innerHTML = historial.map((evento) => {
            const accion = DOMPurify.sanitize(String(evento.accion || 'Evento'));
            const casoId = DOMPurify.sanitize(String(evento.casoId || 'N/A'));
            const servidor = DOMPurify.sanitize(String(evento.servidor || 'Sector Desconocido'));
            const fecha = formatearFechaCorta(evento.fecha);
            const rawMsg = String(evento.mensajeOriginal || '');
            const esWidgetOsint = rawMsg.trim().startsWith('<div');
            const evidenciaSaneada = DOMPurify.sanitize(rawMsg);

            const bodyRender = esWidgetOsint
                ? `<div class="osint-structured-card">${evidenciaSaneada}</div>`
                : `
                    <div class="discord-mock">
                        <img src="${avatarUrl}" alt="Av">
                        <div class="discord-mock-content">
                            <div class="discord-mock-header">
                                <span class="user role-color">${usernameSeguro}</span>
                                <span class="date">${fecha}</span>
                            </div>
                            <div class="discord-mock-body">${evidenciaSaneada}</div>
                        </div>
                    </div>
                `;

            return `
                <div style="margin-bottom: 1rem; padding-bottom: 0.9rem; border-bottom: var(--border-subtle);">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.35rem; flex-wrap: wrap; gap: 0.4rem; font-family: var(--font-mono); font-size: 0.72rem;">
                        <span style="color: ${esWidgetOsint ? '#00f0ff' : 'var(--accent-rz)'}; font-weight: 700;">[${casoId}] ${accion}</span>
                        <span style="color: var(--text-muted);">&#11042; ${servidor} &bull; ${fecha}</span>
                    </div>
                    ${bodyRender}
                </div>
            `;
        }).join('');
    },

    async saveNotes(targetId, notesContent) {
        try {
            await window.C4ISR_API.guardarNota(targetId, notesContent);
            this.updateSaveStatus('saved');
            const lista = this.obtenerListaUnificada();
            const user = lista.find(u => String(u.id) === String(targetId));
            if (user) user.notas = notesContent;
        } catch (_) {
            this.updateSaveStatus('error');
        }
    },

    updateSaveStatus(state) {
        const statusEl = document.getElementById('osint-save-status');
        if (!statusEl) return;

        switch (state) {
            case 'saving':
                statusEl.textContent = 'GUARDANDO...';
                statusEl.className = 'badge badge-amber';
                break;
            case 'saved':
                statusEl.textContent = 'SINCRONIZADO';
                statusEl.className = 'badge badge-green';
                break;
            case 'error':
                statusEl.textContent = 'ERROR RED';
                statusEl.className = 'badge badge-red';
                break;
            case 'loaded':
                statusEl.textContent = 'LISTO';
                statusEl.className = 'badge badge-green';
                break;
        }
    },

    destroy() {
        if (this.saveTimeout) clearTimeout(this.saveTimeout);
        this.currentTargetId = null;
        this.globalData = null;
        this.filteredRoster = [];
    }
};
