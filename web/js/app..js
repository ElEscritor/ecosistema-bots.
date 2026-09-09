/* ==========================================================================
   MOTOR DE LA SINGLE PAGE APPLICATION (SPA) Y ENRUTADOR
   Archivo: js/app.js
   Objetivo: Gestión de estado, Login, Navegación y Ciclo de vida del DOM
   ========================================================================== */

// Registro global de las vistas modulares.
// Cada script en js/vistas/ (dashboard, expedientes, etc.) se registrará aquí.
window.C4ISR_Views = {};

const AppController = {
    // Referencias al DOM
    elements: {
        loginModal: document.getElementById('login-modal'),
        loginForm: document.getElementById('login-form'),
        loginError: document.getElementById('login-error'),
        passwordInput: document.getElementById('admin-password'),
        appWrapper: document.getElementById('app-wrapper'),
        spaRoot: document.getElementById('spa-root'),
        navItems: document.querySelectorAll('.nav-item'),
        currentPathDisplay: document.getElementById('current-path'),
        btnLogout: document.getElementById('btn-logout'),
        systemClock: document.getElementById('system-clock')
    },

    currentViewName: null,
    clockInterval: null,

    init() {
        this.bindEvents();
        this.startSystemClock();
    },

    bindEvents() {
        // Evento de Autenticación
        this.elements.loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const password = this.elements.passwordInput.value.trim();
            if (!password) return;

            const btn = e.target.querySelector('button');
            const originalText = btn.textContent;
            btn.textContent = 'AUTENTICANDO...';
            btn.disabled = true;

            try {
                const isAuthenticated = await C4ISR_API.authenticate(password);
                if (isAuthenticated) {
                    this.unlockSystem();
                } else {
                    this.showLoginError();
                }
            } catch (error) {
                console.error("[AppController] Error de conexión:", error);
                this.showLoginError();
            } finally {
                btn.textContent = originalText;
                btn.disabled = false;
                this.elements.passwordInput.value = '';
            }
        });

        // Evento de Desconexión
        this.elements.btnLogout.addEventListener('click', () => {
            this.lockSystem();
        });

        // Eventos de Navegación del Sidebar
        this.elements.navItems.forEach(item => {
            item.addEventListener('click', () => {
                const viewName = item.getAttribute('data-view');
                if (viewName && viewName !== this.currentViewName) {
                    this.navigate(viewName);
                }
            });
        });
    },

    showLoginError() {
        this.elements.loginError.classList.remove('hidden');
        // Efecto visual de fallo
        this.elements.loginForm.style.transform = 'translateX(-10px)';
        setTimeout(() => this.elements.loginForm.style.transform = 'translateX(10px)', 50);
        setTimeout(() => this.elements.loginForm.style.transform = 'translateX(0)', 100);
    },

    unlockSystem() {
        this.elements.loginModal.classList.remove('active');
        this.elements.loginError.classList.add('hidden');
        this.elements.appWrapper.classList.remove('hidden');
        
        // Iniciar la vista por defecto (Telemetría / Dashboard)
        this.navigate('dashboard');
    },

    lockSystem() {
        // Destruir la vista actual para liberar memoria
        this.destroyCurrentView();
        
        // Purgar credenciales de la memoria
        C4ISR_API.sessionKey = null;
        
        // Restaurar DOM
        this.elements.appWrapper.classList.add('hidden');
        this.elements.loginModal.classList.add('active');
        this.elements.passwordInput.focus();
    },

    async navigate(viewName) {
        // 1. Destruir la vista anterior si existe (limpieza de listeners, gráficos, etc.)
        this.destroyCurrentView();

        // 2. Actualizar estado visual de la barra lateral
        this.elements.navItems.forEach(item => item.classList.remove('active'));
        const activeItem = document.querySelector(`.nav-item[data-view="${viewName}"]`);
        if (activeItem) {
            activeItem.classList.add('active');
            // Actualizar la ruta en el Topbar (Breadcrumb)
            this.elements.currentPathDisplay.textContent = activeItem.querySelector('.nav-label').textContent.toUpperCase();
        }

        // 3. Limpiar el contenedor raíz
        this.elements.spaRoot.innerHTML = '<div style="color: var(--accent-cyan);">[ SISTEMA ] CARGANDO MÓDULO...</div>';
        
        // 4. Instanciar y renderizar la nueva vista
        const ViewModule = window.C4ISR_Views[viewName];
        
        if (ViewModule) {
            try {
                this.elements.spaRoot.innerHTML = ''; // Limpiar mensaje de carga
                await ViewModule.render(this.elements.spaRoot);
                this.currentViewName = viewName;
            } catch (error) {
                console.error(`[AppController] Fallo al renderizar la vista ${viewName}:`, error);
                this.elements.spaRoot.innerHTML = `<div class="login-error" style="display:block;">[!] ERROR DE SISTEMA: FALLO AL CARGAR EL MÓDULO ${viewName.toUpperCase()}</div>`;
            }
        } else {
            this.elements.spaRoot.innerHTML = `<div class="login-error" style="display:block;">[!] MÓDULO NO ENCONTRADO: ${viewName.toUpperCase()}</div>`;
        }
    },

    destroyCurrentView() {
        if (this.currentViewName && window.C4ISR_Views[this.currentViewName]) {
            const currentModule = window.C4ISR_Views[this.currentViewName];
            if (typeof currentModule.destroy === 'function') {
                currentModule.destroy();
            }
        }
        this.currentViewName = null;
    },

    startSystemClock() {
        if (this.clockInterval) clearInterval(this.clockInterval);
        
        const updateClock = () => {
            const now = new Date();
            const timeString = now.toLocaleTimeString('es-ES', { hour12: false });
            this.elements.systemClock.textContent = timeString;
        };
        
        updateClock();
        this.clockInterval = setInterval(updateClock, 1000);
    }
};

// Inicializar la aplicación cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', () => {
    AppController.init();
});