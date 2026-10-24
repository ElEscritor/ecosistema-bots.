'use strict';

/* ==========================================================================
   VISTA: CENTRO DE MANDO Y TELEMETRIA C4ISR v5.0 (PANEL INTEGRAL + ENJAMBRE)
   Archivo: js/vistas/dashboard.js
   ========================================================================== */

window.C4ISR_Views = window.C4ISR_Views || {};

function formatearHaceCuanto(fechaIsoOTimestamp) {
    if (!fechaIsoOTimestamp) return 'Sin fecha';
    const ts = typeof fechaIsoOTimestamp === 'number' ? fechaIsoOTimestamp : Date.parse(fechaIsoOTimestamp);
    if (Number.isNaN(ts)) return 'Reciente';
    const seg = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (seg < 60) return 'Hace instantes';
    if (seg < 3600) return `Hace ${Math.floor(seg / 60)} min`;
    if (seg < 86400) return `Hace ${Math.floor(seg / 3600)} h`;
    return `Hace ${Math.floor(seg / 86400)} d`;
}

function limpiarTextoResumen(rawStr) {
    if (!rawStr || typeof rawStr !== 'string') return '[ Sin evidencia ]';
    if (rawStr.trim().startsWith('<div')) {
        return rawStr.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
    }
    return rawStr.replace(/\s+/g, ' ').trim().slice(0, 120);
}

