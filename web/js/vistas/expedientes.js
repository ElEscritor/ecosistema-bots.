'use strict';

/* ==========================================================================
   VISTA: EXPEDIENTES OSINT (LÍNEA DE TIEMPO COMPLETA E IMPORTACIÓN MATRICIAL)
   Archivo: js/vistas/expedientes.js
   ========================================================================== */

window.C4ISR_Views = window.C4ISR_Views || {};

function formatearFechaCorta(dateString) {
    if (!dateString) return 'Sin fecha';
    const d = new Date(dateString);
    if (Number.isNaN(d.getTime())) return String(dateString);
    return `${d.toLocaleDateString('es-ES')} ${d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`;
}

window.C4ISR_Views.expedientes = {
    saveTimeout: null,
    currentTargetId: null,
    globalData: null,
    outsideClickListener: null,

    async render(container) {
        container.innerHTML = `
            <div class="panel-header" style="margin-bottom: 1.15rem;">
                <span class="panel-title" style="font-size: 1.1rem; color: var(--accent-rz);">ARCHIVO DE EXPEDIENTES E INTELIGENCIA OSINT</span>
                <div style="display: flex; gap: 0.75rem; align-items: center; flex-wrap: wrap;">
                    <button id="btn-add-target" class="btn-action" type="button">+ INYECTAR UID MANUAL</button>
                    <button id="btn-import-targets" class="btn-export" type="button">📄 IMPORTAR MATRIZ JSON</button>
                    <input type="file" id="file-import-input" accept=".json,application/json" class="hidden">
                </div>
            </div>

            <!-- Barra de inserción manual inline (sustituye al prompt() antiguo) -->
            <div id="manual-inject-bar" class="toolbar-tactical hidden" style="border-color: var(--accent-rz);">
                <div style="display: flex; align-items: center; gap: 0.75rem; flex-grow: 1; flex-wrap: wrap;">
                    <span style="font-family: var(--font-mono); font-size: 0.78rem; color: var(--accent-rz);">[ NUEVO OBJETIVO ]</span>
                    <input type="text" id="input-manual-uid" class="search-input" placeholder="Pegar Discord UID (17 a 20 dígitos)..." maxlength="20">
                    <button id="btn-confirm-uid" class="btn-action" type="button">REGISTRAR</button>
                    <button id="btn-cancel-uid" class="btn-action btn-purge" type="button">CANCELAR</button>
                </div>
            </div>

            <!-- Buscador desplegable de expedientes -->
            <div id="osint-search-wrapper" style="position: relative; margin-bottom: 1.5rem; z-index: 40;">
                <div class="toolbar-tactical" style="margin-bottom: 0;">
                    <span style="color: var(--accent-rz); font-family: var(--font-mono); font-size: 0.8rem; font-weight: 700;">[ LOCALIZADOR ]</span>
                    <input type="text" id="osint-search" class="search-input" style="flex-grow: 1; width: auto;" placeholder="Buscar sujeto por UID, Alias o seleccionar de la lista..." autocomplete="off">
                </div>
                <div id="osint-search-results" class="hidden" style="position: absolute; top: 100%; left: 0; width: 100%; max-height: 320px; overflow-y: auto; background: var(--bg-dark); border: var(--border-thin); border-radius: 0 0 var(--radius-md) var(--radius-md); box-shadow: var(--shadow-elevated);"></div>
            </div>

            <!-- Espacio de trabajo dual: Historial Forense + Bloc del Analista -->
            <div class="osint-layout hidden" id="osint-workspace">
                <div class="osint-panel">
                    <div class="panel-header" style="margin: 0; padding: 1rem 1.25rem;">
                        <span class="panel-title" style="color: var(--accent-amber);">HISTORIAL DE INTERCEPCIONES</span>
                        <span id="osint-target-badge" class="badge badge-red">SIN OBJETIVO</span>
                    </div>
                    <div class="osint-content" id="osint-raw-logs"></div>
                </div>

                <div class="osint-panel">
                    <div class="panel-header" style="margin: 0; padding: 1rem 1.25rem;">
                        <span class="panel-title">DOSSIER DEL ANALISTA (AUTOGUARDADO)</span>
                        <span id="osint-save-status" class="badge badge-green">SINCRONIZADO</span>
                    </div>
                    <div style="flex-grow: 1; padding: 0.85rem; display: flex;">
                        <textarea id="osint-notes-editor" class="editor-textarea" placeholder="Escriba aquí las conclusiones de inteligencia, cuentas secundarias (alts), redes vinculadas o notas operativas sobre el sujeto..."></textarea>
                    </div>
                </div>
            </div>
        `;

        try {
            this.globalData = await window.C4ISR_API.getDatosGlobales();
            this.bindEvents();

            if (window.C4ISR_TARGET_OVERRIDE) {
                const targetId = window.C4ISR_TARGET_OVERRIDE;
                window.C4ISR_TARGET_OVERRIDE = null;
                this.loadTargetWorkspace(targetId);
            } else {
                const lista = this.obtenerListaUnificada();
                if (lista.length > 0) {
                    this.loadTargetWorkspace(lista[0].id);
                }
            }
        } catch (error) {
            console.error('[Expedientes] Error cargando vista:', error);
            container.innerHTML = `
                <div class="login-error" style="display: block;">
                    [!] ERROR CRÍTICO AL CONECTAR CON EL ARCHIVO DE EXPEDIENTES.
                </div>`;
        }
    },

    /**
     * Combina la información enriquecida de expedientes y blacklist para disponer siempre del historial completo.
     */
    obtenerListaUnificada() {
        if (!this.globalData) return [];
        const baseBlacklist = Array.isArray(this.globalData.blacklist) ? this.globalData.blacklist : [];
        return [...baseBlacklist].sort((a, b) => new Date(b.fecha || 0) - new Date(a.fecha || 0));
    },

    renderDropdownResults(usuarios) {
        const searchResults = document.getElementById('osint-search-results');
        if (!searchResults) return;

        if (usuarios.length === 0) {
            searchResults.innerHTML = `
                <div style="padding: 1rem; color: var(--text-muted); font-family: var(--font-mono); font-size: 0.8rem;">
                    Sin coincidencias en la base de datos.
                </div>`;
            searchResults.classList.remove('hidden');
            return;
        }

        searchResults.innerHTML = usuarios.slice(0, 20).map(u => {
            const id = DOMPurify.sanitize(String(u.id || ''));
            const username = DOMPurify.sanitize(String(u.username || 'Identidad Desconocida'));
            const numEventos = Array.isArray(u.historial) ? u.historial.length : (u.reincidencia || 0);

            return `
                <div class="search-item" data-id="${id}" style="padding: 0.75rem 1.15rem; border-bottom: var(--border-subtle); cursor: pointer; display: flex; justify-content: space-between; align-items: center;">
                    <div>
                        <div style="font-weight: 600; color: var(--text-main); font-size: 0.88rem;">${username}</div>
                        <div style="font-family: var(--font-mono); font-size: 0.72rem; color: var(--text-muted);">UID: ${id}</div>
                    </div>
                    <span class="badge ${numEventos > 0 ? 'badge-red' : 'badge-amber'}">${numEventos} REGISTRO(S)</span>
                </div>
            `;
        }).join('');

        searchResults.classList.remove('hidden');

        searchResults.querySelectorAll('.search-item').forEach(item => {
            item.addEventListener('click', () => {
                const targetId = item.getAttribute('data-id');
                const searchInput = document.getElementById('osint-search');
                if (searchInput) searchInput.value = '';
                searchResults.classList.add('hidden');
                this.loadTargetWorkspace(targetId);
            });
        });
    },

    bindEvents() {
        const searchInput = document.getElementById('osint-search');
        const searchWrapper = document.getElementById('osint-search-wrapper');
        const searchResults = document.getElementById('osint-search-results');
        const editor = document.getElementById('osint-notes-editor');

        const btnAdd = document.getElementById('btn-add-target');
        const manualBar = document.getElementById('manual-inject-bar');
        const inputManualUid = document.getElementById('input-manual-uid');
        const btnConfirmUid = document.getElementById('btn-confirm-uid');
        const btnCancelUid = document.getElementById('btn-cancel-uid');

        const btnImport = document.getElementById('btn-import-targets');
        const fileInput = document.getElementById('file-import-input');

        if (searchInput) {
            searchInput.addEventListener('focus', () => {
                const term = searchInput.value.toLowerCase().trim();
                const todos = this.obtenerListaUnificada();
                const filtrados = term
                    ? todos.filter(u => String(u.username || '').toLowerCase().includes(term) || String(u.id || '').includes(term))
                    : todos;
                this.renderDropdownResults(filtrados);
            });

            searchInput.addEventListener('input', (e) => {
                const term = e.target.value.toLowerCase().trim();
                const todos = this.obtenerListaUnificada();
                const filtrados = term
                    ? todos.filter(u => String(u.username || '').toLowerCase().includes(term) || String(u.id || '').includes(term))
                    : todos;
                this.renderDropdownResults(filtrados);
            });
        }

        // Listener limpio sin fugas de memoria al cambiar de vista
        this.outsideClickListener = (e) => {
            if (searchWrapper && searchResults && !searchWrapper.contains(e.target)) {
                searchResults.classList.add('hidden');
            }
        };
        document.addEventListener('click', this.outsideClickListener);

        if (editor) {
            editor.addEventListener('input', () => {
                if (!this.currentTargetId) return;
                this.updateSaveStatus('saving');
                if (this.saveTimeout) clearTimeout(this.saveTimeout);
                this.saveTimeout = setTimeout(() => {
                    this.saveNotes(this.currentTargetId, editor.value);
                }, 850);
            });
        }

        // Inyección de UID Manual mediante barra integrada
        if (btnAdd && manualBar) {
            btnAdd.addEventListener('click', () => {
                manualBar.classList.toggle('hidden');
                if (!manualBar.classList.contains('hidden') && inputManualUid) {
                    inputManualUid.focus();
                }
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
                    alert('[!] Formato de UID inválido. Debe contener entre 17 y 20 dígitos numéricos.');
                    return;
                }

                btnConfirmUid.disabled = true;
                btnConfirmUid.textContent = 'INYECTANDO...';
                try {
                    await window.C4ISR_API.agregarObjetivoManual(uid);
                    window.C4ISR_TARGET_OVERRIDE = uid;
                    await window.AppController.navigate('expedientes');
                } catch (error) {
                    alert('[!] Error al registrar el UID en la base de datos.');
                    btnConfirmUid.disabled = false;
                    btnConfirmUid.textContent = 'REGISTRAR';
                }
            });
        }

        // Importación de Matriz JSON (Funcionalidad que antes estaba desconectada)
        if (btnImport && fileInput) {
            btnImport.addEventListener('click', () => fileInput.click());

            fileInput.addEventListener('change', async (e) => {
                const archivo = e.target.files?.[0];
                if (!archivo) return;

                const originalText = btnImport.innerHTML;
                btnImport.innerHTML = 'IMPORTANDO...';
                btnImport.disabled = true;

                try {
                    const texto = await archivo.text();
                    const jsonParsed = JSON.parse(texto);
                    const matriz = Array.isArray(jsonParsed) ? jsonParsed : (jsonParsed.blacklist || jsonParsed.datos || []);

                    if (!Array.isArray(matriz) || matriz.length === 0) {
                        throw new Error('El archivo JSON no contiene un array de expedientes válido.');
                    }

                    await window.C4ISR_API.importarMatriz(matriz);
                    await window.AppController.navigate('expedientes');
                } catch (error) {
                    alert(`[!] Fallo al importar matriz: ${error.message}`);
                    btnImport.innerHTML = originalText;
                    btnImport.disabled = false;
                } finally {
                    fileInput.value = '';
                }
            });
        }
    },

    loadTargetWorkspace(targetId) {
        this.currentTargetId = String(targetId);
        const workspace = document.getElementById('osint-workspace');
        const rawLogsContainer = document.getElementById('osint-raw-logs');
        const editor = document.getElementById('osint-notes-editor');
        const badge = document.getElementById('osint-target-badge');

        if (!workspace || !rawLogsContainer || !editor || !badge) return;

        const lista = this.obtenerListaUnificada();
        const user = lista.find(u => String(u.id) === this.currentTargetId);

        if (!user) {
            workspace.classList.add('hidden');
            return;
        }

        workspace.classList.remove('hidden');
        this.updateSaveStatus('loaded');

        editor.value = user.notas || '';
        const usernameSeguro = DOMPurify.sanitize(String(user.username || 'Identidad Desconocida'));
        const idSeguro = DOMPurify.sanitize(String(user.id));

        badge.textContent = `${usernameSeguro} (${idSeguro})`;

        const historial = Array.isArray(user.historial) && user.historial.length > 0
            ? [...user.historial].reverse()
            : [{
                fecha: user.fecha,
                accion: 'Registro Base',
                casoId: 'N/A',
                servidor: user.servidor || 'N/A',
                mensajeOriginal: user.evidencia || '[ SIN REGISTROS ACTIVOS ]'
            }];

        rawLogsContainer.innerHTML = historial.map((evento) => {
            const accion = DOMPurify.sanitize(String(evento.accion || 'Evento'));
            const casoId = DOMPurify.sanitize(String(evento.casoId || 'N/A'));
            const servidor = DOMPurify.sanitize(String(evento.servidor || 'Sector Desconocido'));
            const fecha = formatearFechaCorta(evento.fecha);
            const evidencia = DOMPurify.sanitize(String(evento.mensajeOriginal || ''));

            return `
                <div style="margin-bottom: 1rem; padding-bottom: 1rem; border-bottom: var(--border-subtle);">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.4rem; flex-wrap: wrap; gap: 0.4rem; font-family: var(--font-mono); font-size: 0.73rem;">
                        <span style="color: var(--accent-rz); font-weight: 700;">[${casoId}] ${accion}</span>
                        <span style="color: var(--text-muted);">📍 ${servidor} • ${fecha}</span>
                    </div>
                    <div class="discord-mock">
                        <div class="discord-mock-content">
                            <div class="discord-mock-body">${evidencia}</div>
                        </div>
                    </div>
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
        } catch (error) {
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
                statusEl.textContent = 'ERROR DE RED';
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
        if (this.outsideClickListener) {
            document.removeEventListener('click', this.outsideClickListener);
            this.outsideClickListener = null;
        }
        this.currentTargetId = null;
        this.globalData = null;
    }
};
