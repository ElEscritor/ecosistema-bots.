/* ==========================================================================
   VISTA: EXPEDIENTES OSINT (PERFILADO DE IDENTIDADES)
   Archivo: js/vistas/expedientes.js
   Objetivo: Visor de logs crudos y editor de notas con autoguardado asíncrono
   ========================================================================== */

window.C4ISR_Views = window.C4ISR_Views || {};

window.C4ISR_Views.expedientes = {
    // Controladores de estado local
    saveTimeout: null,
    currentTargetId: null,
    globalData: null,

    async render(container) {
        // 1. Inyectar el esqueleto del espacio de trabajo
        container.innerHTML = `
            <div class="panel-header" style="margin-bottom: 1.5rem; display: flex; justify-content: space-between; align-items: center;">
                <span class="panel-title" style="font-size: 1.2rem;">BASE DE DATOS DE INTELIGENCIA (OSINT)</span>
                
                <div style="display: flex; gap: 1rem; align-items: center;">
                    <span style="color: var(--accent-cyan); font-size: 0.85rem; font-family: var(--font-mono);">[ OBJETIVO ]</span>
                    <select id="osint-target-select" class="editor-textarea" style="height: auto; padding: 0.5rem; width: 300px; cursor: pointer;">
                        <option value="">-- SELECCIONAR IDENTIDAD --</option>
                    </select>
                </div>
            </div>
            
            <!-- Contenedor Split: Izquierda (Evidencia) / Derecha (Editor) -->
            <div class="osint-layout hidden" id="osint-workspace">
                
                <!-- Panel Izquierdo: Registros Crudos -->
                <div class="osint-panel">
                    <div class="panel-header" style="margin: 0; border-bottom: var(--border-thin); padding: 1rem;">
                        <span class="panel-title" style="color: var(--accent-amber);">VOLCADO FORENSE (EVIDENCIA CRUDA)</span>
                    </div>
                    <div class="osint-content" id="osint-raw-logs" style="font-family: var(--font-mono); font-size: 0.85rem;">
                        <!-- Los registros crudos se inyectarán aquí -->
                    </div>
                </div>
                
                <!-- Panel Derecho: Editor Táctico de Notas -->
                <div class="osint-panel">
                    <div class="panel-header" style="margin: 0; border-bottom: var(--border-thin); padding: 1rem; display: flex; justify-content: space-between; align-items: center;">
                        <span class="panel-title">PERFILADO (BLOC DE NOTAS)</span>
                        <span id="osint-save-status" class="save-status">[ ESPERANDO ENTRADA ]</span>
                    </div>
                    <div style="flex-grow: 1; padding: 0;">
                        <textarea id="osint-notes-editor" class="editor-textarea" placeholder="[!] Ingrese datos del perfilado de la amenaza. El autoguardado se ejecutará de forma silenciosa tras 1 segundo de inactividad..."></textarea>
                    </div>
                </div>
            </div>
        `;

        try {
            // 2. Extraer datos globales desde la caché del servidor
            this.globalData = await C4ISR_API.getDatosGlobales();
            
            // 3. Poblar el selector de objetivos y activar listeners
            this.populateTargets();
            this.bindEvents();
        } catch (error) {
            console.error("[Expedientes OSINT] Error al sincronizar base de datos:", error);
            container.innerHTML = `<div class="login-error" style="display:block;">[!] ERROR CRÍTICO: FALLO AL SINCRONIZAR LA BASE DE DATOS OSINT CON EL ENJAMBRE.</div>`;
        }
    },

    populateTargets() {
        const select = document.getElementById('osint-target-select');
        if (!select || !this.globalData) return;

        // Asumimos que los perfiles a investigar provienen del array "blacklist"
        const usuarios = this.globalData.blacklist || []; 
        
        if (usuarios.length === 0) {
            select.innerHTML = '<option value="">-- BASE DE DATOS VACÍA --</option>';
            select.disabled = true;
            return;
        }

        usuarios.forEach(user => {
            const option = document.createElement('option');
            option.value = user.id;
            // Saneamos preventivamente el texto por si el nombre de usuario contiene vectores maliciosos
            const safeUsername = DOMPurify.sanitize(user.username || 'IDENTIDAD_DESCONOCIDA');
            option.textContent = `ID: ${DOMPurify.sanitize(user.id)} | ${safeUsername}`;
            select.appendChild(option);
        });
    },

    bindEvents() {
        const select = document.getElementById('osint-target-select');
        const workspace = document.getElementById('osint-workspace');
        const editor = document.getElementById('osint-notes-editor');

        // Evento de selección de objetivo
        select.addEventListener('change', (e) => {
            const targetId = e.target.value;
            if (!targetId) {
                workspace.classList.add('hidden');
                this.currentTargetId = null;
                return;
            }
            this.currentTargetId = targetId;
            this.loadTargetWorkspace(targetId);
        });

        // Evento de escritura con lógica de Debounce (Autoguardado asíncrono)
        editor.addEventListener('input', () => {
            if (!this.currentTargetId) return;
            
            this.updateSaveStatus('saving');
            
            // Si el usuario sigue tecleando, reiniciamos el temporizador
            if (this.saveTimeout) clearTimeout(this.saveTimeout);
            
            // Si deja de teclear por 1 segundo, ejecutamos el guardado en backend
            this.saveTimeout = setTimeout(() => {
                this.saveNotes(this.currentTargetId, editor.value);
            }, 1000); 
        });
    },

    loadTargetWorkspace(targetId) {
        const workspace = document.getElementById('osint-workspace');
        const rawLogsContainer = document.getElementById('osint-raw-logs');
        const editor = document.getElementById('osint-notes-editor');
        
        workspace.classList.remove('hidden');
        this.updateSaveStatus('loaded');

        // Localizar la entidad en los datos locales
        const user = (this.globalData.blacklist || []).find(u => u.id === targetId);
        
        if (user) {
            // Cargar notas previas en el editor
            editor.value = user.notas || '';
            
            // Cargar evidencia cruda saneando siempre el HTML interceptado
            const evidenciaCruda = user.evidencia || '[!] NO SE ENCONTRARON REGISTROS PREVIOS.';
            const fechaCaptura = user.fecha || 'FECHA_DESCONOCIDA';
            
            rawLogsContainer.innerHTML = `
                <div style="color: var(--accent-cyan); margin-bottom: 1.5rem;">>>> INICIANDO VOLCADO FORENSE...</div>
                <div style="color: var(--text-muted); margin-bottom: 0.5rem;">TIMESTAMP: ${DOMPurify.sanitize(fechaCaptura)}</div>
                
                <div style="color: var(--text-main); white-space: pre-wrap; padding: 1rem; background: var(--bg-dark); border-left: 2px solid var(--accent-amber);">
                    ${DOMPurify.sanitize(evidenciaCruda)}
                </div>
                
                <div style="color: var(--text-muted); margin-top: 1.5rem;">>>> FIN DEL VOLCADO.</div>
            `;
        } else {
            editor.value = '';
            rawLogsContainer.innerHTML = '<div style="color: var(--accent-red);">[!] REGISTRO CORRUPTO O PERFIL NO ENCONTRADO EN LA BASE DE DATOS.</div>';
        }
    },

    async saveNotes(targetId, notesContent) {
        try {
            // Transmisión asíncrona hacia servidor.js
            await C4ISR_API.guardarNota(targetId, notesContent);
            this.updateSaveStatus('saved');
            
            // Actualizar la caché local para mantener persistencia si el operador cambia de objetivo y vuelve
            const user = (this.globalData.blacklist || []).find(u => u.id === targetId);
            if (user) user.notas = notesContent;
            
        } catch (error) {
            console.error("[Expedientes OSINT] Error al encriptar y guardar nota:", error);
            this.updateSaveStatus('error');
        }
    },

    updateSaveStatus(state) {
        const statusEl = document.getElementById('osint-save-status');
        if (!statusEl) return;

        // Resetear clases
        statusEl.className = 'save-status'; 
        
        switch(state) {
            case 'saving':
                statusEl.textContent = '[ ENCRIPTANDO Y GUARDANDO... ]';
                statusEl.classList.add('saving');
                break;
            case 'saved':
                statusEl.textContent = '[ GUARDADO EN LA BASE DE DATOS ]';
                statusEl.classList.add('saved');
                break;
            case 'error':
                statusEl.textContent = '[!] ERROR DE TRANSMISIÓN DE DATOS';
                statusEl.style.color = 'var(--accent-red)';
                break;
            case 'loaded':
                statusEl.textContent = '[ ESPERANDO ENTRADA DE DATOS ]';
                break;
        }
    },

    destroy() {
        // Prevención de fugas de memoria y envíos en segundo plano al cerrar la vista
        if (this.saveTimeout) {
            clearTimeout(this.saveTimeout);
            this.saveTimeout = null;
        }
        this.currentTargetId = null;
        this.globalData = null;
    }
};