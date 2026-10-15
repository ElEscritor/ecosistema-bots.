'use strict';

/* ==========================================================================
   MOTOR DE LA SINGLE PAGE APPLICATION (SPA) Y GESTIÓN DE SESIÓN
   Archivo: js/app.js
   ========================================================================== */

window.C4ISR_Views = window.C4ISR_Views || {};

window.AppController = {
    elements: {},
    currentViewName: null,
    clockInterval: null,
    eventsBound: false,
    navigationCounter: 0,

    cacheElements() {
        this.elements = {
            loginModal: document.getElementById('login-modal'),
            loginForm: document.getElementById('login-form'),
            inputUser: document.getElementById('admin-username'),
            inputPass: document.getElementById('admin-password'),
            loginError: document.getElementById('login-error'),
            appWrapper: document.getElementById('app-wrapper'),
            spaRoot: document.getElementById('spa-root'),
            navItems: document.querySelectorAll('.nav-item'),
            currentPathDisplay: document.getElementById('current-path'),
            btnLogout: document.getElementById('btn-logout'),
            systemClock: document.getElementById('system-clock')
        };
    },

    /**
     * Inicializa el ciclo de vida de la interfaz y restaura la sesión si existe un token válido.
     */
    initApplication() {
        this.cacheElements();
        this.bindEvents();
        this.startSystemClock();

        // Si ya hay un token en sessionStorage, levantamos la interfaz directamente
        if (window.C4ISR_API && window.C4ISR_API.sessionKey) {
            this.unlockInterface();
        }
    },

    unlockInterface() {
        if (this.elements.loginError) this.elements.loginError.classList.add('hidden');
        if (this.elements.loginModal) this.elements.loginModal.classList.remove('active');
        if (this.elements.appWrapper) this.elements.appWrapper.classList.remove('hidden');
        this.navigate(this.currentViewName || 'dashboard');
    },

    showLoginWall(mensajeError = null) {
        this.destroyCurrentView();
        if (this.elements.appWrapper) this.elements.appWrapper.classList.add('hidden');
        if (this.elements.loginModal) this.elements.loginModal.classList.add('active');
        if (mensajeError && this.elements.loginError) {
            this.elements.loginError.textContent = mensajeError;
            this.elements.loginError.classList.remove('hidden');
        }
    },

    // Métodos de compatibilidad por si son invocados externamente
    start() {
        this.unlockInterface();
    },

    init() {
        this.unlockInterface();
    },

    bindEvents() {
        if (this.eventsBound) return;
        this.eventsBound = true;

        // 1. Manejo del formulario de Login
        if (this.elements.loginForm) {
            this.elements.loginForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                const username = this.elements.inputUser?.value.trim() || '';
                const password = this.elements.inputPass?.value.trim() || '';
                const submitBtn = this.elements.loginForm.querySelector('button[type="submit"]');

                if (!username || !password) return;

                if (submitBtn) {
                    submitBtn.textContent = 'VERIFICANDO...';
                    submitBtn.disabled = true;
                }

                try {
                    await window.C4ISR_API.login(username, password);
                    if (this.elements.inputPass) this.elements.inputPass.value = '';
                    this.unlockInterface();
                } catch (error) {
                    const msg = error.message.includes('Demasiados intentos')
                        ? `[!] ${error.message.toUpperCase()}`
                        : '[!] IDENTIFICADOR O CLAVE INCORRECTOS.';
                    this.triggerLoginError(msg);
                } finally {
                    if (submitBtn) {
                        submitBtn.textContent = 'FRANQUEAR ACCESO';
                        submitBtn.disabled = false;
                    }
                }
            });
        }

        // 2. Cierre de sesión
        if (this.elements.btnLogout) {
            this.elements.btnLogout.addEventListener('click', () => {
                this.logout();
            });
        }

        // 3. Navegación entre vistas
        this.elements.navItems.forEach((item) => {
            item.addEventListener('click', () => {
                const viewName = item.getAttribute('data-view');
                if (viewName && viewName !== this.currentViewName) {
                    this.navigate(viewName);
                }
            });
        });
    },

    triggerLoginError(mensaje) {
        if (!this.elements.loginError || !this.elements.loginForm) return;
        this.elements.loginError.textContent = mensaje;
        this.elements.loginError.classList.remove('hidden');
        this.elements.loginForm.style.transform = 'translateX(-8px)';
        setTimeout(() => { this.elements.loginForm.style.transform = 'translateX(8px)'; }, 50);
        setTimeout(() => { this.elements.loginForm.style.transform = 'translateX(0)'; }, 100);
    },

    logout() {
        this.destroyCurrentView();
        if (window.C4ISR_API) {
            window.C4ISR_API.setSession(null);
        }
        this.showLoginWall();
    },

    /**
     * Enrutador asíncrono con protección contra condiciones de carrera al cambiar rápido de pestaña.
     */
    async navigate(viewName) {
        const navTicket = ++this.navigationCounter;
        this.destroyCurrentView();

        this.elements.navItems.forEach((item) => item.classList.remove('active'));
        const activeItem = document.querySelector(`.nav-item[data-view="${viewName}"]`);

        if (activeItem) {
            activeItem.classList.add('active');
            const label = activeItem.querySelector('.nav-label');
            if (label && this.elements.currentPathDisplay) {
                this.elements.currentPathDisplay.textContent = label.textContent.toUpperCase();
            }
        }

        const ViewModule = window.C4ISR_Views[viewName];

        if (!ViewModule || typeof ViewModule.render !== 'function') {
            this.elements.spaRoot.innerHTML = `
                <div class="login-error" style="display:block; padding: 1.5rem;">
                    [!] MÓDULO NO ENCONTRADO EN LA ARQUITECTURA: ${viewName.toUpperCase()}
                </div>`;
            return;
        }

        // Mostrar indicador de carga mientras la vista obtiene datos del servidor
        this.elements.spaRoot.innerHTML = `
            <div style="padding: 2rem; color: var(--text-muted); font-family: var(--font-mono); font-size: 0.85rem;">
                [ SISTEMA ] Sincronizando módulo <strong style="color: var(--accent-rz);">${viewName.toUpperCase()}</strong>...
            </div>`;

        try {
            // Renderizamos en el contenedor; la vista reemplazará el contenido de spaRoot cuando esté lista
            await ViewModule.render(this.elements.spaRoot);
            if (navTicket === this.navigationCounter) {
                this.currentViewName = viewName;
            }
        } catch (error) {
            if (error.message === 'HTTP_ERROR_403_UNAUTHORIZED') return;
            console.error(`[AppController] Fallo al renderizar vista ${viewName}:`, error);
            this.elements.spaRoot.innerHTML = `
                <div class="login-error" style="display:block; padding: 1.5rem;">
                    [!] ERROR DE SINCRONIZACIÓN AL CARGAR EL MÓDULO ${viewName.toUpperCase()}.
                </div>`;
        }
    },

    destroyCurrentView() {
        if (this.currentViewName && window.C4ISR_Views[this.currentViewName]) {
            const currentModule = window.C4ISR_Views[this.currentViewName];
            if (typeof currentModule.destroy === 'function') {
                try {
                    currentModule.destroy();
                } catch (error) {
                    console.warn(`[AppController] Advertencia al desmontar ${this.currentViewName}:`, error);
                }
            }
        }
        this.currentViewName = null;
    },

    startSystemClock() {
        if (this.clockInterval) clearInterval(this.clockInterval);

        const updateClock = () => {
            if (!this.elements.systemClock) return;
            const now = new Date();
            this.elements.systemClock.textContent = now.toLocaleTimeString('es-ES', { hour12: false });
        };

        updateClock();
        this.clockInterval = setInterval(updateClock, 1000);
    }
};

document.addEventListener('DOMContentLoaded', () => {
    window.AppController.initApplication();
});
