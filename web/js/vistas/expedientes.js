/* ==========================================================================
   VISTA: EXPEDIENTES OSINT (PERFILADO FORENSE Y BÚSQUEDA TÁCTICA)
   Archivo: js/vistas/expedientes.js
   ========================================================================== */
window.C4ISR_Views = window.C4ISR_Views || {};

window.C4ISR_Views.expedientes = {
    saveTimeout: null,
    currentTargetId: null,
    globalData: null,
    searchResults: [],

    async render(container) {
        // Estructura de alta densidad con buscador predictivo y controles de importación
        container.innerHTML = `
            <div class="panel-header" style="margin-bottom: 1.5rem; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem;">
                <span class="panel-title" style="font-size: 1.2rem; color: var(--accent-rz); text-shadow: var(--glow-rz);">BASE DE DATOS DE INTELIGENCIA (OSINT)</span>
                
                <div style="display: flex; gap: 1rem; align-items: center;">
                    <button id="btn-add-target" class="btn-action" style="border-color: var(--accent-rz); color: var(--accent-rz);" title="Inyectar objetivo manual a la base de datos">
                        + AÑADIR OBJETIVO
                    </button>
                    <button id="btn-import-targets" class="btn-action" title="Importar matriz de objetivos desde JSON">
                        📄 IMPORTAR MATRIZ
                    </button>
                </div>
            </div>

            <!-- Buscador Predictivo -->
            <div style="position: relative; margin-bottom: 2rem; z-index: 50;">
                <div style="display: flex; gap: 1rem; align-items: center; background: var(--bg-dark); border: var(--border-thin); padding: 0.5rem;">
                    <span style="color: var(--accent-rz); font-family: var(--font-mono); padding-left: 1rem;">[ RASTREO ]</span>
                    <input type="text" id="osint-search" class="editor-textarea" style="border: none; box-shadow: none; padding: 0.5rem; height: auto;" placeholder="Ingresar UID, Alias o palabra clave para localizar expediente..." autocomplete="off">
                </div>
                <!-- Contenedor de resultados predictivos -->
                <div id="osint-search-results" class="hidden" style="position: absolute; top: 100%; left: 0; width: 100%; max-height: 300px; overflow-y: auto; background: var(--bg-panel); border: var(--border-thin); border-top: none; box-shadow: 0 10px 30px rgba(0,0,0,0.8);"></div>
            </div>

            <!-- Layout Dividido: Evidencia Forense (Izq) / Anotaciones (Der) -->
            <div class="osint-layout hidden" id="osint-workspace">
                
                <!-- Panel Izquierdo: Recreación de Discord -->
                <div class="osint-panel">
                    <div class="panel-header" style="margin: 0; border-bottom: var(--border-thin); padding: 1rem; display: flex; justify-content: space-between;">
                        <span class="panel-title" style="color: var(--accent-amber);">VOLCADO FORENSE (HISTORIAL CRUDO)</span>
                        <span id="osint-target-badge" class="badge badge-amber">ESPERANDO...</span>
                    </div>
                    <div class="osint-content" id="osint-raw-logs" style="background: #1e1f22; padding: 1rem;">
                        <!-- Los logs simulados de Discord se inyectarán aquí -->
                    </div>
                </div>
                
                <!-- Panel Derecho: Editor OSINT -->
                <div class="osint-panel">
                    <div class="panel-header" style="margin: 0; border-bottom: var(--border-thin); padding: 1rem; display: flex; justify-content: space-between; align-items: center;">
                        <span class="panel-title" style="color: var(--accent-cyan);">PERFILADO (BLOC DE NOTAS)</span>
                        <span id="osint-save-status" class="save-status">[ SINCRONIZADO ]</span>
                    </div>
                    <div style="flex-grow: 1; padding: 0;">
                        <textarea id="osint-notes-editor" class="editor-textarea" style="color: var(--text-main);" placeholder="[!] Ingrese datos del perfilado de la amenaza. El autoguardado de La Biblioteca se ejecutará silenciosamente tras 1 segundo de inactividad..."></textarea>
                    </div>
                </div>

            </div>
        `;

        try {
            this.globalData = await C4ISR_API.getDatosGlobales();
            this.bindEvents();
        } catch (error) {
            console.error("[OSINT] Fracaso de inicialización:", error);
            container.innerHTML = `<div class="login-error" style="display:block;">[!] ERROR CRÍTICO: FALLO DE ENLACE OSINT.</div>`;
        }
    },

    bindEvents() {
        const searchInput = document.getElementById('osint-search');
        const searchResults = document.getElementById('osint-search-results');
        const editor = document.getElementById('osint-notes-editor');
        const btnAdd = document.getElementById('btn-add-target');

        // Búsqueda Predictiva en Tiempo Real
        searchInput.addEventListener('input', (e) => {
            const term = e.target.value.toLowerCase().trim();
            if (term.length < 2) {
                searchResults.classList.add('hidden');
                return;
            }

            const usuarios = this.globalData.blacklist || [];
            const filtrados = usuarios.filter(u => 
                (u.username && u.username.toLowerCase().includes(term)) || 
                (u.id && u.id.includes(term)) ||
                (u.evidencia && u.evidencia.toLowerCase().includes(term))
            ).slice(0, 10); // Límite de seguridad visual

            if (filtrados.length > 0) {
                searchResults.innerHTML = filtrados.map(u => `
                    <div class="nav-item search-item" data-id="${u.id}" style="padding: 1rem; border-bottom: 1px solid rgba(255,255,255,0.05);">
                        <div style="font-weight: bold; color: var(--accent-rz);">${DOMPurify.sanitize(u.username)}</div>
                        <div style="font-size: 0.8rem; color: var(--text-muted);">UID: ${DOMPurify.sanitize(u.id)}</div>
                    </div>
                `).join('');
                searchResults.classList.remove('hidden');

                // Listener para selección de objetivo
                document.querySelectorAll('.search-item').forEach(item => {
                    item.addEventListener('click', () => {
                        const targetId = item.getAttribute('data-id');
                        searchInput.value = item.querySelector('div').textContent;
                        searchResults.classList.add('hidden');
                        this.loadTargetWorkspace(targetId);
                    });
                });
            } else {
                searchResults.innerHTML = `<div style="padding: 1rem; color: var(--text-muted);">Sin coincidencias en la matriz.</div>`;
                searchResults.classList.remove('hidden');
            }
        });

        // Ocultar buscador al hacer clic fuera
        document.addEventListener('click', (e) => {
            if (!searchInput.contains(e.target) && !searchResults.contains(e.target)) {
                searchResults.classList.add('hidden');
            }
        });

        // Autoguardado Silencioso (Debounce)
        editor.addEventListener('input', () => {
            if (!this.currentTargetId) return;
            this.updateSaveStatus('saving');
            
            if (this.saveTimeout) clearTimeout(this.saveTimeout);
            
            this.saveTimeout = setTimeout(() => {
                this.saveNotes(this.currentTargetId, editor.value);
            }, 1000);
        });

        // Lógica de adición manual (Mock/Preparación para Backend)
        btnAdd.addEventListener('click', () => {
            const newId = prompt("[ LA BIBLIOTECA ]\nIngrese el Discord UID del objetivo a vigilar:");
            if (newId && /^\d{17,20}$/.test(newId)) {
                alert(`[SISTEMA] UID ${newId} programado para inyección. (Requiere actualización de servidor.js para persistencia total).`);
            } else if (newId) {
                alert("[!] ERROR: Formato de UID inválido.");
            }
        });
    },

    loadTargetWorkspace(targetId) {
        this.currentTargetId = targetId;
        const workspace = document.getElementById('osint-workspace');
        const rawLogsContainer = document.getElementById('osint-raw-logs');
        const editor = document.getElementById('osint-notes-editor');
        const badge = document.getElementById('osint-target-badge');
        
        workspace.classList.remove('hidden');
        this.updateSaveStatus('loaded');

        const user = (this.globalData.blacklist || []).find(u => u.id === targetId);
        
        if (user) {
            editor.value = user.notas || '';
            badge.textContent = `OBJETIVO: ${DOMPurify.sanitize(user.username)}`;
            badge.className = `badge badge-red`;

            // Simulador Forense de Discord para el listado masivo
            const username = DOMPurify.sanitize(user.username);
            const evidenciaCruda = DOMPurify.sanitize(user.evidencia || '[ SIN REGISTROS ]');
            const fechaOriginal = DOMPurify.sanitize(user.fecha);
            const dateObj = new Date(fechaOriginal);
            const fechaFormat = !isNaN(dateObj) ? dateObj.toLocaleString('es-ES') : fechaOriginal;

            // En el futuro, si el backend pasa 'user.historial' como array completo, 
            // se iterará aquí. Por ahora renderizamos la evidencia principal.
            rawLogsContainer.innerHTML = `
                <div class="discord-mock" style="border-left: none; background: transparent; padding: 0;">
                    <img src="https://cdn.discordapp.com/embed/avatars/1.png" alt="Avatar">
                    <div class="discord-mock-content">
                        <div class="discord-mock-header">
                            <span class="user">${username}</span>
                            <span class="date">${fechaFormat}</span>
                        </div>
                        <div class="discord-mock-body" style="color: #dbdee1;">${evidenciaCruda}</div>
                    </div>
                </div>
                <div style="margin-top: 2rem; border-top: 1px dashed rgba(255,255,255,0.1); padding-top: 1rem; color: var(--text-muted); font-size: 0.75rem; text-align: center;">
                    [ FIN DEL VOLCADO FORENSE ]
                </div>
            `;
        } else {
            workspace.classList.add('hidden');
            alert("[!] Error de sincronización: Identidad corrupta.");
        }
    },

    async saveNotes(targetId, notesContent) {
        try {
            await C4ISR_API.guardarNota(targetId, notesContent);
            this.updateSaveStatus('saved');
            const user = (this.globalData.blacklist || []).find(u => u.id === targetId);
            if (user) user.notas = notesContent;
        } catch (error) {
            this.updateSaveStatus('error');
        }
    },

    updateSaveStatus(state) {
        const statusEl = document.getElementById('osint-save-status');
        if (!statusEl) return;
        statusEl.className = 'save-status';
        
        switch(state) {
            case 'saving':
                statusEl.textContent = '[ ENCRIPTANDO... ]';
                statusEl.style.color = 'var(--accent-amber)';
                break;
            case 'saved':
                statusEl.textContent = '[ SINCRONIZADO ]';
                statusEl.style.color = 'var(--accent-green)';
                break;
            case 'error':
                statusEl.textContent = '[!] FALLO DE RED';
                statusEl.style.color = 'var(--accent-red)';
                break;
            case 'loaded':
                statusEl.textContent = '[ LISTO PARA ESCRITURA ]';
                statusEl.style.color = 'var(--text-muted)';
                break;
        }
    },

    destroy() {
        if (this.saveTimeout) clearTimeout(this.saveTimeout);
        this.currentTargetId = null;
        this.globalData = null;
    }
};
