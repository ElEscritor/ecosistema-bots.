/* ==========================================================================
   MOTOR DE LA SINGLE PAGE APPLICATION (SPA) Y ENRUTADOR
   Archivo: js/app.js
   ========================================================================== */

window.C4ISR_Views = {};

const AppController = {
    elements: {
        loginModal: document.getElementById('login-modal'),
        loginForm: document.getElementById('login-form'),
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
        this.elements.loginForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const password = this.elements.passwordInput.value.trim();
            if (!password) return;

            // APERTURA FORZADA: Guardamos la clave y bajamos el muro sin consultar a la base de datos
            C4ISR_API.sessionKey = password;
            this.unlockSystem();
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

    unlockSystem() {
        this.elements.loginModal.classList.remove('active');
        this.elements.appWrapper.classList.remove('hidden');
        this.navigate('dashboard');
    },

    lockSystem() {
        this.destroyCurrentView();
        C4ISR_API.sessionKey = null;
        this.elements.appWrapper.classList.add('hidden');
        this.elements.loginModal.classList.add('active');
        this.elements.passwordInput.value = '';
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
                console.error(`Fallo render:`, error);
                this.elements.spaRoot.innerHTML = `<div class="login-error" style="display:block;">[!] ERROR DE CONEXIÓN A LA BASE DE DATOS.</div>`;
            }
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
            this.elements.systemClock.textContent = now.toLocaleTimeString('es-ES', { hour12: false });
        };
        updateClock();
        this.clockInterval = setInterval(updateClock, 1000);
    }
};

document.addEventListener('DOMContentLoaded', () => AppController.init());
