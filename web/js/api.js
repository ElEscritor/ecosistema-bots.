/* ==========================================================================
   MOTOR DE COMUNICACIÓN (API REST)
   Archivo: js/api.js
   ========================================================================== */

window.C4ISR_API = {
    sessionKey: null,

    getHeaders() {
        return {
            'Content-Type': 'application/json',
            'X-Auth-Key': this.sessionKey || ''
        };
    },

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
            if (!response.ok) throw new Error(`HTTP_ERROR_${response.status}`);
            if (options.isDownload) return await response.blob();
            return await response.json();
        } catch (error) {
            console.error(`[C4ISR_API] Error de red hacia ${endpoint}:`, error);
            throw error;
        }
    },

    async getDatosGlobales() { return await this.request('/api/datos'); },
    
    async guardarNota(idUsuario, contenidoNota) {
        return await this.request('/api/notas', { method: 'POST', body: JSON.stringify({ id: idUsuario, nota: contenidoNota }) });
    },
    
    async eliminarInfractor(idUsuario) {
        return await this.request('/api/eliminar', { method: 'POST', body: JSON.stringify({ id: idUsuario }) });
    },
    
    async exportarBaseDatos() {
        return await this.request('/api/exportar', { isDownload: true });
    },
    
    async agregarObjetivoManual(idUsuario) {
        return await this.request('/api/objetivos/manual', { method: 'POST', body: JSON.stringify({ id: idUsuario }) });
    },
    
    async importarMatriz(jsonData) {
        return await this.request('/api/objetivos/importar', { method: 'POST', body: JSON.stringify({ matriz: jsonData }) });
    }
};
