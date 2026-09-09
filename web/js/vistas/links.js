/* ==========================================================================
   VISTA: LINKSPORTAL (AUDITORÍA DE VECTORES Y RESOLUCIÓN API DISCORD)
   Archivo: js/vistas/links.js
   ========================================================================== */
window.C4ISR_Views = window.C4ISR_Views || {};

window.C4ISR_Views.links = {
    fullData: [],

    async render(container) {
        container.innerHTML = `
            <div class="panel-header" style="margin-bottom: 1.5rem; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem;">
                <span class="panel-title" style="font-size: 1.2rem; color: var(--accent-cyan); text-shadow: var(--glow-cyan);">RADAR DE ALIANZAS Y VECTORES DE PROMOCIÓN</span>
            </div>

            <!-- Buscador Táctico -->
            <div class="toolbar-tactical" style="margin-bottom: 2rem;">
                <input type="text" id="links-search" class="search-input" style="width: 100%; max-width: 500px;" placeholder="🔍 Rastrear por nombre de servidor, palabra clave o código de enlace..." autocomplete="off">
            </div>
            
            <div class="links-grid" id="links-container">
                <div style="color: var(--accent-cyan); font-family: var(--font-mono);">[ SISTEMA ] OBTENIENDO VECTORES DESDE EL ENJAMBRE...</div>
            </div>
        `;

        try {
            const datos = await C4ISR_API.getDatosGlobales();
            this.fullData = datos.links || [];
            
            // Ordenar por fecha (más recientes primero)
            this.fullData.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
            
            this.bindEvents();
            this.renderLinks(this.fullData);
        } catch (error) {
            console.error("[LinksPortal] Error crítico:", error);
            document.getElementById('links-container').innerHTML = `<div class="login-error" style="display:block;">[!] PÉRDIDA DE CONEXIÓN CON LA BASE DE DATOS DE LA BIBLIOTECA.</div>`;
        }
    },

    bindEvents() {
        const searchInput = document.getElementById('links-search');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                const term = e.target.value.toLowerCase().trim();
                const filtrados = this.fullData.filter(link => 
                    (link.serverName && link.serverName.toLowerCase().includes(term)) ||
                    (link.mensaje && link.mensaje.toLowerCase().includes(term)) ||
                    (link.url && link.url.toLowerCase().includes(term))
                );
                this.renderLinks(filtrados);
            });
        }
    },

    renderLinks(linksArray) {
        const container = document.getElementById('links-container');

        if (linksArray.length === 0) {
            container.innerHTML = `
                <div style="grid-column: 1 / -1; padding: 3rem; text-align: center; border: 1px dashed rgba(0, 229, 255, 0.3); background: var(--bg-panel);">
                    <div style="color: var(--text-muted); font-family: var(--font-mono);">EL RADAR NO DETECTA COINCIDENCIAS.</div>
                </div>
            `;
            return;
        }

        let tarjetasHTML = '';

        linksArray.forEach((link, index) => {
            const cardId = `link-card-${index}`;
            const serverName = DOMPurify.sanitize(link.serverName || 'Sector Desconocido');
            const description = DOMPurify.sanitize(link.mensaje || '[ SIN CONTEXTO INTERCEPTADO ]');
            const urlRaw = DOMPurify.sanitize(link.url || '');
            const dateObj = new Date(link.fecha);
            const dateStr = !isNaN(dateObj) ? dateObj.toLocaleString('es-ES') : link.fecha;

            // Extracción del código de invitación para resolución API
            const inviteMatch = urlRaw.match(/(?:discord\.gg\/|discord\.com\/invite\/)([a-zA-Z0-9-]+)/i);
            const inviteCode = inviteMatch ? inviteMatch[1] : null;

            tarjetasHTML += `
                <div class="link-card" id="${cardId}" data-code="${inviteCode || ''}" data-fallback="${serverName}">
                    
                    <!-- Header Dinámico (A hidratar por la API) -->
                    <div class="card-api-header" style="display: flex; align-items: center; gap: 1rem; margin-bottom: 1rem; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 1rem;">
                        <div class="card-icon-container">
                            <div class="fallback-logo" style="width: 45px; height: 45px; border-radius: 50%; border: 1px dashed var(--text-muted); display: flex; align-items: center; justify-content: center; background: var(--bg-absolute); color: var(--text-muted); font-family: var(--font-mono);">?</div>
                        </div>
                        <div style="overflow: hidden;">
                            <div class="card-title-text" style="margin: 0; font-size: 1.1rem; font-weight: bold; color: var(--accent-cyan); text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">
                                ${serverName}
                            </div>
                            <div class="card-status-text" style="font-size: 0.75rem; color: var(--accent-amber); font-family: var(--font-mono);">
                                <span class="cursor-blink">_</span> ANALIZANDO VECTOR...
                            </div>
                        </div>
                    </div>
                    
                    <!-- Recreación Forense del Mensaje -->
                    <div class="discord-mock" style="margin-bottom: 1.5rem; background: #1e1f22; border-left: 2px solid var(--accent-cyan); padding: 0.8rem; max-height: 150px; overflow-y: auto;">
                        <div class="discord-mock-body" style="color: #dbdee1; font-size: 0.8rem;">${description}</div>
                    </div>
                    
                    <!-- Pie y Controles Operativos -->
                    <div class="card-actions-container">
                        <div style="background: rgba(0,0,0,0.5); padding: 0.5rem; border-radius: 4px; margin-bottom: 1rem; font-family: var(--font-mono); font-size: 0.8rem;">
                            <a href="${urlRaw}" target="_blank" style="color: var(--accent-green); text-decoration: none; word-break: break-all;">
                                ${urlRaw}
                            </a>
                        </div>
                    </div>
                    
                    <div style="font-size: 0.75rem; color: var(--text-muted); text-align: right;">
                        INTERCEPCIÓN: ${dateStr}
                    </div>
                </div>
            `;
        });

        container.innerHTML = tarjetasHTML;

        // Iniciar ráfaga asíncrona de hidratación (Discord API)
        this.hydrateAllCards();
    },

    hydrateAllCards() {
        const cards = document.querySelectorAll('.link-card');
        cards.forEach(card => {
            const code = card.getAttribute('data-code');
            const fallbackName = card.getAttribute('data-fallback');
            const cardId = card.id;

            if (code) {
                this.resolveDiscordInvite(code, cardId, fallbackName);
            } else {
                this.updateCardUI(cardId, { error: true, reason: 'No se detectó código de invitación.', fallbackName });
            }
        });
    },

    async resolveDiscordInvite(code, cardId, fallbackName) {
        try {
            // Interrogación a la API pública de Discord (CORS permitido por Discord para GET /invites)
            const response = await fetch(`https://discord.com/api/v9/invites/${code}?with_counts=true`);
            
            if (response.ok) {
                const data = await response.json();
                this.updateCardUI(cardId, { success: true, data });
            } else {
                this.updateCardUI(cardId, { error: true, reason: 'INVITACIÓN CADUCADA O REVOCADA', fallbackName });
            }
        } catch (error) {
            this.updateCardUI(cardId, { error: true, reason: 'FALLO DE RED API', fallbackName });
        }
    },

    updateCardUI(cardId, result) {
        const card = document.getElementById(cardId);
        if (!card) return;

        const iconContainer = card.querySelector('.card-icon-container');
        const titleText = card.querySelector('.card-title-text');
        const statusText = card.querySelector('.card-status-text');
        const actionsContainer = card.querySelector('.card-actions-container');

        if (result.success && result.data.guild) {
            // Éxito: La invitación está activa y el objetivo es real
            const guild = result.data.guild;
            const iconUrl = guild.icon 
                ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=128` 
                : 'https://cdn.discordapp.com/embed/avatars/0.png';

            iconContainer.innerHTML = `<img src="${iconUrl}" style="width: 45px; height: 45px; border-radius: 50%; border: 1px solid var(--accent-green); object-fit: cover;">`;
            titleText.textContent = guild.name;
            titleText.style.color = 'var(--text-main)';
            
            const members = result.data.approximate_member_count || 'N/A';
            statusText.innerHTML = `<span style="color: var(--accent-green);">● ACTIVO</span> | ${members} MIEMBROS`;
            
        } else {
            // Fallo/Caducado: Despliegue de herramientas de indexación OSINT alternativas
            statusText.innerHTML = `<span style="color: var(--accent-red);">[!] ${result.reason}</span>`;
            
            // Si el nombre del servidor es genérico o "Sector Desconocido", extraemos términos clave del propio HTML
            let searchTerm = encodeURIComponent(result.fallbackName !== 'Sector Desconocido' ? result.fallbackName : 'discord');

            // Inyectar Botones de Fallback
            const fallbackButtons = `
                <div style="display: flex; gap: 0.5rem; margin-bottom: 1rem; flex-wrap: wrap;">
                    <a href="https://disboard.org/search?keyword=${searchTerm}" target="_blank" class="btn-action" style="flex: 1; text-align: center; border-color: #248bf5; color: #248bf5; text-decoration: none;">
                        🔍 RASTREAR DISBOARD
                    </a>
                    <a href="https://top.gg/servers/search?q=${searchTerm}" target="_blank" class="btn-action" style="flex: 1; text-align: center; border-color: #ff3366; color: #ff3366; text-decoration: none;">
                        🔍 RASTREAR TOP.GG
                    </a>
                </div>
            `;
            
            // Anexar botones debajo de la caja de la URL
            actionsContainer.insertAdjacentHTML('beforeend', fallbackButtons);
        }
    },

    destroy() {
        this.fullData = [];
    }
};
