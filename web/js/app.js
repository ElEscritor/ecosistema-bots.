/* ==========================================================================
   MOTOR DE LA SINGLE PAGE APPLICATION (SPA) Y ENRUTADOR TÁCTICO
   Archivo: js/app.js
   Objetivo: Gestión de estado visual, enrutamiento modular y ciclo de vida.
   ========================================================================== */

window.C4ISR_Views = window.C4ISR_Views || {};

window.AppController = {
    // 1. Referencias Estructurales del DOM (Excluyendo elementos de seguridad)
    elements: {
        appWrapper: document.getElementById('app-wrapper'),
        spaRoot: document.getElementById('spa-root'),
        navItems: document.querySelectorAll('.nav-item'),
        currentPathDisplay: document.getElementById('current-path'),
        btnLogout: document.getElementById('btn-logout'),
        systemClock: document.getElementById('system-clock')
    },

    currentViewName: null,
    clockInterval: null,

    // 2. Inicialización Controlada
    // Este método es invocado exclusivamente por el script de seguridad en index.html
    // una vez que el servidor backend ha emitido el token de autorización (HTTP 200 OK).
    start() {
        this.bindEvents();
        this.startSystemClock();
        // Despliegue inicial de la matriz de telemetría viva
        this.navigate('dashboard');
    },

    // Alias de retrocompatibilidad para asegurar el arranque independientemente de la versión del HTML
    init() {
        this.start();
    },

    // 3. Gestión de Eventos del Interfaz Dinámico
    bindEvents() {
        // Desconexión de Emergencia / Sellar Archivos
        if (this.elements.btnLogout) {
            this.elements.btnLogout.addEventListener('click', () => {
                this.logout();
            });
        }

        // Delegación de eventos para el menú de navegación táctica lateral
        this.elements.navItems.forEach(item => {
            item.addEventListener('click', () => {
                const viewName = item.getAttribute('data-view');
                // Previene la re-renderización innecesaria si el operador ya se encuentra en el módulo
                if (viewName && viewName !== this.currentViewName) {
                    this.navigate(viewName);
                }
            });
        });
    },

    // 4. Protocolo de Cierre de Sesión y Purga de Memoria
    logout() {
        // Destrucción sistemática de los gráficos y listeners activos en la vista actual
        this.destroyCurrentView();
        
        // Inactivación de la llave de sesión en el cliente API
        if (window.C4ISR_API) {
            window.C4ISR_API.sessionKey = null;
        }
        
        // Recarga forzada del documento desde el servidor (Bypasseando la caché local)
        // Esta acción garantiza que el estado del DOM se reinicie a cero y el muro de login se levante.
        window.location.reload(true); 
    },

    // 5. Enrutador Asíncrono de Módulos (View Router)
    async navigate(viewName) {
        // Desmontaje del módulo previo para evitar colisiones de identificadores y fugas de RAM
        this.destroyCurrentView();

        // Actualización de la interfaz de usuario (Feedback visual de navegación)
        this.elements.navItems.forEach(item => item.classList.remove('active'));
        const activeItem = document.querySelector(`.nav-item[data-view="${viewName}"]`);
        
        if (activeItem) {
            activeItem.classList.add('active');
            // Actualización del rastro de migas de pan (Breadcrumbs)
            this.elements.currentPathDisplay.textContent = activeItem.querySelector('.nav-label').textContent.toUpperCase();
        }

        // Indicador transitorio de carga de módulo con identidad visual Rz
        this.elements.spaRoot.innerHTML = '<div style="color: var(--accent-rz); font-family: var(--font-mono); font-weight: bold; text-shadow: var(--glow-rz);">[ SISTEMA ] CARGANDO MÓDULO E INYECTANDO DATOS FORENSES...</div>';
        
        // Localización del módulo solicitado en el registro global de vistas
        const ViewModule = window.C4ISR_Views[viewName];
        
        if (ViewModule) {
            try {
                // Purga del indicador de carga
                this.elements.spaRoot.innerHTML = ''; 
                
                // Inyección asíncrona de los datos provenientes de MongoDB Atlas
                await ViewModule.render(this.elements.spaRoot);
                
                // Registro exitoso del módulo actual
                this.currentViewName = viewName;
            } catch (error) {
                console.error(`[AppController] Colapso de la arquitectura durante la renderización de la vista ${viewName}:`, error);
                // Manejo de errores de red o desincronización para evitar la congelación de la pantalla
                this.elements.spaRoot.innerHTML = `
                    <div class="login-error" style="display:block; padding: 2rem; border: 1px solid var(--accent-rz); background: rgba(255, 42, 109, 0.1);">
                        [!] ERROR CRÍTICO DE SISTEMA: LA CARGA DEL MÓDULO HA FRACASADO. VERIFIQUE LA ESTABILIDAD DEL ENLACE DE DATOS.
                    </div>`;
            }
        } else {
            // Prevención contra referencias a módulos inexistentes o no cargados en el DOM
            this.elements.spaRoot.innerHTML = `
                <div class="login-error" style="display:block; padding: 2rem;">
                    [!] MÓDULO NO ENCONTRADO O SCRIPT NO INYECTADO EN LA ARQUITECTURA: ${viewName.toUpperCase()}
                </div>`;
        }
    },

    // 6. Recolector de Basura Manual (Garbage Collection & Event Cleanup)
    destroyCurrentView() {
        if (this.currentViewName && window.C4ISR_Views[this.currentViewName]) {
            const currentModule = window.C4ISR_Views[this.currentViewName];
            // Si el módulo dispone de un método de destrucción (ej. limpiar gráficos de ApexCharts), se invoca
            if (typeof currentModule.destroy === 'function') {
                currentModule.destroy();
            }
        }
        this.currentViewName = null;
    },

    // 7. Sincronización del Reloj Terminal
    startSystemClock() {
        if (this.clockInterval) clearInterval(this.clockInterval);
        
        const updateClock = () => {
            const now = new Date();
            this.elements.systemClock.textContent = now.toLocaleTimeString('es-ES', { hour12: false });
        };
        
        updateClock();
        this.clockInterval = setInterval(updateClock, 1000);
    }
};