window.C4ISR_Views.dashboard = {
    charts: { timeline: null, distribution: null },
    autoRefreshTimer: null,
    isMounted: false,

    async render(container) {
        this.isMounted = true;
        container.innerHTML = `
            <style>
                .swarm-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fill, minmax(310px, 1fr));
                    gap: 1rem;
                }
                .swarm-unit-card {
                    background: rgba(17, 15, 24, 0.92);
                    border: 1px solid rgba(255, 255, 255, 0.08);
                    border-top: 2px solid var(--accent-green);
                    border-radius: var(--radius-md);
                    padding: 1rem 1.1rem;
                    display: flex;
                    flex-direction: column;
                    gap: 0.75rem;
                    transition: transform 0.16s ease, border-color 0.16s ease, box-shadow 0.16s ease;
                }
                .swarm-unit-card:hover {
                    transform: translateY(-2px);
                    border-color: rgba(16, 185, 129, 0.45);
                    box-shadow: 0 10px 26px rgba(0, 0, 0, 0.55);
                }
                .swarm-unit-top {
                    display: flex;
                    align-items: center;
                    gap: 0.85rem;
                    min-width: 0;
                }
                .swarm-unit-meta {
                    min-width: 0;
                    flex: 1;
                }
                .swarm-unit-tag {
                    color: #ffffff;
                    font-weight: 700;
                    font-size: 0.96rem;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }
                .swarm-unit-uid {
                    color: var(--text-muted);
                    font-family: var(--font-mono);
                    font-size: 0.71rem;
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    margin-top: 2px;
                }
                .swarm-capacity-bar {
                    width: 100%;
                    height: 6px;
                    background: rgba(255, 255, 255, 0.07);
                    border-radius: 999px;
                    overflow: hidden;
                }
                .swarm-capacity-fill {
                    height: 100%;
                    border-radius: 999px;
                    transition: width 0.35s ease;
                }
                .swarm-unit-bottom {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    gap: 0.5rem;
                    padding-top: 0.45rem;
                    border-top: 1px solid rgba(255, 255, 255, 0.06);
                    font-family: var(--font-mono);
                    font-size: 0.7rem;
                }
                .tactical-tri-grid {
                    display: grid;
                    grid-template-columns: repeat(3, 1fr);
                    gap: 1.15rem;
                    margin-top: 1.5rem;
                }
                .feed-row-item {
                    padding: 0.65rem 0.75rem;
                    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
                    font-family: var(--font-mono);
                    font-size: 0.73rem;
                    cursor: pointer;
                    transition: background 0.14s ease;
                }
                .feed-row-item:hover {
                    background: rgba(255, 42, 109, 0.08);
                }
                @media screen and (max-width: 1180px) {
                    .tactical-tri-grid {
                        grid-template-columns: 1fr;
                    }
                }
            </style>

            <!-- CABECERA RAPIDA DE SINCRONIZACION Y ACCESOS -->
            <div class="panel-header" style="margin-bottom: 1rem;">
                <div style="display: flex; align-items: center; gap: 0.65rem; flex-wrap: wrap;">
                    <span class="panel-title" style="font-size: 1.05rem; color: var(--accent-rz);">CENTRO DE MANDO C4ISR // TELEMETRIA GLOBAL Y ENJAMBRE</span>
                    <span id="dash-sync-badge" class="badge badge-green">ENLACE ESTABLE</span>
                </div>
                <div style="display: flex; gap: 0.45rem; flex-wrap: wrap;">
                    <button id="btn-dash-refresh" class="btn-action" type="button">&#8635; REFRESCAR PULSO</button>
                    <button id="btn-dash-go-map" class="btn-action" type="button" style="border-color: #00f0ff; color: #00f0ff;">&#9678; ABRIR MAPA ESTELAR</button>
                    <button id="btn-show-token-bar" class="btn-export" type="button">+ DESPLEGAR NUEVO TOKEN</button>
                </div>
            </div>

            <!-- BARRA DESPLEGABLE PARA INYECTAR TOKENS EN CALIENTE -->
            <div id="token-inject-bar" class="toolbar-tactical hidden" style="border-color: var(--accent-green); margin-bottom: 1.15rem;">
                <div style="display: flex; align-items: center; gap: 0.65rem; flex-grow: 1; flex-wrap: wrap;">
                    <span style="font-family: var(--font-mono); font-size: 0.75rem; color: var(--accent-green);">[ NUEVA UNIDAD EXPLORADORA ]</span>
                    <input type="password" id="input-new-token" class="search-input" style="flex: 2; min-width: 220px;" placeholder="Pegar User Token de Discord..." autocomplete="off">
                    <input type="text" id="input-token-sector" class="search-input" style="flex: 1; min-width: 150px;" placeholder="Sector (ej: Proveedores / VIP)" maxlength="25">
                    <button id="btn-confirm-token" class="btn-export" type="button">CONECTAR 24/7</button>
                    <button id="btn-cancel-token" class="btn-action btn-purge" type="button">CANCELAR</button>
                </div>
            </div>

            <!-- FILA 1 Y 2 DE KPIS OPERATIVOS -->
            <div class="kpi-grid" id="dashboard-kpis">
                <div class="kpi-card">
                    <div class="kpi-label">SINCRONIZANDO...</div>
                    <div class="kpi-value">--</div>
                </div>
            </div>

            <!-- PANEL DE UNIDADES DEL ENJAMBRE (TARJETAS REDISEÑADAS SIN SOLAPAMIENTO) -->
            <div class="panel-container" style="margin-bottom: 1.5rem;">
                <div class="panel-header" style="margin-bottom: 0.9rem;">
                    <div style="display: flex; align-items: center; gap: 0.65rem; flex-wrap: wrap;">
                        <span class="panel-title" style="color: var(--accent-rz);">UNIDADES DE RECONOCIMIENTO ACTIVAS (CAPACIDAD DE INFILTRACION)</span>
                        <span id="swarm-count-badge" class="badge badge-green">0 ONLINE</span>
                    </div>
                    <span style="font-family: var(--font-mono); font-size: 0.7rem; color: var(--text-muted);">Haz clic en "FILTRAR MAPA" para ver la constelacion exclusiva de cada unidad</span>
                </div>
                <div class="swarm-grid" id="dashboard-bots"></div>
            </div>

            <!-- GRAFICOS DE ACTIVIDAD Y DISTRIBUCION -->
            <div class="chart-layout hidden" id="dashboard-charts">
                <div class="panel-container">
                    <div class="panel-header">
                        <span class="panel-title">DISTRIBUCION HORARIA DE INTERCEPCIONES (UTC)</span>
                        <span class="badge badge-amber">24 HORAS</span>
                    </div>
                    <div id="chart-timeline"></div>
                </div>
                <div class="panel-container">
                    <div class="panel-header">
                        <span class="panel-title">CLASIFICACION DE VECTORES</span>
                    </div>
                    <div id="chart-distribution"></div>
                </div>
            </div>

            <!-- CONSOLA TACTICA DE 3 COLUMNAS: ULTIMAS INTERCEPCIONES // SISTEMAS EN ALERTA // DEMOGRAFIA Y DVR -->
            <div class="tactical-tri-grid hidden" id="dashboard-tactical-feeds">
                <div class="panel-container" style="padding: 1rem;">
                    <div class="panel-header" style="margin-bottom: 0.6rem;">
                        <span class="panel-title" style="color: #ff2a6d;">ULTIMAS INTERCEPCIONES</span>
                        <button id="btn-go-blacklist" class="btn-action" type="button" style="font-size: 0.65rem; padding: 2px 7px;">VER TODAS</button>
                    </div>
                    <div id="feed-latest-threats" style="max-height: 290px; overflow-y: auto;"></div>
                </div>

                <div class="panel-container" style="padding: 1rem;">
                    <div class="panel-header" style="margin-bottom: 0.6rem;">
                        <span class="panel-title" style="color: #f97316;">SISTEMAS CON INFILTRACION / CENIZA</span>
                        <span id="badge-infected-count" class="badge badge-red">0</span>
                    </div>
                    <div id="feed-infected-servers" style="max-height: 290px; overflow-y: auto;"></div>
                </div>

                <div class="panel-container" style="padding: 1rem;">
                    <div class="panel-header" style="margin-bottom: 0.6rem;">
                        <span class="panel-title" style="color: #00f0ff;">DEMOGRAFIA OSINT Y SALTOS DVR</span>
                        <span id="badge-osint-countries" class="badge badge-green">ACTIVO</span>
                    </div>
                    <div id="feed-osint-dvr" style="max-height: 290px; overflow-y: auto;"></div>
                </div>
            </div>
        `;

        this.bindHeaderEvents();
        await this.loadFullTelemetry(true);

        this.autoRefreshTimer = setInterval(() => {
            if (this.isMounted) {
                this.loadFullTelemetry(false);
            }
        }, 15000);
    },

    bindHeaderEvents() {
        const btnShow = document.getElementById('btn-show-token-bar');
        const bar = document.getElementById('token-inject-bar');
        const inputToken = document.getElementById('input-new-token');
        const inputSector = document.getElementById('input-token-sector');
        const btnConfirm = document.getElementById('btn-confirm-token');
        const btnCancel = document.getElementById('btn-cancel-token');
        const btnRefresh = document.getElementById('btn-dash-refresh');
        const btnGoMap = document.getElementById('btn-dash-go-map');
        const btnGoBlacklist = document.getElementById('btn-go-blacklist');

        if (btnRefresh) {
            btnRefresh.addEventListener('click', async () => {
                btnRefresh.textContent = 'SINCRONIZANDO...';
                await this.loadFullTelemetry(false);
                btnRefresh.textContent = '\u21bb REFRESCAR PULSO';
            });
        }

        if (btnGoMap) {
            btnGoMap.addEventListener('click', () => window.AppController.navigate('red'));
        }

        if (btnGoBlacklist) {
            btnGoBlacklist.addEventListener('click', () => window.AppController.navigate('blacklist'));
        }

        if (btnShow && bar) {
            btnShow.addEventListener('click', () => {
                bar.classList.toggle('hidden');
                if (!bar.classList.contains('hidden') && inputToken) inputToken.focus();
            });
        }

        if (btnCancel && bar) {
            btnCancel.addEventListener('click', () => {
                bar.classList.add('hidden');
                if (inputToken) inputToken.value = '';
                if (inputSector) inputSector.value = '';
            });
        }

        if (btnConfirm && inputToken) {
            btnConfirm.addEventListener('click', async () => {
                const tokenVal = inputToken.value.trim();
                const sectorVal = inputSector?.value.trim() || 'General';
                if (tokenVal.length < 40) {
                    alert('[!] El token introducido es demasiado corto o invalido.');
                    return;
                }

                btnConfirm.disabled = true;
                btnConfirm.textContent = 'INFILTRANDO...';
                try {
                    const res = await window.C4ISR_API.agregarTokenExplorador(tokenVal, sectorVal);
                    alert(`[+] Unidad conectada con exito: ${res.tag} (${res.guilds} servidores detectados).`);
                    bar.classList.add('hidden');
                    inputToken.value = '';
                    await this.loadFullTelemetry(true);
                } catch (err) {
                    alert(`[!] Fallo al conectar el token: ${err.message}`);
                } finally {
                    btnConfirm.disabled = false;
                    btnConfirm.textContent = 'CONECTAR 24/7';
                }
            });
        }
    },

    async loadFullTelemetry(renderChartsFlag = true) {
        try {
            const [datos, redData] = await Promise.all([
                window.C4ISR_API.getDatosGlobales(),
                window.C4ISR_API.getRedTopologia().catch(() => ({ servidores: [], usuarios: [], bitacoraDvr: [], watchlist: [] }))
            ]);

            if (!this.isMounted) return;

            const metricasCalculadas = this.procesarTelemetriaReal(datos, redData);

            this.renderKPIs(datos, redData, metricasCalculadas);
            this.renderBots(datos.enjambre || [], redData.servidores || []);
            this.renderTacticalFeeds(datos, redData, metricasCalculadas);

            if (renderChartsFlag) {
                this.renderCharts(metricasCalculadas);
            }

            const chartSection = document.getElementById('dashboard-charts');
            const feedsSection = document.getElementById('dashboard-tactical-feeds');
            if (chartSection) chartSection.classList.remove('hidden');
            if (feedsSection) feedsSection.classList.remove('hidden');
        } catch (error) {
            console.error('[Dashboard] Error al cargar telemetria:', error);
            const kpiContainer = document.getElementById('dashboard-kpis');
            if (kpiContainer) {
                kpiContainer.innerHTML = `
                    <div class="login-error" style="grid-column: 1 / -1; display: block;">
                        [!] ERROR DE ENLACE: NO SE PUDO OBTENER LA TELEMETRIA DEL SERVIDOR CENTRAL.
                    </div>`;
            }
        }
    },

    procesarTelemetriaReal(datos, redData) {
        const expedientes = Array.isArray(datos.expedientes)
            ? datos.expedientes
            : (Array.isArray(datos.blacklist) ? datos.blacklist : []);

        const tramosHorarios = [
            { x: '00:00', y: 0 },
            { x: '04:00', y: 0 },
            { x: '08:00', y: 0 },
            { x: '12:00', y: 0 },
            { x: '16:00', y: 0 },
            { x: '20:00', y: 0 }
        ];

        let conteoAtaques = 0;
        let conteoLinks = 0;
        let conteoOsint = 0;
        const conteoPaises = {};

        for (const exp of expedientes) {
            const pais = exp.perfilOsint?.pais;
            if (pais) {
                conteoPaises[pais] = (conteoPaises[pais] || 0) + 1;
            }

            const historial = Array.isArray(exp.historial) ? exp.historial : [];
            if (historial.length === 0) {
                const ts = Date.parse(exp.primerFichaje || exp.fecha);
                if (!Number.isNaN(ts)) {
                    const idx = Math.min(5, Math.floor(new Date(ts).getUTCHours() / 4));
                    tramosHorarios[idx].y++;
                }
                continue;
            }

            for (const evento of historial) {
                const accion = String(evento.accion || '').toLowerCase();
                if (accion.includes('link')) {
                    conteoLinks++;
                } else if (accion.includes('osint') || accion.includes('menci')) {
                    conteoOsint++;
                } else {
                    conteoAtaques++;
                }

                const ts = Date.parse(evento.fecha);
                if (!Number.isNaN(ts)) {
                    const idx = Math.min(5, Math.floor(new Date(ts).getUTCHours() / 4));
                    tramosHorarios[idx].y++;
                }
            }
        }

        if (conteoLinks === 0 && Array.isArray(datos.links)) {
            conteoLinks = datos.links.length;
        }

        const servidores = Array.isArray(redData?.servidores) ? redData.servidores : [];
        const totalCeniza = servidores.filter(s => s.estadoCeniza?.raideado).length;
        const totalInfectados = servidores.filter(s => (s.infeccionCount || 0) > 0 && !s.estadoCeniza?.raideado).length;

        return {
            tramosHorarios,
            conteoAtaques,
            conteoLinks,
            conteoOsint,
            conteoPaises,
            totalCeniza,
            totalInfectados,
            totalSistemas: servidores.length,
            totalWatchlist: Array.isArray(redData?.watchlist) ? redData.watchlist.length : 0,
            totalEventos: conteoAtaques + conteoLinks + conteoOsint
        };
    },

    renderKPIs(datos, redData, metricas) {
        const kpiContainer = document.getElementById('dashboard-kpis');
        if (!kpiContainer) return;

        const totalExpedientes = datos.total_registros || 0;
        const alertas24h = datos.alertas_recientes || 0;

        kpiContainer.innerHTML = `
            <div class="kpi-card" style="cursor:pointer;" data-nav="expedientes">
                <div class="kpi-label">EXPEDIENTES TOTALES</div>
                <div class="kpi-value">${totalExpedientes}</div>
                <div style="font-family:var(--font-mono);font-size:0.68rem;color:var(--text-muted);margin-top:4px;">+${alertas24h} en las ultimas 24h</div>
            </div>
            <div class="kpi-card status-red" style="cursor:pointer;" data-nav="blacklist">
                <div class="kpi-label">ATAQUES / COMANDOS SQUAD</div>
                <div class="kpi-value" style="color: #f87171;">${metricas.conteoAtaques}</div>
                <div style="font-family:var(--font-mono);font-size:0.68rem;color:var(--text-muted);margin-top:4px;">Evidencias inmutables</div>
            </div>
            <div class="kpi-card status-amber" style="cursor:pointer;" data-nav="links">
                <div class="kpi-label">ALIANZAS INTERCEPTADAS</div>
                <div class="kpi-value" style="color: #fbbf24;">${ (datos.links || []).length }</div>
                <div style="font-family:var(--font-mono);font-size:0.68rem;color:var(--text-muted);margin-top:4px;">${metricas.conteoLinks} impactos totales</div>
            </div>
            <div class="kpi-card status-green" style="cursor:pointer;" data-nav="red">
                <div class="kpi-label">SISTEMAS EN MAPA ESTELAR</div>
                <div class="kpi-value" style="color: #00f0ff;">${metricas.totalSistemas}</div>
                <div style="font-family:var(--font-mono);font-size:0.68rem;color:${metricas.totalCeniza > 0 ? '#f87171' : '#34d399'};margin-top:4px;">
                    ${metricas.totalCeniza} en Ceniza &bull; ${metricas.totalInfectados} con Infiltracion
                </div>
            </div>
        `;

        kpiContainer.querySelectorAll('.kpi-card[data-nav]').forEach(card => {
            card.addEventListener('click', () => {
                const targetView = card.getAttribute('data-nav');
                if (targetView) window.AppController.navigate(targetView);
            });
        });
    },

    /**
     * Renderiza las tarjetas de las Unidades Exploradoras con diseño de 2 niveles sin solapamientos,
     * barra de capacidad sobre el límite de 100 servidores de Discord y salto directo al Mapa Estelar.
     */
    renderBots(bots, servidoresRed) {
        const container = document.getElementById('dashboard-bots');
        const badge = document.getElementById('swarm-count-badge');
        if (!container) return;

        if (badge) {
            badge.textContent = `${bots.length} UNIDAD(ES) EN LINEA`;
            badge.className = bots.length > 0 ? 'badge badge-green' : 'badge badge-red';
        }

        if (bots.length === 0) {
            container.innerHTML = `
                <div style="grid-column: 1 / -1; padding: 1.75rem; text-align: center; border: 1px dashed rgba(255, 42, 109, 0.3); border-radius: var(--radius-md); background: rgba(0,0,0,0.2);">
                    <div style="color: var(--text-muted); font-family: var(--font-mono); font-size: 0.82rem;">
                        [!] NINGUNA UNIDAD EXPLORADORA REPORTA PULSO ACTIVO. USA EL BOTON "+ DESPLEGAR NUEVO TOKEN".
                    </div>
                </div>
            `;
            return;
        }

        container.innerHTML = bots.map(bot => {
            const avatar = DOMPurify.sanitize(bot.avatar || 'https://cdn.discordapp.com/embed/avatars/0.png');
            const tag = DOMPurify.sanitize(bot.tag || 'Unidad Anonima');
            const id = DOMPurify.sanitize(String(bot.id || '000000000000000000'));
            const sector = DOMPurify.sanitize(bot.sector || 'ENV_#1');
            const numServers = Number.isInteger(bot.guildsCount) ? bot.guildsCount : 0;

            // Calcular cuántos servidores activos con tráfico vigila esta unidad
            const activosVigilados = servidoresRed.filter(
                s => Array.isArray(s.exploradores) && s.exploradores.includes(bot.tag) && (s.usuariosCount || 0) > 0
            ).length;

            // Porcentaje sobre el límite de 100 servidores de una cuenta estándar de Discord
            const pctCapacidad = Math.min(100, numServers);
            const barColor = pctCapacidad >= 90 ? '#ef4444' : (pctCapacidad >= 75 ? '#f59e0b' : '#10b981');

            return `
                <div class="swarm-unit-card" style="border-top-color: ${barColor};">
                    <div class="swarm-unit-top">
                        <img src="${avatar}" alt="Avatar" style="width: 46px; height: 46px; border-radius: 50%; border: 2px solid ${barColor}; object-fit: cover; flex-shrink: 0;">
                        <div class="swarm-unit-meta">
                            <div style="display: flex; justify-content: space-between; align-items: center; gap: 0.4rem;">
                                <span class="swarm-unit-tag" title="${tag}">${tag}</span>
                                <span class="badge badge-green" style="font-size: 0.63rem; padding: 2px 6px;">ONLINE</span>
                            </div>
                            <div class="swarm-unit-uid">
                                <span>UID: ${id.slice(0, 6)}...${id.slice(-4)}</span>
                                <button class="btn-copy-uid" data-uid="${id}" type="button" title="Copiar UID completo" style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);color:var(--text-secondary);border-radius:3px;padding:1px 5px;font-family:var(--font-mono);font-size:0.62rem;cursor:pointer;">COPIAR</button>
                            </div>
                        </div>
                    </div>

                    <div>
                        <div style="display: flex; justify-content: space-between; font-family: var(--font-mono); font-size: 0.69rem; margin-bottom: 4px;">
                            <span style="color: var(--text-secondary);">CAPACIDAD DE INFILTRACION:</span>
                            <strong style="color: ${barColor};">${numServers} / 100 SERVERS (${activosVigilados} CON TRAFICO)</strong>
                        </div>
                        <div class="swarm-capacity-bar">
                            <div class="swarm-capacity-fill" style="width: ${pctCapacidad}%; background: ${barColor};"></div>
                        </div>
                    </div>

                    <div class="swarm-unit-bottom">
                        <span style="color: var(--accent-amber); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                            SECTOR: <strong>${sector}</strong>
                        </span>
                        <button class="btn-action btn-filter-starmap" data-tag="${tag}" type="button" style="padding: 3px 8px; font-size: 0.68rem; border-color: #00f0ff; color: #00f0ff;">
                            &#9678; FILTRAR MAPA
                        </button>
                    </div>
                </div>
            `;
        }).join('');

        container.querySelectorAll('.btn-copy-uid').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const uid = btn.getAttribute('data-uid');
                if (uid && navigator.clipboard) {
                    navigator.clipboard.writeText(uid);
                    btn.textContent = 'OK';
                    setTimeout(() => { btn.textContent = 'COPIAR'; }, 900);
                }
            });
        });

        container.querySelectorAll('.btn-filter-starmap').forEach(btn => {
            btn.addEventListener('click', () => {
                const tag = btn.getAttribute('data-tag');
                if (tag && window.C4ISR_Views.red) {
                    window.C4ISR_Views.red.selectedExplorerFilter = tag;
                    window.AppController.navigate('red');
                }
            });
        });
    },

    renderTacticalFeeds(datos, redData, metricas) {
        // 1. Últimas Intercepciones Críticas
        const threatsEl = document.getElementById('feed-latest-threats');
        if (threatsEl) {
            const lista = Array.isArray(datos.blacklist) ? datos.blacklist.slice(0, 8) : [];
            if (lista.length === 0) {
                threatsEl.innerHTML = `<div style="padding:1rem;color:var(--text-muted);font-family:var(--font-mono);font-size:0.74rem;">Sin intercepciones recientes.</div>`;
            } else {
                threatsEl.innerHTML = lista.map(item => {
                    const id = DOMPurify.sanitize(String(item.id || ''));
                    const user = DOMPurify.sanitize(String(item.username || 'Sujeto'));
                    const srv = DOMPurify.sanitize(String(item.servidor || 'N/A'));
                    const ev = DOMPurify.sanitize(limpiarTextoResumen(item.evidencia));
                    const hace = formatearHaceCuanto(item.fecha);
                    return `
                        <div class="feed-row-item" data-uid="${id}">
                            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px;">
                                <strong style="color:#ffffff;">${user}</strong>
                                <span style="color:var(--accent-rz);font-size:0.66rem;">${hace}</span>
                            </div>
                            <div style="color:var(--text-secondary);font-size:0.69rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${ev}</div>
                            <div style="color:var(--text-muted);font-size:0.65rem;margin-top:2px;">&#11042; ${srv}</div>
                        </div>
                    `;
                }).join('');

                threatsEl.querySelectorAll('.feed-row-item').forEach(row => {
                    row.addEventListener('click', () => {
                        const uid = row.getAttribute('data-uid');
                        if (uid) {
                            window.C4ISR_TARGET_OVERRIDE = uid;
                            window.AppController.navigate('expedientes');
                        }
                    });
                });
            }
        }

        // 2. Sistemas con Infiltración Hostil o en Estado Ceniza
        const infEl = document.getElementById('feed-infected-servers');
        const infBadge = document.getElementById('badge-infected-count');
        if (infEl) {
            const servidores = Array.isArray(redData?.servidores) ? redData.servidores : [];
            const alertasSrv = servidores
                .filter(s => s.estadoCeniza?.raideado || (s.infeccionCount || 0) > 0)
                .sort((a, b) => {
                    const aCen = a.estadoCeniza?.raideado ? 1 : 0;
                    const bCen = b.estadoCeniza?.raideado ? 1 : 0;
                    if (aCen !== bCen) return bCen - aCen;
                    return (b.infeccionCount || 0) - (a.infeccionCount || 0);
                });

            if (infBadge) infBadge.textContent = String(alertasSrv.length);

            if (alertasSrv.length === 0) {
                infEl.innerHTML = `<div style="padding:1rem;color:var(--text-muted);font-family:var(--font-mono);font-size:0.74rem;">Ningun servidor reporta infiltracion ni ataques Ceniza.</div>`;
            } else {
                infEl.innerHTML = alertasSrv.slice(0, 10).map(s => {
                    const esCen = Boolean(s.estadoCeniza?.raideado);
                    const sName = DOMPurify.sanitize(String(s.name || 'Servidor'));
                    const badgeHtml = esCen
                        ? `<span class="badge badge-red" style="font-size:0.62rem;">CENIZA // RAIDEADO</span>`
                        : `<span class="badge badge-amber" style="font-size:0.62rem;">${s.infeccionCount} HOSTILES (${s.infeccionPct}%)</span>`;

                    return `
                        <div class="feed-row-item" data-sname="${sName}">
                            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px;">
                                <strong style="color:${esCen ? '#94a3b8' : '#ffffff'};">&#11042; ${sName}</strong>
                                ${badgeHtml}
                            </div>
                            <div style="color:var(--text-muted);font-size:0.67rem;">
                                ${esCen ? DOMPurify.sanitize(s.estadoCeniza.motivo || 'Ataque detectado') : `Poblacion en orbita: ${s.usuariosCount || 0} sujeto(s)`}
                            </div>
                        </div>
                    `;
                }).join('');

                infEl.querySelectorAll('.feed-row-item').forEach(row => {
                    row.addEventListener('click', () => {
                        const sName = row.getAttribute('data-sname');
                        if (sName && window.C4ISR_Views.red) {
                            window.C4ISR_Views.red.searchTerm = sName.toLowerCase();
                            window.AppController.navigate('red');
                        }
                    });
                });
            }
        }

        // 3. Demografía OSINT 3.0 por Países + Últimos Saltos DVR
        const osintDvrEl = document.getElementById('feed-osint-dvr');
        if (osintDvrEl) {
            const paisesEntries = Object.entries(metricas.conteoPaises || {}).sort((a, b) => b[1] - a[1]);
            const paisesHtml = paisesEntries.length > 0
                ? paisesEntries.map(([pais, count]) => `
                    <span style="display:inline-block;background:rgba(0,240,255,0.09);border:1px solid rgba(0,240,255,0.28);padding:3px 8px;border-radius:4px;font-family:var(--font-mono);font-size:0.69rem;margin:2px;">
                        &#127758; <b>${DOMPurify.sanitize(pais)}:</b> ${count}
                    </span>
                `).join('')
                : `<div style="color:var(--text-muted);font-size:0.71rem;">Recopilando muestras dialectales y horarias...</div>`;

            const dvrList = Array.isArray(redData?.bitacoraDvr) ? redData.bitacoraDvr.slice(-5).reverse() : [];
            const dvrHtml = dvrList.map(ev => `
                <div style="padding:5px 0;border-bottom:1px solid rgba(255,255,255,0.05);font-family:var(--font-mono);font-size:0.69rem;">
                    <span style="color:#00f0ff;font-weight:700;">[${DOMPurify.sanitize(String(ev.tipo || 'DVR'))}]</span>
                    <span style="color:var(--text-secondary);"> ${DOMPurify.sanitize(String(ev.detalle || ''))}</span>
                </div>
            `).join('');

            osintDvrEl.innerHTML = `
                <div style="margin-bottom: 0.75rem;">
                    <div style="font-family:var(--font-mono);font-size:0.68rem;color:var(--text-muted);margin-bottom:4px;">DISTRIBUCION GEOGRAFICA DEDUCIDA:</div>
                    <div>${paisesHtml}</div>
                </div>
                <div>
                    <div style="font-family:var(--font-mono);font-size:0.68rem;color:#fcee0a;margin-bottom:4px;">ULTIMOS SALTOS ENTRE SERVIDORES (DVR):</div>
                    ${dvrHtml || '<div style="color:var(--text-muted);font-family:var(--font-mono);font-size:0.71rem;">Esperando saltos entre servidores...</div>'}
                </div>
            `;
        }
    },

    renderCharts(metricas) {
        if (this.charts.timeline) {
            this.charts.timeline.destroy();
            this.charts.timeline = null;
        }
        if (this.charts.distribution) {
            this.charts.distribution.destroy();
            this.charts.distribution = null;
        }

        const elTimeline = document.querySelector('#chart-timeline');
        const elDist = document.querySelector('#chart-distribution');
        if (!elTimeline || !elDist || typeof ApexCharts === 'undefined') return;

        const baseOptions = {
            chart: {
                background: 'transparent',
                foreColor: '#8b829e',
                fontFamily: 'JetBrains Mono, monospace',
                toolbar: { show: false },
                animations: { enabled: true, speed: 400 }
            },
            theme: { mode: 'dark' },
            tooltip: { theme: 'dark' },
            dataLabels: { enabled: false },
            grid: { borderColor: 'rgba(255, 255, 255, 0.05)', strokeDashArray: 4 }
        };

        const optionsTimeline = {
            ...baseOptions,
            chart: { ...baseOptions.chart, type: 'area', height: 270 },
            series: [{ name: 'Eventos Registrados', data: metricas.tramosHorarios }],
            colors: ['#ff2a6d'],
            stroke: { curve: 'smooth', width: 2.5 },
            fill: {
                type: 'gradient',
                gradient: {
                    shadeIntensity: 1,
                    opacityFrom: 0.38,
                    opacityTo: 0.02,
                    stops: [0, 95, 100]
                }
            },
            yaxis: { labels: { formatter: (val) => Math.floor(val) } }
        };

        this.charts.timeline = new ApexCharts(elTimeline, optionsTimeline);
        this.charts.timeline.render();

        const totalReal = metricas.conteoAtaques + metricas.conteoLinks + metricas.conteoOsint;
        const seriesDona = totalReal > 0
            ? [metricas.conteoAtaques, metricas.conteoLinks, metricas.conteoOsint]
            : [1, 1, 1];

        const optionsDistribution = {
            ...baseOptions,
            chart: { ...baseOptions.chart, type: 'donut', height: 270 },
            series: seriesDona,
            labels: ['Raids / Squads', 'LinksPortal', 'Inteligencia OSINT'],
            colors: ['#ef4444', '#f59e0b', '#00f0ff'],
            stroke: { show: true, colors: ['#171420'], width: 3 },
            plotOptions: {
                pie: {
                    donut: {
                        size: '74%',
                        labels: {
                            show: true,
                            total: {
                                show: true,
                                label: 'EVENTOS',
                                color: '#cbd5e1',
                                formatter: () => String(totalReal)
                            }
                        }
                    }
                }
            },
            legend: { position: 'bottom', fontSize: '12px' }
        };

        this.charts.distribution = new ApexCharts(elDist, optionsDistribution);
        this.charts.distribution.render();
    },

    destroy() {
        this.isMounted = false;
        if (this.autoRefreshTimer) {
            clearInterval(this.autoRefreshTimer);
            this.autoRefreshTimer = null;
        }
        if (this.charts.timeline) {
            this.charts.timeline.destroy();
            this.charts.timeline = null;
        }
        if (this.charts.distribution) {
            this.charts.distribution.destroy();
            this.charts.distribution = null;
        }
    }
};
