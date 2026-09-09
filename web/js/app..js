/* ==========================================================================
   MOTOR DE LA SINGLE PAGE APPLICATION (SPA) Y ENRUTADOR
   Archivo: js/app.js
   ========================================================================== */

window.C4ISR_Views = {};

const AppController = {
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
                    // Solo salta si el backend rechaza la clave explícitamente con un código 403
                    this.showLoginError("[!] ERROR: CREDENCIALES INVÁLIDAS. ENLACE DENEGADO.");
                }
            } catch (error) {
                console.error("[AppController] Interrupción en la transmisión:", error);
                // Si la base de datos o el servidor caen, te mostrará la alerta real en pantalla
                this.showLoginError(`[!] FALLO CRÍTICO: ${error.message}. Revisa la consola o base de datos.`);
            } finally {
                btn.textContent = originalText;
                btn.disabled = false;
                this.elements.passwordInput.value = '';
            }
        });

        this.elements.btnLogout.addEventListener('click', () => {
            this.lockSystem();
        });

        this.elements.navItems.forEach(item => {
            item.addEventListener('click', () => {
                const viewName = item.getAttribute('data-view');
                if (viewName && viewName !== this.currentViewName) {
                    this.navigate(viewName);
                }
            });
        });
    },

    showLoginError(mensajePersonalizado) {
        this.elements.loginError.textContent = mensajePersonalizado || "[!] ERROR DESCONOCIDO EN EL SISTEMA";
        this.elements.loginError.classList.remove('hidden');
        
        this.elements.loginForm.style.transform = 'translateX(-10px)';
        setTimeout(() => this.elements.loginForm.style.transform = 'translateX(10px)', 50);
        setTimeout(() => this.elements.loginForm.style.transform = 'translateX(0)', 100);
    },

    unlockSystem() {
        this.elements.loginModal.classList.remove('active');
        this.elements.loginError.classList.add('hidden');
        this.elements.appWrapper.classList.remove('hidden');
        
        this.navigate('dashboard');
    },

    lockSystem() {
        this.destroyCurrentView();
        C4ISR_API.sessionKey = null;
        this.elements.appWrapper.classList.add('hidden');
        this.elements.loginModal.classList.add('active');
        this.elements.passwordInput.focus();
    },

    async navigate(viewName) {
        this.destroyCurrentView();

        this.elements.navItems.forEach(item => item.classList.remove('active'));
        const activeItem = document.querySelector(`.nav-item[data-view="${viewName}"]`);
        if (activeItem) {
            activeItem.classList.add('active');
            this.elements.currentPathDisplay.textContent = activeItem.querySelector('.nav-label').textContent.toUpperCase();
        }

        this.elements.spaRoot.innerHTML = '<div style="color: var(--accent-cyan);">[ SISTEMA ] CARGANDO MÓDULO...</div>';
        
        const ViewModule = window.C4ISR_Views[viewName];
        
        if (ViewModule) {
            try {
                this.elements.spaRoot.innerHTML = ''; 
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

document.addEventListener('DOMContentLoaded', () => {
    AppController.init();
});
