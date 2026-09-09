/* ==========================================================================
   VISTA: LINKSPORTAL (AUDITORÍA DE VECTORES DE PROMOCIÓN)
   Archivo: js/vistas/links.js
   Objetivo: Renderizar el grid de servidores capturados, logos y contextos
   ========================================================================== */

window.C4ISR_Views = window.C4ISR_Views || {};

window.C4ISR_Views.links = {
    async render(container) {
        // 1. Inyectar esqueleto base y contenedor Grid
        container.innerHTML = `
            <div class="panel-header" style="margin-bottom: 1.5rem;">
                <span class="panel-title" style="font-size: 1.2rem;">RADAR DE ALIANZAS Y PROMOCIÓN EXTERNA (LINKSPORTAL)</span>
            </div>
            
            <div class="links-grid" id="links-container">
                <div style="color: var(--accent-cyan); font-family: var(--font-mono);">[ SISTEMA ] ESCANEANDO VECTORES DE RED...</div>
            </div>
        `;

        try {
            // 2. Extraer datos globales desde la caché del servidor
            const datos = await C4ISR_API.getDatosGlobales();
            
            // 3. Renderizar las tarjetas
            this.renderLinks(datos.links || []);
        } catch (error) {
            console.error("[LinksPortal] Error al cargar red de alianzas:", error);
            const gridContainer = document.getElementById('links-container');
            if (gridContainer) {
                gridContainer.innerHTML = `<div class="login-error" style="display:block;">[!] ERROR CRÍTICO: PÉRDIDA DE CONEXIÓN CON EL ENJAMBRE.</div>`;
            }
        }
    },

    renderLinks(linksArray) {
        const container = document.getElementById('links-container');

        if (linksArray.length === 0) {
            container.innerHTML = `
                <div style="grid-column: 1 / -1; padding: 3rem; text-align: center; border: 1px dashed rgba(0, 229, 255, 0.3); background: var(--bg-panel);">
                    <div style="font-size: 2rem; margin-bottom: 1rem; opacity: 0.5;">🛰️</div>
                    <div style="color: var(--text-muted); font-family: var(--font-mono);">EL RADAR NO DETECTA VECTORES DE PROMOCIÓN ACTIVOS.</div>
                </div>
            `;
            return;
        }

        let tarjetasHTML = '';

        linksArray.forEach(link => {
            // Saneamiento estricto de todos los datos recibidos (Prevención XSS)
            // Adaptamos las variables según cómo el backend guarde los datos del servidor
            const serverName = DOMPurify.sanitize(link.serverName || link.servidor || 'SERVIDOR_DESCONOCIDO');
            const description = DOMPurify.sanitize(link.mensaje || link.descripcion || '[ SIN CONTEXTO INTERCEPTADO ]');
            const url = DOMPurify.sanitize(link.url || '#');
            const logoUrl = DOMPurify.sanitize(link.logo || link.icono || '');
            const date = DOMPurify.sanitize(link.fecha || 'FECHA_DESCONOCIDA');

            // Renderizado condicional del Logo (Fallback si no hay logo)
            const avatarHTML = logoUrl 
                ? `<img src="${logoUrl}" alt="Logo" style="width: 45px; height: 45px; border-radius: 50%; border: 1px solid var(--accent-cyan); object-fit: cover; background: var(--bg-absolute);" onerror="this.outerHTML='<div class=\\'fallback-logo\\'>?</div>'">`
                : `<div class="fallback-logo">?</div>`;

            // Construcción de la tarjeta
            tarjetasHTML += `
                <div class="link-card">
                    <!-- Cabecera de la Tarjeta (Logo + Nombre) -->
                    <div style="display: flex; align-items: center; gap: 1rem; margin-bottom: 1rem; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 1rem;">
                        <style>
                            .fallback-logo { width: 45px; height: 45px; border-radius: 50%; border: 1px dashed var(--text-muted); display: flex; align-items: center; justify-content: center; background: var(--bg-absolute); color: var(--text-muted); font-weight: bold; font-family: var(--font-mono); }
                        </style>
                        ${avatarHTML}
                        <div class="link-origin" style="margin: 0; font-size: 1rem; text-overflow: ellipsis; overflow: hidden; white-space: nowrap;" title="${serverName}">
                            ${serverName}
                        </div>
                    </div>
                    
                    <!-- Cuerpo: Contexto / Mensaje del servidor -->
                    <div style="color: var(--text-main); font-size: 0.85rem; margin-bottom: 1.5rem; max-height: 120px; overflow-y: auto; padding-right: 5px; font-family: var(--font-mono); line-height: 1.4;">
                        ${description}
                    </div>
                    
                    <!-- Pie: URL interceptada y Timestamp -->
                    <div class="link-url">
                        <a href="${url}" target="_blank" style="color: var(--accent-green); text-decoration: none; word-break: break-all;">
                            ${url}
                        </a>
                    </div>
                    
                    <div style="font-size: 0.75rem; color: var(--text-muted); text-align: right; margin-top: 1rem;">
                        CAPTURA: ${date}
                    </div>
                </div>
            `;
        });

        container.innerHTML = tarjetasHTML;
    },

    destroy() {
        // Limpieza de recursos al cambiar de vista (si los hubiera)
    }
};