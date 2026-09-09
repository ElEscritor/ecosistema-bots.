/* ==========================================================================
   MOTOR DE COMUNICACIÓN C4ISR (API REST)
   Archivo: js/api.js
   Objetivo: Enrutamiento HTTP, seguridad desacoplada y manejo de sesiones
   ========================================================================== */

const C4ISR_API = {
    sessionKey: null,

    getHeaders() {
        return {
            'Content-Type': 'application/json',
            'X-Auth-Key': this.sessionKey || ''
        };
    },

    // Nueva ruta de autenticación directa y aislada de la base de datos
    async authenticate(password) {
        try {
            const response = await fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ clave: password })
            });

            if (response.ok) {
                // Almacenamos la llave volátil para las siguientes peticiones tácticas
                this.sessionKey = password;
                return true;
            }
            
            // Si el servidor responde 403, la contraseña es genuinamente errónea
            return false;
            
        } catch (error) {
            console.error("[C4ISR_API] Fallo catastrófico de red en Auth:", error);
            throw new Error("El servidor central no responde. Revisa el estado del enjambre.");
        }
    },

    // Motor central de peticiones post-autenticación
    async request(endpoint, options = {}) {
        try {
            const config = {
                ...options,
                headers: {
                    ...this.getHeaders(),
                    ...options.headers
                }
            };

            const response = await fetch(endpoint, config);

            if (!response.ok) {
                if (response.status === 401 || response.status === 403) {
                    throw new Error("AUTH_FAILED");
                }
                throw new Error(`HTTP_ERROR_${response.status}`);
            }

            if (options.isDownload) {
                return await response.blob();
            }

            return await response.json();
        } catch (error) {
            console.error(`[C4ISR_API] Error de enlace al destino ${endpoint}:`, error);
            throw error;
        }
    },

    // Métodos operacionales del Panóptico
    async getDatosGlobales() {
        return await this.request('/api/datos');
    },

    async guardarNota(idUsuario, contenidoNota) {
        return await this.request('/api/notas', {
            method: 'POST',
            body: JSON.stringify({
                id: idUsuario,
                nota: contenidoNota
            })
        });
    },

    async eliminarInfractor(idUsuario) {
        return await this.request('/api/eliminar', {
            method: 'POST',
            body: JSON.stringify({
                id: idUsuario
            })
        });
    },

    async exportarBaseDatos() {
        return await this.request('/api/exportar', {
            isDownload: true
        });
    }
};
