'use strict';

/* ==========================================================================
   MOTOR DE COMUNICACIÓN (API REST CLIENT)
   Archivo: js/api.js
   ========================================================================== */

const STORAGE_SESSION_KEY = 'C4ISR_SESSION_TOKEN';
async getRedTopologia() {
        return await this.request('/api/red');
    } 

window.C4ISR_API = {
    sessionKey: sessionStorage.getItem(STORAGE_SESSION_KEY) || null,

    setSession(token) {
        this.sessionKey = token;
        if (token) {
            sessionStorage.setItem(STORAGE_SESSION_KEY, token);
        } else {
            sessionStorage.removeItem(STORAGE_SESSION_KEY);
        }
    },

    getHeaders() {
        return {
            'Content-Type': 'application/json',
            'X-Auth-Key': this.sessionKey || ''
        };
    },

    async login(usuario, clave) {
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ usuario, clave })
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(data.error || `HTTP_ERROR_${response.status}`);
        }

        // Guardamos el token emitido por el servidor (o la clave si se usa un backend antiguo)
        this.setSession(data.token || clave);
        return data;
    },

    async request(endpoint, options = {}) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);

        try {
            const config = {
                ...options,
                signal: controller.signal,
                headers: {
                    ...this.getHeaders(),
                    ...(options.headers || {})
                }
            };

            const response = await fetch(endpoint, config);

            if (response.status === 403) {
                this.setSession(null);
                if (window.AppController && typeof window.AppController.showLoginWall === 'function') {
                    window.AppController.showLoginWall('[!] SESIÓN EXPIRADA. AUTENTÍQUESE NUEVAMENTE.');
                }
                throw new Error('HTTP_ERROR_403_UNAUTHORIZED');
            }

            if (!response.ok) {
                throw new Error(`HTTP_ERROR_${response.status}`);
            }

            if (options.isDownload) {
                return await response.blob();
            }
            return await response.json();
        } catch (error) {
            console.error(`[C4ISR_API] Fallo en petición a ${endpoint}:`, error.message);
            throw error;
        } finally {
            clearTimeout(timeoutId);
        }
    },

    async getDatosGlobales() {
        return await this.request('/api/datos');
    },

    async guardarNota(idUsuario, contenidoNota) {
        return await this.request('/api/notas', {
            method: 'POST',
            body: JSON.stringify({ id: idUsuario, nota: contenidoNota })
        });
    },

    async eliminarInfractor(idUsuario) {
        return await this.request('/api/eliminar', {
            method: 'POST',
            body: JSON.stringify({ id: idUsuario })
        });
    },

    async exportarBaseDatos() {
        return await this.request('/api/exportar', { isDownload: true });
    },

    async agregarObjetivoManual(idUsuario) {
        return await this.request('/api/objetivos/manual', {
            method: 'POST',
            body: JSON.stringify({ id: idUsuario })
        });
    },

    async importarMatriz(jsonData) {
        return await this.request('/api/objetivos/importar', {
            method: 'POST',
            body: JSON.stringify({ matriz: jsonData })
        });
    }
};
