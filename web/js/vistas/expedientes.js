/* ==========================================================================
   VISTA: EXPEDIENTES OSINT (AUTO-CARGA Y PUENTE DE MEMORIA)
   Archivo: js/vistas/expedientes.js
   ========================================================================== */
window.C4ISR_Views = window.C4ISR_Views || {};

function formatDiscordDate(dateString) {
    const dateObj = new Date(dateString);
    if (isNaN(dateObj)) return dateString;
    const now = new Date();
    const timeString = dateObj.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    if (dateObj.toDateString() === now.toDateString()) return `Hoy a las ${timeString}`;
    return dateObj.toLocaleDateString('es-ES') + ` ${timeString}`;
}

window.C4ISR_Views.expedientes = {
    saveTimeout: null,
    currentTargetId: null,
    globalData: null,

    async render(container) {
        container.innerHTML = `
            <div class="panel-header" style="margin-bottom: 1.5rem; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem;">
                <span class="panel-title" style="font-size: 1.2rem; color: var(--accent-rz); text-shadow: var(--glow-rz);">BASE DE DATOS DE INTELIGENCIA (OSINT)</span>
                <div style="display: flex; gap: 1rem; align-items: center;">
                    <button id="btn-add-target" class="btn-action" style="border-color: var(--accent-rz); color: var(--accent-rz);">+ AÑADIR OBJETIVO</button>
                    <button id="btn-import-targets" class="btn-action">📄 IMPORTAR MATRIZ</button>
                </div>
            </div>

            <div style="position: relative; margin-bottom: 2rem; z-index: 50;">
                <div style="display: flex; gap: 1rem; align-items: center; background: var(--bg-dark); border: var(--border-thin); padding: 0.5rem;">
                    <span style="color: var(--accent-rz); font-family: var(--font-mono); padding-left: 1rem;">[ RASTREO ]</span>
                    <input type="text" id="osint-search" class="editor-textarea" style="border: none; box-shadow: none; padding: 0.5rem; height: auto; font-size: 0.85rem;" placeholder="Ingresar UID, Alias o palabra clave para localizar expediente..." autocomplete="off">
                </div>
                <div id="osint-search-results" class="hidden" style="position: absolute; top: 100%; left: 0; width: 100%; max-height: 300px; overflow-y: auto; background: var(--bg-panel); border: var(--border-thin); border-top: none; box-shadow: 0 10px 30px rgba(0,0,0,0.8);"></div>
            </div>

            <div class="osint-layout hidden" id="osint-workspace">
                <div class="osint-panel">
                    <div class="panel-header" style="margin: 0; border-bottom: var(--border-thin); padding: 1rem; display: flex; justify-content: space-between;">
                        <span class="panel-title" style="color: var(--accent-amber);">VOLCADO FORENSE (HISTORIAL CRUDO)</span>
                        <span id="osint-target-badge" class="badge badge-amber">ESPERANDO...</span>
                    </div>
                    <div class="osint-content" id="osint-raw-logs" style="background: transparent; padding: 1rem;"></div>
                </div>
                
                <div class="osint-panel">
                    <div class="panel-header" style="margin: 0; border-bottom: var(--border-thin); padding: 1rem; display: flex; justify-content: space-between; align-items: center;">
                        <span class="panel-title" style="color: var(--accent-cyan);">PERFILADO (BLOC DE NOTAS)</span>
                        <span id="osint-save-status" class="save-status">[ SINCRONIZADO ]</span>
                    </div>
                    <div style="flex-grow: 1; padding: 0;">
                        <textarea id="osint-notes-editor" class="editor-textarea" style="color: var(--text-main);" placeholder="[!] Ingrese datos del perfilado de la amenaza. El autoguardado se ejecutará silenciosamente..."></textarea>
                    </div>
                </div>
            </div>
        `;

        try {
            this.globalData = await C4ISR_API.getDatosGlobales();
            this.bindEvents();

            // Lógica de Puente de Memoria (Redirección desde Blacklist)
            if (window.C4ISR_TARGET_OVERRIDE) {
                this.loadTargetWorkspace(window.C4ISR_TARGET_OVERRIDE);
                window.C4ISR_TARGET_OVERRIDE = null; // Purgar variable tras el consumo
            } else {
                // Autocarga de los últimos expedientes por defecto
                this.showRecentTargets();
            }
        } catch (error) {
            container.innerHTML = `<div class="login-error" style="display:block;">[!] ERROR CRÍTICO: FALLO DE ENLACE OSINT.</div>`;
        }
    },

    showRecentTargets() {
        const searchResults = document.getElementById('osint-search-results');
        const usuarios = this.globalData.blacklist || [];
        
        // Ordenar por fecha y tomar los 15 más recientes
        const recientes = [...usuarios].sort((a, b) => new Date(b.fecha) - new Date(a.fecha)).slice(0, 15);
        
        if (recientes.length > 0) {
            searchResults.innerHTML = `<div style="padding: 0.5rem 1rem; color: var(--text-muted); font-size: 0.75rem; border-bottom: 1px solid rgba(255,255,255,0.05); background: var(--bg-dark);">ÚLTIMOS PERFILES ACTUALIZADOS</div>`;
            searchResults.innerHTML += recientes.map(u => `
                <div class="nav-item search-item" data-id="${u.id}" style="padding: 0.8rem 1rem; border-bottom: 1px solid rgba(255,255,255,0.05); cursor: pointer;">
                    <div style="font-weight: bold; color: var(--accent-rz); font-size: 0.9rem;">${DOMPurify.sanitize(u.username)}</div>
                    <div style="font-size: 0.75rem; color: var(--text-muted);">UID: ${DOMPurify.sanitize(u.id)}</div>
                </div>
            `).join('');
            searchResults.classList.remove('hidden');
            this.bindSearchItems();
        }
    },

    bindEvents() {
        const searchInput = document.getElementById('osint-search');
        const searchResults = document.getElementById('osint-search-results');
        const editor = document.getElementById('osint-notes-editor');
        const btnAdd = document.getElementById('btn-add-target');

        searchInput.addEventListener('input', (e) => {
            const term = e.target.value.toLowerCase().trim();
            if (term.length === 0) {
                this.showRecentTargets();
                return;
            }

            const usuarios = this.globalData.blacklist || [];
            const filtrados = usuarios.filter(u => 
                (u.username && u.username.toLowerCase().includes(term)) || 
                (u.id && u.id.includes(term))
            ).slice(0, 15);

            if (filtrados.length > 0) {
                searchResults.innerHTML = filtrados.map(u => `
                    <div class="nav-item search-item" data-id="${u.id}" style="padding: 0.8rem 1rem; border-bottom: 1px solid rgba(255,255,255,0.05); cursor: pointer;">
                        <div style="font-weight: bold; color: var(--accent-rz); font-size: 0.9rem;">${DOMPurify.sanitize(u.username)}</div>
                        <div style="font-size: 0.75rem; color: var(--text-muted);">UID: ${DOMPurify.sanitize(u.id)}</div>
                    </div>
                `).join('');
                this.bindSearchItems();
            } else {
                searchResults.innerHTML = `<div style="padding: 1rem; color: var(--text-muted);">Sin coincidencias en la matriz.</div>`;
            }
            searchResults.classList.remove('hidden');
        });

        document.addEventListener('click', (e) => {
            if (!searchInput.contains(e.target) && !searchResults.contains(e.target)) {
                searchResults.classList.add('hidden');
            }
        });

        editor.addEventListener('input', () => {
            if (!this.currentTargetId) return;
            this.updateSaveStatus('saving');
            if (this.saveTimeout) clearTimeout(this.saveTimeout);
            this.saveTimeout = setTimeout(() => { this.saveNotes(this.currentTargetId, editor.value); }, 1000);
        });

        btnAdd.addEventListener('click', async () => {
            const newId = prompt("[ LA BIBLIOTECA ]\nIngrese el Discord UID del objetivo a vigilar:");
            if (newId && /^\d{17,20}$/.test(newId)) {
                try {
                    const originalText = btnAdd.innerHTML;
                    btnAdd.innerHTML = "EJECUTANDO...";
                    await C4ISR_API.agregarObjetivoManual(newId);
                    window.AppController.navigate('expedientes'); 
                } catch (error) {
                    alert("[!] Error crítico de red al inyectar el UID en la base de datos.");
                    btnAdd.innerHTML = "+ AÑADIR OBJETIVO";
                }
            } else if (newId) {
                alert("[!] ERROR: Formato de UID inválido. Debe contener entre 17 y 20 dígitos numéricos.");
            }
        });
    },

    bindSearchItems() {
        const searchInput = document.getElementById('osint-search');
        const searchResults = document.getElementById('osint-search-results');
        
        document.querySelectorAll('.search-item').forEach(item => {
            item.addEventListener('click', () => {
                const targetId = item.getAttribute('data-id');
                searchInput.value = item.querySelector('div').textContent;
                searchResults.classList.add('hidden');
                this.loadTargetWorkspace(targetId);
            });
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

            const username = DOMPurify.sanitize(user.username);
            const evidenciaCruda = DOMPurify.sanitize(user.evidencia || '[ SIN REGISTROS ACTIVOS ]');
            const fechaFormat = formatDiscordDate(DOMPurify.sanitize(user.fecha));

            rawLogsContainer.innerHTML = `
                <div class="discord-mock">
                    <img src="https://cdn.discordapp.com/embed/avatars/1.png" alt="Avatar">
                    <div class="discord-mock-content">
                        <div class="discord-mock-header">
                            <span class="user role-color">${username}</span>
                            <span class="date">${fechaFormat}</span>
                        </div>
                        <div class="discord-mock-body">${evidenciaCruda}</div>
                    </div>
                </div>
            `;
        }
    },

    async saveNotes(targetId, notesContent) {
        try {
            await C4ISR_API.guardarNota(targetId, notesContent);
            this.updateSaveStatus('saved');
            const user = (this.globalData.blacklist || []).find(u => u.id === targetId);
            if (user) user.notas = notesContent;
        } catch (error) { this.updateSaveStatus('error'); }
    },

    updateSaveStatus(state) {
        const statusEl = document.getElementById('osint-save-status');
        if (!statusEl) return;
        statusEl.className = 'save-status';
        switch(state) {
            case 'saving': statusEl.textContent = '[ ENCRIPTANDO... ]'; statusEl.style.color = 'var(--accent-amber)'; break;
            case 'saved': statusEl.textContent = '[ SINCRONIZADO ]'; statusEl.style.color = 'var(--accent-green)'; break;
            case 'error': statusEl.textContent = '[!] FALLO DE RED'; statusEl.style.color = 'var(--accent-red)'; break;
            case 'loaded': statusEl.textContent = '[ LISTO PARA ESCRITURA ]'; statusEl.style.color = 'var(--text-muted)'; break;
        }
    },

    destroy() {
        if (this.saveTimeout) clearTimeout(this.saveTimeout);
        this.currentTargetId = null;
        this.globalData = null;
    }
};
