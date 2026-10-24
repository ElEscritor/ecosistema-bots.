'use strict';

/* ==========================================================================
   VISTA: RADAR DIPLOMATICO DE ALIANZAS E INFILTRACION v4.0
   Archivo: js/vistas/links.js
   ========================================================================== */

window.C4ISR_Views = window.C4ISR_Views || {};

const inviteResolutionCache = new Map();

function formatearFechaReal(dateString) {
    if (!dateString) return 'Sin fecha';
    const d = new Date(dateString);
    if (Number.isNaN(d.getTime())) return String(dateString);
    const ahora = new Date();
    const hora = d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    if (d.toDateString() === ahora.toDateString()) {
        return `Hoy ${hora}`;
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
    filterMode: 'ALL', // 'ALL' | 'VALID' | 'UNINFILTRATED' | 'INFILTRATED' | 'EXPIRED'
    searchTerm: '',
    currentPage: 1,
    pageSize: 16,
    isMounted: false,

    async render(container) {
        this.isMounted = true;
        container.innerHTML = `
            <style>
                .ally-filter-bar {
                    display: flex;
                    gap: 0.45rem;
                    flex-wrap: wrap;
                }
                .ally-pill {
                    background: rgba(255, 255, 255, 0.03);
                    border: 1px solid rgba(255, 255, 255, 0.12);
                    color: var(--text-secondary);
                    font-family: var(--font-mono);
                    font-size: 0.71rem;
                    padding: 0.38rem 0.75rem;
                    border-radius: 5px;
                    cursor: pointer;
                    transition: all 0.14s ease;
                }
                .ally-pill.active, .ally-pill:hover {
                    background: rgba(0, 240, 255, 0.15);
                    border-color: #00f0ff;
                    color: #ffffff;
                }
                .diplomatic-card {
                    background: rgba(20, 17, 29, 0.92);
                    border: 1px solid rgba(255, 255, 255, 0.08);
                    border-top: 2px solid #c084fc;
                    border-radius: var(--radius-md);
                    padding: 1rem 1.1rem;
                    position: relative;
                    display: flex;
                    flex-direction: column;
                    justify-content: space-between;
                    transition: transform 0.16s ease, border-color 0.16s ease;
                }
                .diplomatic-card:hover {
                    transform: translateY(-2px);
                    border-color: rgba(192, 132, 252, 0.45);
                }
                .diplomatic-route {
                    font-family: var(--font-mono);
                    font-size: 0.7rem;
                    color: #c084fc;
                    background: rgba(192, 132, 252, 0.08);
                    border: 1px solid rgba(192, 132, 252, 0.25);
                    padding: 4px 8px;
                    border-radius: 4px;
                    margin-bottom: 0.75rem;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }
                .template-drawer {
                    margin-top: 0.5rem;
                    margin-bottom: 0.75rem;
                    padding: 0.6rem 0.75rem;
                    background: rgba(9, 8, 12, 0.85);
                    border: 1px solid rgba(255, 255, 255, 0.07);
                    border-radius: 4px;
                    max-height: 150px;
                    overflow-y: auto;
                    font-size: 0.76rem;
                    color: var(--text-secondary);
                    white-space: pre-wrap;
                    word-break: break-word;
                }
            </style>

            <div class="panel-header" style="margin-bottom: 0.9rem;">
                <div style="display: flex; align-items: center; gap: 0.65rem; flex-wrap: wrap;">
                    <span class="panel-title" style="font-size: 1.05rem; color: var(--accent-rz);">RADAR DIPLOMATICO DE ALIANZAS // VECTORES DE INFILTRACION</span>
                    <span id="links-count-badge" class="badge badge-amber">0 VECTORES</span>
                </div>
                <div class="ally-filter-bar">
                    <button class="ally-pill active" data-mode="ALL" type="button">TODOS</button>
                    <button class="ally-pill" data-mode="VALID" type="button">ACTIVOS (ONLINE)</button>
                    <button class="ally-pill" data-mode="UNINFILTRATED" type="button" title="Servidores activos donde aun no tienes ningun token explorador dentro">OBJETIVOS NO INFILTRADOS</button>
                    <button class="ally-pill" data-mode="INFILTRATED" type="button">YA INFILTRADOS</button>
                    <button class="ally-pill" data-mode="EXPIRED" type="button">CADUCADOS</button>
                </div>
            </div>

            <div class="toolbar-tactical" style="margin-bottom: 1.15rem; padding: 0.65rem 1rem;">
                <input type="text" id="links-search" class="search-input" style="width: 360px;" placeholder="Filtrar por servidor destino, servidor origen, emisor o codigo..." autocomplete="off">
                <div style="display: flex; gap: 0.65rem; align-items: center;">
                    <button id="btn-prev-link" class="btn-action" type="button">&larr; ANTERIOR</button>
                    <span id="link-page-indicator" style="font-family: var(--font-mono); color: var(--text-secondary); font-size: 0.78rem; min-width: 85px; text-align: center;">PAG 1 / 1</span>
                    <button id="btn-next-link" class="btn-action" type="button">SIGUIENTE &rarr;</button>
                </div>
            </div>

            <div class="links-grid" id="links-container">
                <div style="grid-column: 1 / -1; padding: 2rem; color: var(--text-muted); font-family: var(--font-mono);">
                    [ SISTEMA ] Sincronizando rutas diplomaticas e invitaciones...
                </div>
            </div>
        `;

        try {
            const datos = await window.C4ISR_API.getDatosGlobales();
            this.fullData = Array.isArray(datos.links) ? datos.links : [];
            this.fullData.sort((a, b) => new Date(b.fecha || 0) - new Date(a.fecha || 0));
            this.bindEvents();
            this.applyFilters();
        } catch (_) {
            const linksContainer = document.getElementById('links-container');
            if (linksContainer) {
                linksContainer.innerHTML = `
                    <div class="login-error" style="grid-column: 1 / -1; display: block;">
                        [!] PERDIDA DE CONEXION CON EL SERVIDOR CENTRAL.
                    </div>`;
            }
        }
    },

    applyFilters() {
        this.filteredData = this.fullData.filter(link => {
            if (this.filterMode === 'VALID' && link.status !== 'VALID') return false;
            if (this.filterMode === 'UNINFILTRATED' && (link.infiltrado || link.status === 'EXPIRED')) return false;
            if (this.filterMode === 'INFILTRATED' && !link.infiltrado) return false;
            if (this.filterMode === 'EXPIRED' && link.status !== 'EXPIRED') return false;

            if (this.searchTerm) {
                const sName = String(link.serverName || '').toLowerCase();
                const oName = String(link.origenName || '').toLowerCase();
                const emisor = String(link.emisorTag || '').toLowerCase();
                const urlStr = String(link.url || '').toLowerCase();
                return sName.includes(this.searchTerm) ||
                    oName.includes(this.searchTerm) ||
                    emisor.includes(this.searchTerm) ||
                    urlStr.includes(this.searchTerm);
            }
            return true;
        });

        this.currentPage = 1;
        this.renderPage();
    },

    bindEvents() {
        const searchInput = document.getElementById('links-search');
        const btnPrev = document.getElementById('btn-prev-link');
        const btnNext = document.getElementById('btn-next-link');

        document.querySelectorAll('.ally-pill').forEach(pill => {
            pill.addEventListener('click', () => {
                document.querySelectorAll('.ally-pill').forEach(p => p.classList.remove('active'));
                pill.classList.add('active');
                this.filterMode = pill.getAttribute('data-mode') || 'ALL';
                this.applyFilters();
            });
        });

        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                this.searchTerm = e.target.value.toLowerCase().trim();
                this.applyFilters();
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
                    <div style="color: var(--text-muted); font-family: var(--font-mono);">NO SE REGISTRAN VECTORES DE ALIANZA PARA ESTE FILTRO.</div>
                </div>`;
            if (indicator) indicator.textContent = 'PAG 0 / 0';
            return;
        }

        const maxPage = Math.max(1, Math.ceil(this.filteredData.length / this.pageSize));
        if (this.currentPage > maxPage) this.currentPage = maxPage;
        if (indicator) indicator.textContent = `PAG ${this.currentPage} / ${maxPage}`;

        const start = (this.currentPage - 1) * this.pageSize;
        const paginatedData = this.filteredData.slice(start, start + this.pageSize);

        container.innerHTML = paginatedData.map((link, index) => {
            const cardId = `link-card-${this.currentPage}-${index}`;
            const serverName = DOMPurify.sanitize(String(link.serverName || 'Servidor Promocionado'));
            const origenName = DOMPurify.sanitize(String(link.origenName || 'Sector Desconocido'));
            const emisorTag = DOMPurify.sanitize(String(link.emisorTag || 'Representante'));
            const description = DOMPurify.sanitize(String(link.mensaje || '[ Sin plantilla adjunta ]'));
            const hrefSeguro = sanitizarUrlExterna(link.url);
            const urlTexto = DOMPurify.sanitize(String(link.url || 'N/A'));
            const targetId = DOMPurify.sanitize(String(link.id || ''));
            const dateStr = formatearFechaReal(link.fecha);

            const inviteMatch = String(link.url || '').match(/(?:discord\.(?:gg|io|me|li)\/|discordapp\.com\/invite\/|discord\.com\/invite\/)([a-zA-Z0-9-]+)/i);
            const inviteCode = link.code || (inviteMatch ? inviteMatch[1] : '');

            const iconHtml = link.icon
                ? `<img src="${DOMPurify.sanitize(link.icon)}" alt="Icon" style="width: 42px; height: 42px; border-radius: 50%; border: 2px solid var(--accent-green); object-fit: cover;">`
                : `<div style="width: 42px; height: 42px; border-radius: 50%; border: 1px dashed var(--text-muted); display: flex; align-items: center; justify-content: center; background: var(--bg-input); color: #c084fc; font-family: var(--font-mono); font-weight: 700;">&#11042;</div>`;

            let statusHtml = `<span style="color: var(--accent-amber);">VERIFICANDO...</span>`;
            if (link.status === 'VALID') {
                statusHtml = `<span style="color: var(--accent-green);">&#9679; ACTIVO</span> &bull; ${link.memberCount || 'N/A'} MIEMBROS`;
            } else if (link.status === 'EXPIRED') {
                statusHtml = `<span style="color: var(--accent-red);">[!] INVITACION CADUCADA</span>`;
            }

            const infiltradoBadge = link.infiltrado
                ? `<span class="badge badge-green" style="font-size:0.62rem;">YA INFILTRADO</span>`
                : `<span class="badge badge-amber" style="font-size:0.62rem;">NO INFILTRADO</span>`;

            return `
                <div class="diplomatic-card" id="${cardId}" data-code="${DOMPurify.sanitize(inviteCode)}" data-status="${DOMPurify.sanitize(link.status || 'PENDING')}" data-fallback="${serverName}">
                    <div>
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.55rem;">
                            ${infiltradoBadge}
                            <button class="btn-delete-card dismiss-link-btn" data-code="${DOMPurify.sanitize(inviteCode)}" type="button" title="Ocultar esta tarjeta de alianza (No borra el expediente del usuario)" style="position: static; font-size: 0.95rem;">&#10005;</button>
                        </div>

                        <div class="card-api-header" style="display: flex; align-items: center; gap: 0.8rem; margin-bottom: 0.7rem;">
                            <div class="card-icon-container" style="flex-shrink: 0;">${iconHtml}</div>
                            <div style="overflow: hidden; width: 100%;">
                                <div class="card-title-text" style="font-size: 0.94rem; font-weight: 700; color: var(--text-main); text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">
                                    ${serverName}
                                </div>
                                <div class="card-status-text" style="font-size: 0.69rem; font-family: var(--font-mono); margin-top: 2px;">
                                    ${statusHtml}
                                </div>
                            </div>
                        </div>

                        <div class="diplomatic-route" title="Capturado en ${origenName}">
                            ORIGEN: <strong>${origenName}</strong>
                        </div>

                        <div style="display: flex; justify-content: space-between; align-items: center; font-family: var(--font-mono); font-size: 0.7rem; color: var(--text-secondary); margin-bottom: 0.65rem;">
                            <span>EMISOR: <strong class="btn-open-issuer" data-uid="${targetId}" style="color: #00f0ff; cursor: pointer; text-decoration: underline;">${emisorTag}</strong></span>
                            <button class="btn-toggle-template eve-icon-btn" type="button" style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.12);color:var(--text-secondary);padding:2px 6px;border-radius:4px;font-family:var(--font-mono);font-size:0.65rem;cursor:pointer;">PLANTILLA &#9662;</button>
                        </div>

                        <div class="template-drawer hidden">${description}</div>
                    </div>

                    <div>
                        <div style="display: flex; gap: 0.4rem; margin-bottom: 0.5rem;">
                            <a href="${hrefSeguro}" target="_blank" rel="noopener noreferrer" class="btn-action" style="flex: 1; text-align: center; text-decoration: none; font-size: 0.72rem; border-color: #00f0ff; color: #00f0ff;">ABRIR INVITE</a>
                            <button class="btn-action btn-copy-invite" data-url="${hrefSeguro}" type="button" style="font-size: 0.72rem;">COPIAR</button>
                            <button class="btn-action btn-map-server" data-name="${serverName}" type="button" title="Buscar en Mapa Estelar" style="font-size: 0.72rem;">&#9678;</button>
                        </div>
                        <div style="display: flex; justify-content: space-between; font-family: var(--font-mono); font-size: 0.66rem; color: var(--text-muted);">
                            <span>${urlTexto.replace(/^https?:\/\//i, '')}</span>
                            <span>${dateStr}</span>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        this.bindCardActions();
        this.hydratePendingCardsOnly();
    },

    bindCardActions() {
        // 1. Ocultar tarjeta de forma NO destructiva (Conserva intacto el expediente del usuario)
        document.querySelectorAll('#links-container .dismiss-link-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const code = e.currentTarget.getAttribute('data-code');
                if (!code) return;
                try {
                    await window.C4ISR_API.ocultarInvitacion(code);
                    this.fullData = this.fullData.filter(i => String(i.code || '').toLowerCase() !== code.toLowerCase());
                    this.applyFilters();
                } catch (_) {}
            });
        });

        // 2. Desplegar / Plegar plantilla promocional
        document.querySelectorAll('#links-container .btn-toggle-template').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const card = e.currentTarget.closest('.diplomatic-card');
                const drawer = card?.querySelector('.template-drawer');
                if (drawer) drawer.classList.toggle('hidden');
            });
        });

        // 3. Copiar enlace al portapapeles
        document.querySelectorAll('#links-container .btn-copy-invite').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const url = e.currentTarget.getAttribute('data-url');
                const el = e.currentTarget;
                if (url && navigator.clipboard) {
                    navigator.clipboard.writeText(url);
                    el.textContent = 'COPIADO';
                    setTimeout(() => { el.textContent = 'COPIAR'; }, 900);
                }
            });
        });

        // 4. Saltar al expediente del usuario emisor
        document.querySelectorAll('#links-container .btn-open-issuer').forEach(el => {
            el.addEventListener('click', (e) => {
                const uid = e.currentTarget.getAttribute('data-uid');
                if (uid) {
                    window.C4ISR_TARGET_OVERRIDE = uid;
                    window.AppController.navigate('expedientes');
                }
            });
        });

        // 5. Localizar servidor en el Mapa Estelar
        document.querySelectorAll('#links-container .btn-map-server').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const sName = e.currentTarget.getAttribute('data-name');
                if (sName && window.C4ISR_Views.red) {
                    window.C4ISR_Views.red.searchTerm = sName.toLowerCase();
                    window.AppController.navigate('red');
                }
            });
        });
    },

    /**
     * Solo consulta al navegador aquellas tarjetas cuyo estado siga en PENDING o UNKNOWN,
     * porque las ya resueltas por el backend vienen listas en 0ms.
     */
    async hydratePendingCardsOnly() {
        const cards = Array.from(document.querySelectorAll('#links-container .diplomatic-card'));
        for (const card of cards) {
            if (!this.isMounted) return;
            const currentStatus = card.getAttribute('data-status');
            if (currentStatus === 'VALID' || currentStatus === 'EXPIRED') continue;

            const code = card.getAttribute('data-code');
            const fallbackName = card.getAttribute('data-fallback');
            if (!code) continue;

            if (inviteResolutionCache.has(code)) {
                this.updateCardUI(card.id, inviteResolutionCache.get(code));
                continue;
            }

            const resultado = await this.resolveDiscordInvite(code, fallbackName);
            inviteResolutionCache.set(code, resultado);
            this.updateCardUI(card.id, resultado);
            await new Promise(r => setTimeout(r, 260));
        }
    },

    async resolveDiscordInvite(code, fallbackName) {
        try {
            const response = await fetch(`https://discord.com/api/v9/invites/${encodeURIComponent(code)}?with_counts=true`);
            if (response.ok) {
                const data = await response.json();
                return { success: true, data };
            }
            return { error: true, reason: 'INVITACION CADUCADA', fallbackName };
        } catch (_) {
            return { error: true, reason: 'SIN RESPUESTA', fallbackName };
        }
    },

    updateCardUI(cardId, result) {
        const card = document.getElementById(cardId);
        if (!card) return;
        const iconContainer = card.querySelector('.card-icon-container');
        const titleText = card.querySelector('.card-title-text');
        const statusText = card.querySelector('.card-status-text');

        if (result.success && result.data?.guild) {
            const guild = result.data.guild;
            const iconUrl = guild.icon
                ? `https://cdn.discordapp.com/icons/${encodeURIComponent(guild.id)}/${encodeURIComponent(guild.icon)}.png?size=64`
                : 'https://cdn.discordapp.com/embed/avatars/0.png';

            iconContainer.innerHTML = `<img src="${iconUrl}" alt="Icono" style="width: 42px; height: 42px; border-radius: 50%; border: 2px solid var(--accent-green); object-fit: cover;">`;
            titleText.textContent = guild.name;
            const members = result.data.approximate_member_count ?? 'N/A';
            statusText.innerHTML = `<span style="color: var(--accent-green);">&#9679; ACTIVO</span> &bull; ${members} MIEMBROS`;
        } else {
            statusText.innerHTML = `<span style="color: var(--accent-red);">[!] ${DOMPurify.sanitize(result.reason || 'CADUCADA')}</span>`;
        }
    },

    destroy() {
        this.isMounted = false;
        this.fullData = [];
        this.filteredData = [];
    }
};
