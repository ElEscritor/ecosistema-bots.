/* ==========================================================================
   VISTA: RADAR DE ALIANZAS (PAGINACIÓN Y GESTIÓN DE VECTORES)
   Archivo: js/vistas/links.js
   ========================================================================== */
window.C4ISR_Views = window.C4ISR_Views || {};

window.C4ISR_Views.links = {
    fullData: [],
    filteredData: [],
    currentPage: 1,
    pageSize: 20, // Fragmentación de la cuadrícula a 4-5 columnas

    async render(container) {
        container.innerHTML = `
            <div class="panel-header" style="margin-bottom: 1rem;">
                <span class="panel-title" style="font-size: 1.2rem; color: var(--accent-rz); text-shadow: var(--glow-rz);">RADAR DE ALIANZAS Y VECTORES DE PROMOCIÓN</span>
            </div>

            <div class="toolbar-tactical" style="margin-bottom: 1.5rem;">
                <input type="text" id="links-search" class="search-input" style="width: 100%; max-width: 400px;" placeholder="🔍 Rastrear servidor o código..." autocomplete="off">
                <div style="display:flex; gap: 1rem; align-items: center;">
                    <button id="btn-prev-link" class="btn-action">◀ ANTERIOR</button>
                    <span id="link-page-indicator" style="font-family: var(--font-mono); color: var(--accent-rz); font-weight: bold; min-width: 80px; text-align: center;">PÁG 1 / 1</span>
                    <button id="btn-next-link" class="btn-action">SIGUIENTE ▶</button>
                </div>
            </div>
            
            <div class="links-grid" id="links-container">
                <div style="color: var(--accent-rz); font-family: var(--font-mono);">[ SISTEMA ] OBTENIENDO VECTORES DESDE EL ENJAMBRE...</div>
            </div>
        `;

        try {
            const datos = await C4ISR_API.getDatosGlobales();
            this.fullData = datos.links || [];
            this.fullData.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
            this.filteredData = [...this.fullData];
            
            this.bindEvents();
            this.renderPage();
        } catch (error) {
            document.getElementById('links-container').innerHTML = `<div class="login-error" style="display:block;">[!] PÉRDIDA DE CONEXIÓN CON LA BIBLIOTECA.</div>`;
        }
    },

    bindEvents() {
        const searchInput = document.getElementById('links-search');
        const btnPrev = document.getElementById('btn-prev-link');
        const btnNext = document.getElementById('btn-next-link');

        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                const term = e.target.value.toLowerCase().trim();
                this.filteredData = this.fullData.filter(link => 
                    (link.serverName && link.serverName.toLowerCase().includes(term)) ||
                    (link.mensaje && link.mensaje.toLowerCase().includes(term)) ||
                    (link.url && link.url.toLowerCase().includes(term))
                );
                this.currentPage = 1;
                this.renderPage();
            });
        }

        if (btnPrev) {
            btnPrev.addEventListener('click', () => {
                if (this.currentPage > 1) { this.currentPage--; this.renderPage(); }
            });
        }

        if (btnNext) {
            btnNext.addEventListener('click', () => {
                const maxPage = Math.ceil(this.filteredData.length / this.pageSize);
                if (this.currentPage < maxPage) { this.currentPage++; this.renderPage(); }
            });
        }
    },

    renderPage() {
        const container = document.getElementById('links-container');
        const indicator = document.getElementById('link-page-indicator');

        if (this.filteredData.length === 0) {
            container.innerHTML = `
                <div style="grid-column: 1 / -1; padding: 2rem; text-align: center; border: 1px dashed rgba(255, 42, 109, 0.3); background: var(--bg-panel);">
                    <div style="color: var(--text-muted); font-family: var(--font-mono);">EL RADAR NO DETECTA COINCIDENCIAS.</div>
                </div>`;
            if(indicator) indicator.textContent = `PÁG 0 / 0`;
            return;
        }

        const maxPage = Math.ceil(this.filteredData.length / this.pageSize);
        if(indicator) indicator.textContent = `PÁG ${this.currentPage} / ${maxPage}`;

        const start = (this.currentPage - 1) * this.pageSize;
        const paginatedData = this.filteredData.slice(start, start + this.pageSize);

        let tarjetasHTML = '';

        paginatedData.forEach((link, index) => {
            const cardId = `link-card-${index}`;
            const serverName = DOMPurify.sanitize(link.serverName || 'Sector Desconocido');
            const description = DOMPurify.sanitize(link.mensaje || '[ SIN CONTEXTO INTERCEPTADO ]');
            const urlRaw = DOMPurify.sanitize(link.url || '');
            const targetId = DOMPurify.sanitize(link.id || '');
            
            const dateObj = new Date(link.fecha);
            const timeString = !isNaN(dateObj) ? dateObj.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) : '';
            const dateStr = !isNaN(dateObj) ? `Hoy a las ${timeString}` : link.fecha;

            const inviteMatch = urlRaw.match(/(?:discord\.gg\/|discord\.com\/invite\/)([a-zA-Z0-9-]+)/i);
            const inviteCode = inviteMatch ? inviteMatch[1] : null;

            tarjetasHTML += `
                <div class="link-card" id="${cardId}" data-code="${inviteCode || ''}" data-fallback="${serverName}">
                    <button class="btn-delete-card delete-link-btn" data-id="${targetId}" title="Purgar evidencia">✖</button>
                    
                    <div class="card-api-header" style="display: flex; align-items: center; gap: 0.8rem; margin-bottom: 0.8rem; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 0.8rem;">
                        <div class="card-icon-container">
                            <div class="fallback-logo" style="width: 35px; height: 35px; border-radius: 50%; border: 1px dashed var(--text-muted); display: flex; align-items: center; justify-content: center; background: var(--bg-absolute); color: var(--text-muted); font-size: 0.8rem;">?</div>
                        </div>
                        <div style="overflow: hidden; width: 100%;">
                            <div class="card-title-text" style="margin: 0; font-size: 0.95rem; font-weight: bold; color: var(--accent-rz); text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">
                                ${serverName}
                            </div>
                            <div class="card-status-text" style="font-size: 0.65rem; color: var(--accent-amber); font-family: var(--font-mono);">
                                <span class="cursor-blink">_</span> ANALIZANDO...
                            </div>
                        </div>
                    </div>
                    
                    <div class="discord-mock" style="margin-bottom: 1rem; padding: 0.5rem; max-height: 100px; overflow-y: auto;">
                        <div class="discord-mock-body" style="font-size: 0.75rem;">${description}</div>
                    </div>
                    
                    <div class="card-actions-container">
                        <div style="background: rgba(0,0,0,0.5); padding: 0.4rem; border-radius: 4px; margin-bottom: 0.8rem; font-family: var(--font-mono); font-size: 0.75rem; text-align: center;">
                            <a href="${urlRaw}" target="_blank" style="color: var(--accent-cyan); text-decoration: none; word-break: break-all;">${urlRaw}</a>
                        </div>
                    </div>
                    
                    <div style="font-size: 0.65rem; color: var(--text-muted); text-align: right;">INTERCEPCIÓN: ${dateStr}</div>
                </div>
            `;
        });

        container.innerHTML = tarjetasHTML;
        this.hydrateAllCards();
        this.bindDeleteEvents();
    },

    bindDeleteEvents() {
        document.querySelectorAll('.delete-link-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const targetId = e.target.getAttribute('data-id');
                if (!targetId) return;
                
                const confirmar = window.confirm(`[ ADVERTENCIA ]\nBorrar este enlace purgará el expediente completo del infractor (UID: ${targetId}). ¿Continuar?`);
                if (!confirmar) return;
                
                try {
                    await C4ISR_API.eliminarInfractor(targetId);
                    this.fullData = this.fullData.filter(i => i.id !== targetId);
                    this.filteredData = this.filteredData.filter(i => i.id !== targetId);
                    this.renderPage();
                } catch (err) {
                    alert("Fallo de conexión al intentar purgar el registro.");
                }
            });
        });
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
                this.updateCardUI(cardId, { error: true, reason: 'No se detectó código.', fallbackName });
            }
        });
    },

    async resolveDiscordInvite(code, cardId, fallbackName) {
        try {
            const response = await fetch(`https://discord.com/api/v9/invites/${code}?with_counts=true`);
            if (response.ok) {
                const data = await response.json();
                this.updateCardUI(cardId, { success: true, data });
            } else {
                this.updateCardUI(cardId, { error: true, reason: 'INVITACIÓN CADUCADA', fallbackName });
            }
        } catch (error) {
            this.updateCardUI(cardId, { error: true, reason: 'FALLO API', fallbackName });
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
            const guild = result.data.guild;
            const iconUrl = guild.icon 
                ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=64` 
                : 'https://cdn.discordapp.com/embed/avatars/0.png';

            iconContainer.innerHTML = `<img src="${iconUrl}" style="width: 35px; height: 35px; border-radius: 50%; border: 1px solid var(--accent-green); object-fit: cover;">`;
            titleText.textContent = guild.name;
            titleText.style.color = 'var(--text-main)';
            
            const members = result.data.approximate_member_count || 'N/A';
            statusText.innerHTML = `<span style="color: var(--accent-green);">● ACTIVO</span> | ${members} MIEMBROS`;
        } else {
            statusText.innerHTML = `<span style="color: var(--accent-red);">[!] ${result.reason}</span>`;
            let searchTerm = encodeURIComponent(result.fallbackName !== 'Sector Desconocido' ? result.fallbackName : 'discord');
            const fallbackButtons = `
                <div style="display: flex; gap: 0.5rem; margin-bottom: 0.5rem; flex-wrap: wrap;">
                    <a href="https://disboard.org/search?keyword=${searchTerm}" target="_blank" class="btn-action" style="flex: 1; text-align: center; border-color: #248bf5; color: #248bf5; text-decoration: none;">🔍 DISBOARD</a>
                    <a href="https://top.gg/servers/search?q=${searchTerm}" target="_blank" class="btn-action" style="flex: 1; text-align: center; border-color: #ff3366; color: #ff3366; text-decoration: none;">🔍 TOP.GG</a>
                </div>
            `;
            actionsContainer.insertAdjacentHTML('beforeend', fallbackButtons);
        }
    },

    destroy() {
        this.fullData = [];
    }
};
