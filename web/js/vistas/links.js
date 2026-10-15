'use strict';

/* ==========================================================================
   VISTA: RADAR DE ALIANZAS (CON CACHÉ DE INVITACIONES Y CONTROL RATE-LIMIT)
   Archivo: js/vistas/links.js
   ========================================================================== */

window.C4ISR_Views = window.C4ISR_Views || {};

// Caché persistente de sesión para no consultar el mismo código de invitación dos veces a Discord
const inviteResolutionCache = new Map();

function formatearFechaReal(dateString) {
    if (!dateString) return 'Fecha desconocida';
    const d = new Date(dateString);
    if (Number.isNaN(d.getTime())) return String(dateString);

    const ahora = new Date();
    const hora = d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });

    if (d.toDateString() === ahora.toDateString()) {
        return `Hoy a las ${hora}`;
    }
    return `${d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' })} ${hora}`;
}

function sanitizarUrlExterna(urlRaw) {
    try {
        const str = String(urlRaw || '').trim();
        const conProtocolo = /^https?:\/\//i.test(str) ? str : `https://${str}`;
        const parsed = new URL(conProtocolo);
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
            return parsed.href;
        }
        return '#';
    } catch (_) {
        return '#';
    }
}

window.C4ISR_Views.links = {
    fullData: [],
    filteredData: [],
    currentPage: 1,
    pageSize: 16,
    isMounted: false,

    async render(container) {
        this.isMounted = true;
        container.innerHTML = `
            <div class="panel-header" style="margin-bottom: 1.15rem;">
                <div>
                    <span class="panel-title" style="font-size: 1.1rem; color: var(--accent-rz);">RADAR DE ALIANZAS Y VECTORES DE PROMOCIÓN</span>
                    <span id="links-count-badge" class="badge badge-amber" style="margin-left: 0.75rem;">0 ENLACES</span>
                </div>
            </div>

            <div class="toolbar-tactical" style="margin-bottom: 1.35rem;">
                <input type="text" id="links-search" class="search-input" placeholder="🔍 Filtrar por servidor, mensaje o código de invitación..." autocomplete="off">
                <div style="display: flex; gap: 0.75rem; align-items: center;">
                    <button id="btn-prev-link" class="btn-action" type="button">◀ ANTERIOR</button>
                    <span id="link-page-indicator" style="font-family: var(--font-mono); color: var(--text-secondary); font-size: 0.8rem; min-width: 90px; text-align: center;">PÁG 1 / 1</span>
                    <button id="btn-next-link" class="btn-action" type="button">SIGUIENTE ▶</button>
                </div>
            </div>

            <div class="links-grid" id="links-container">
                <div style="grid-column: 1 / -1; padding: 2rem; color: var(--text-muted); font-family: var(--font-mono);">
                    [ SISTEMA ] Analizando vectores de invitación interceptados...
                </div>
            </div>
        `;

        try {
            const datos = await window.C4ISR_API.getDatosGlobales();
            this.fullData = Array.isArray(datos.links) ? datos.links : [];
            this.fullData.sort((a, b) => new Date(b.fecha || 0) - new Date(a.fecha || 0));
            this.filteredData = [...this.fullData];

            this.bindEvents();
            this.renderPage();
        } catch (error) {
            const linksContainer = document.getElementById('links-container');
            if (linksContainer) {
                linksContainer.innerHTML = `
                    <div class="login-error" style="grid-column: 1 / -1; display: block;">
                        [!] PÉRDIDA DE CONEXIÓN CON EL SERVIDOR CENTRAL.
                    </div>`;
            }
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
                    String(link.serverName || '').toLowerCase().includes(term) ||
                    String(link.mensaje || '').toLowerCase().includes(term) ||
                    String(link.url || '').toLowerCase().includes(term)
                );
                this.currentPage = 1;
                this.renderPage();
            });
        }

        if (btnPrev) {
            btnPrev.addEventListener('click', () => {
                if (this.currentPage > 1) {
                    this.currentPage--;
                    this.renderPage();
                }
            });
        }

        if (btnNext) {
            btnNext.addEventListener('click', () => {
                const maxPage = Math.max(1, Math.ceil(this.filteredData.length / this.pageSize));
                if (this.currentPage < maxPage) {
                    this.currentPage++;
                    this.renderPage();
                }
            });
        }
    },

    renderPage() {
        const container = document.getElementById('links-container');
        const indicator = document.getElementById('link-page-indicator');
        const countBadge = document.getElementById('links-count-badge');
        if (!container) return;

        if (countBadge) {
            countBadge.textContent = `${this.filteredData.length} VECTOR(ES)`;
        }

        if (this.filteredData.length === 0) {
            container.innerHTML = `
                <div style="grid-column: 1 / -1; padding: 2.5rem; text-align: center; border: 1px dashed rgba(255, 42, 109, 0.3); border-radius: var(--radius-md); background: var(--bg-surface);">
                    <div style="color: var(--text-muted); font-family: var(--font-mono);">EL RADAR NO REGISTRA VECTORES DE INVITACIÓN PARA ESTE FILTRO.</div>
                </div>`;
            if (indicator) indicator.textContent = 'PÁG 0 / 0';
            return;
        }

        const maxPage = Math.max(1, Math.ceil(this.filteredData.length / this.pageSize));
        if (this.currentPage > maxPage) this.currentPage = maxPage;
        if (indicator) indicator.textContent = `PÁG ${this.currentPage} / ${maxPage}`;

        const start = (this.currentPage - 1) * this.pageSize;
        const paginatedData = this.filteredData.slice(start, start + this.pageSize);

        container.innerHTML = paginatedData.map((link, index) => {
            const cardId = `link-card-${this.currentPage}-${index}`;
            const serverName = DOMPurify.sanitize(String(link.serverName || 'Sector Desconocido'));
            const description = DOMPurify.sanitize(String(link.mensaje || '[ SIN CONTEXTO INTERCEPTADO ]'));
            const hrefSeguro = sanitizarUrlExterna(link.url);
            const urlTexto = DOMPurify.sanitize(String(link.url || 'N/A'));
            const targetId = DOMPurify.sanitize(String(link.id || ''));
            const dateStr = formatearFechaReal(link.fecha);

            const inviteMatch = String(link.url || '').match(/(?:discord\.(?:gg|io|me|li)\/|discordapp\.com\/invite\/|discord\.com\/invite\/)([a-zA-Z0-9-]+)/i);
            const inviteCode = inviteMatch ? inviteMatch[1] : '';

            return `
                <div class="link-card" id="${cardId}" data-code="${DOMPurify.sanitize(inviteCode)}" data-fallback="${serverName}">
                    <button class="btn-delete-card delete-link-btn" data-id="${targetId}" type="button" title="Purgar expediente del emisor">✖</button>

                    <div class="card-api-header" style="display: flex; align-items: center; gap: 0.8rem; margin-bottom: 0.85rem; border-bottom: var(--border-subtle); padding-bottom: 0.8rem; padding-right: 1.2rem;">
                        <div class="card-icon-container" style="flex-shrink: 0;">
                            <div style="width: 38px; height: 38px; border-radius: 50%; border: 1px dashed var(--text-muted); display: flex; align-items: center; justify-content: center; background: var(--bg-input); color: var(--text-muted); font-family: var(--font-mono); font-size: 0.8rem;">?</div>
                        </div>
                        <div style="overflow: hidden; width: 100%;">
                            <div class="card-title-text" style="font-size: 0.92rem; font-weight: 600; color: var(--text-main); text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">
                                ${serverName}
                            </div>
                            <div class="card-status-text" style="font-size: 0.7rem; color: var(--accent-amber); font-family: var(--font-mono); margin-top: 2px;">
                                VERIFICANDO INVITACIÓN...
                            </div>
                        </div>
                    </div>

                    <div class="discord-mock" style="margin-bottom: 0.85rem; max-height: 110px; overflow-y: auto;">
                        <div class="discord-mock-body" style="font-size: 0.78rem;">${description}</div>
                    </div>

                    <div class="card-actions-container">
                        <div style="background: var(--bg-input); border: var(--border-subtle); padding: 0.45rem 0.6rem; border-radius: var(--radius-sm); margin-bottom: 0.75rem; font-family: var(--font-mono); font-size: 0.74rem; text-align: center; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                            <a href="${hrefSeguro}" target="_blank" rel="noopener noreferrer" style="color: var(--accent-info); text-decoration: none;">${urlTexto}</a>
                        </div>
                    </div>

                    <div style="font-family: var(--font-mono); font-size: 0.68rem; color: var(--text-muted); text-align: right;">
                        ${dateStr}
                    </div>
                </div>
            `;
        }).join('');

        this.bindDeleteEvents();
        this.hydrateAllCardsThrottled();
    },

    bindDeleteEvents() {
        document.querySelectorAll('#links-container .delete-link-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const targetId = e.currentTarget.getAttribute('data-id');
                if (!targetId) return;

                const confirmar = window.confirm(`[ ADVERTENCIA ]\nEliminar esta tarjeta purgará el expediente del usuario emisor (UID: ${targetId}). ¿Desea continuar?`);
                if (!confirmar) return;

                try {
                    await window.C4ISR_API.eliminarInfractor(targetId);
                    this.fullData = this.fullData.filter(i => String(i.id) !== targetId);
                    this.filteredData = this.filteredData.filter(i => String(i.id) !== targetId);
                    this.renderPage();
                } catch (err) {
                    alert('[!] Error al intentar purgar el registro.');
                }
            });
        });
    },

    /**
     * Resuelve las invitaciones de Discord usando caché en memoria y limitando las llamadas de red
     * para evitar bloqueos HTTP 429 en el navegador del analista.
     */
    async hydrateAllCardsThrottled() {
        const cards = Array.from(document.querySelectorAll('#links-container .link-card'));

        for (const card of cards) {
            if (!this.isMounted) return;

            const code = card.getAttribute('data-code');
            const fallbackName = card.getAttribute('data-fallback');
            const cardId = card.id;

            if (!code) {
                this.updateCardUI(cardId, { error: true, reason: 'ENLACE EXTERNO / SIN CÓDIGO', fallbackName });
                continue;
            }

            if (inviteResolutionCache.has(code)) {
                this.updateCardUI(cardId, inviteResolutionCache.get(code));
                continue;
            }

            const resultado = await this.resolveDiscordInvite(code, fallbackName);
            inviteResolutionCache.set(code, resultado);
            this.updateCardUI(cardId, resultado);

            // Pausa de 220ms entre llamadas nuevas a la API de Discord para evitar Rate Limit
            await new Promise(r => setTimeout(r, 220));
        }
    },

    async resolveDiscordInvite(code, fallbackName) {
        try {
            const response = await fetch(`https://discord.com/api/v9/invites/${encodeURIComponent(code)}?with_counts=true`);
            if (response.ok) {
                const data = await response.json();
                return { success: true, data };
            }
            if (response.status === 429) {
                return { error: true, reason: 'RATE LIMIT API DISCORD', fallbackName };
            }
            return { error: true, reason: 'INVITACIÓN EXPIRADA', fallbackName };
        } catch (_) {
            return { error: true, reason: 'SIN RESPUESTA DE RED', fallbackName };
        }
    },

    updateCardUI(cardId, result) {
        const card = document.getElementById(cardId);
        if (!card) return;

        const iconContainer = card.querySelector('.card-icon-container');
        const titleText = card.querySelector('.card-title-text');
        const statusText = card.querySelector('.card-status-text');
        const actionsContainer = card.querySelector('.card-actions-container');

        if (result.success && result.data?.guild) {
            const guild = result.data.guild;
            const iconUrl = guild.icon
                ? `https://cdn.discordapp.com/icons/${encodeURIComponent(guild.id)}/${encodeURIComponent(guild.icon)}.png?size=64`
                : 'https://cdn.discordapp.com/embed/avatars/0.png';

            iconContainer.innerHTML = `<img src="${iconUrl}" alt="Icono" style="width: 38px; height: 38px; border-radius: 50%; border: 2px solid var(--accent-green); object-fit: cover;">`;
            titleText.textContent = guild.name;

            const members = result.data.approximate_member_count ?? 'N/A';
            statusText.innerHTML = `<span style="color: var(--accent-green);">● ACTIVO</span> • ${members} MIEMBROS`;
        } else {
            statusText.innerHTML = `<span style="color: var(--accent-red);">[!] ${DOMPurify.sanitize(result.reason || 'CADUCADA')}</span>`;
            const searchTerm = encodeURIComponent(result.fallbackName && result.fallbackName !== 'Sector Desconocido' ? result.fallbackName : 'discord');

            if (!actionsContainer.querySelector('.fallback-search-links')) {
                const fallbackButtons = `
                    <div class="fallback-search-links" style="display: flex; gap: 0.5rem; margin-bottom: 0.65rem;">
                        <a href="https://disboard.org/search?keyword=${searchTerm}" target="_blank" rel="noopener noreferrer" class="btn-action" style="flex: 1; text-align: center; text-decoration: none; font-size: 0.7rem;">🔍 DISBOARD</a>
                        <a href="https://top.gg/servers/search?q=${searchTerm}" target="_blank" rel="noopener noreferrer" class="btn-action" style="flex: 1; text-align: center; text-decoration: none; font-size: 0.7rem;">🔍 TOP.GG</a>
                    </div>
                `;
                actionsContainer.insertAdjacentHTML('beforeend', fallbackButtons);
            }
        }
    },

    destroy() {
        this.isMounted = false;
        this.fullData = [];
        this.filteredData = [];
    }
};
