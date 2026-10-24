'use strict';

/* ==========================================================================
   VISTA: ANALÍTICA C4ISR + GESTOR DE ENJAMBRE EN CALIENTE
   Archivo: js/vistas/dashboard.js
   ========================================================================== */

window.C4ISR_Views = window.C4ISR_Views || {};

window.C4ISR_Views.dashboard = {
    charts: { timeline: null, distribution: null },

    async render(container) {
        container.innerHTML = `
            <div class="kpi-grid" id="dashboard-kpis">
                <div class="kpi-card">
                    <div class="kpi-label">SINCRONIZANDO...</div>
                    <div class="kpi-value">--</div>
                </div>
            </div>

            <div class="panel-container" style="margin-bottom: 1.5rem;">
                <div class="panel-header">
                    <div style="display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap;">
                        <span class="panel-title" style="color: var(--accent-rz);">UNIDADES DE RECONOCIMIENTO ACTIVAS (ENJAMBRE)</span>
                        <span id="swarm-count-badge" class="badge badge-green">0 ONLINE</span>
                    </div>
                    <button id="btn-show-token-bar" class="btn-action" type="button">+ DESPLEGAR NUEVO TOKEN</button>
                </div>

                <!-- Barra para añadir Tokens Exploradores en caliente sin entrar a Render -->
                <div id="token-inject-bar" class="toolbar-tactical hidden" style="border-color: var(--accent-green); margin-bottom: 1rem;">
                    <div style="display: flex; align-items: center; gap: 0.65rem; flex-grow: 1; flex-wrap: wrap;">
                        <span style="font-family: var(--font-mono); font-size: 0.76rem; color: var(--accent-green);">[ NUEVO EXPLORADOR ]</span>
                        <input type="password" id="input-new-token" class="search-input" style="flex: 2; min-width: 220px;" placeholder="Pegar User Token de Discord..." autocomplete="off">
                        <input type="text" id="input-token-sector" class="search-input" style="flex: 1; min-width: 150px;" placeholder="Sector (ej: Proveedores / VIP)" maxlength="25">
                        <button id="btn-confirm-token" class="btn-export" type="button">CONECTAR 24/7</button>
                        <button id="btn-cancel-token" class="btn-action btn-purge" type="button">CANCELAR</button>
                    </div>
                </div>

                <div class="links-grid" id="dashboard-bots"></div>
            </div>

            <div class="chart-layout hidden" id="dashboard-charts">
                <div class="panel-container">
                    <div class="panel-header">
                        <span class="panel-title">DISTRIBUCIÓN HORARIA DE INTERCEPCIONES (UTC)</span>
                        <span class="badge badge-amber">TIEMPO REAL</span>
                    </div>
                    <div id="chart-timeline"></div>
                </div>
                <div class="panel-container">
                    <div class="panel-header">
                        <span class="panel-title">CLASIFICACIÓN DE VECTORES</span>
                    </div>
                    <div id="chart-distribution"></div>
                </div>
            </div>
        `;

        this.bindTokenEvents();

        try {
            const datos = await window.C4ISR_API.getDatosGlobales();
            const metricasCalculadas = this.procesarTelemetriaReal(datos);

            this.renderKPIs(datos, metricasCalculadas);
            this.renderBots(datos.enjambre || []);
            this.renderCharts(metricasCalculadas);

            const chartSection = document.getElementById('dashboard-charts');
            if (chartSection) chartSection.classList.remove('hidden');
        } catch (error) {
            console.error('[Dashboard] Error al cargar telemetría:', error);
            const kpiContainer = document.getElementById('dashboard-kpis');
            if (kpiContainer) {
                kpiContainer.innerHTML = `
                    <div class="login-error" style="grid-column: 1 / -1; display: block;">
                        [!] ERROR DE ENLACE: NO SE PUDO OBTENER LA TELEMETRÍA DEL SERVIDOR CENTRAL.
                    </div>`;
            }
        }
    },

    bindTokenEvents() {
        const btnShow = document.getElementById('btn-show-token-bar');
        const bar = document.getElementById('token-inject-bar');
        const inputToken = document.getElementById('input-new-token');
        const inputSector = document.getElementById('input-token-sector');
        const btnConfirm = document.getElementById('btn-confirm-token');
        const btnCancel = document.getElementById('btn-cancel-token');

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
                    alert('[!] El token introducido es demasiado corto o inválido.');
                    return;
                }

                btnConfirm.disabled = true;
                btnConfirm.textContent = 'INFILTRANDO...';
                try {
                    const res = await window.C4ISR_API.agregarTokenExplorador(tokenVal, sectorVal);
                    alert(`[+] Unidad conectada con éxito: ${res.tag} (${res.guilds} servidores detectados).`);
                    await window.AppController.navigate('dashboard');
                } catch (err) {
                    alert(`[!] Fallo al conectar el token: ${err.message}`);
                    btnConfirm.disabled = false;
                    btnConfirm.textContent = 'CONECTAR 24/7';
                }
            });
        }
    },

    procesarTelemetriaReal(datos) {
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

        for (const exp of expedientes) {
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
                } else if (accion.includes('osint') || accion.includes('mención')) {
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

        return {
            tramosHorarios,
            conteoAtaques,
            conteoLinks,
            conteoOsint,
            totalEventos: conteoAtaques + conteoLinks + conteoOsint
        };
    },

    renderKPIs(datos, metricas) {
        const kpiContainer = document.getElementById('dashboard-kpis');
        if (!kpiContainer) return;

        const totalExpedientes = datos.total_registros || 0;
        const alertas24h = datos.alertas_recientes || 0;

        kpiContainer.innerHTML = `
            <div class="kpi-card">
                <div class="kpi-label">EXPEDIENTES TOTALES</div>
                <div class="kpi-value">${totalExpedientes}</div>
            </div>
            <div class="kpi-card status-red">
                <div class="kpi-label">EVENTOS DE ATAQUE / SQUADS</div>
                <div class="kpi-value" style="color: #f87171;">${metricas.conteoAtaques}</div>
            </div>
            <div class="kpi-card status-amber">
                <div class="kpi-label">VECTORES DE INVITACIÓN</div>
                <div class="kpi-value" style="color: #fbbf24;">${metricas.conteoLinks}</div>
            </div>
            <div class="kpi-card ${alertas24h > 0 ? 'status-amber' : 'status-green'}">
                <div class="kpi-label">NUEVOS OBJETIVOS (24H)</div>
                <div class="kpi-value" style="color: ${alertas24h > 0 ? '#fbbf24' : '#34d399'};">${alertas24h}</div>
            </div>
        `;
    },

    renderBots(bots) {
        const container = document.getElementById('dashboard-bots');
        const badge = document.getElementById('swarm-count-badge');
        if (!container) return;

        if (badge) {
            badge.textContent = `${bots.length} UNIDAD(ES) EN LÍNEA`;
            badge.className = bots.length > 0 ? 'badge badge-green' : 'badge badge-red';
        }

        if (bots.length === 0) {
            container.innerHTML = `
                <div style="grid-column: 1 / -1; padding: 1.75rem; text-align: center; border: 1px dashed rgba(255, 42, 109, 0.3); border-radius: var(--radius-md); background: rgba(0,0,0,0.2);">
                    <div style="color: var(--text-muted); font-family: var(--font-mono); font-size: 0.82rem;">
                        [!] NINGUNA UNIDAD EXPLORADORA REPORTA PULSO ACTIVO. USA EL BOTÓN "+ DESPLEGAR NUEVO TOKEN".
                    </div>
                </div>
            `;
            return;
        }

        container.innerHTML = bots.map(bot => {
            const avatar = DOMPurify.sanitize(bot.avatar || 'https://cdn.discordapp.com/embed/avatars/0.png');
            const tag = DOMPurify.sanitize(bot.tag || 'Unidad Anónima');
            const id = DOMPurify.sanitize(bot.id || '000000000000000000');
            const sector = DOMPurify.sanitize(bot.sector || 'General');
            const guildsCount = Number.isInteger(bot.guildsCount) ? `${bot.guildsCount} SERVERS` : 'ACTIVO';

            return `
                <div class="link-card" style="display: flex; align-items: center; gap: 0.9rem; padding: 0.95rem 1.1rem; border-top-color: var(--accent-green);">
                    <img src="${avatar}" alt="Avatar" style="width: 42px; height: 42px; border-radius: 50%; border: 2px solid var(--accent-green); object-fit: cover; flex-shrink: 0;">
                    <div style="min-width: 0; flex-grow: 1;">
                        <div style="color: var(--text-main); font-weight: 600; font-size: 0.92rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${tag}</div>
                        <div style="color: var(--text-muted); font-family: var(--font-mono); font-size: 0.71rem;">UID: ${id}</div>
                        <div style="color: var(--accent-amber); font-family: var(--font-mono); font-size: 0.69rem; margin-top: 2px;">SECTOR: ${sector}</div>
                    </div>
                    <span class="badge badge-green">${guildsCount}</span>
                </div>
            `;
        }).join('');
    },

    renderCharts(metricas) {
        this.destroy();

        const elTimeline = document.querySelector('#chart-timeline');
        const elDist = document.querySelector('#chart-distribution');
        if (!elTimeline || !elDist || typeof ApexCharts === 'undefined') return;

        const baseOptions = {
            chart: {
                background: 'transparent',
                foreColor: '#8b829e',
                fontFamily: 'JetBrains Mono, monospace',
                toolbar: { show: false },
                animations: { enabled: true, speed: 450 }
            },
            theme: { mode: 'dark' },
            tooltip: { theme: 'dark' },
            dataLabels: { enabled: false },
            grid: { borderColor: 'rgba(255, 255, 255, 0.05)', strokeDashArray: 4 }
        };

        const optionsTimeline = {
            ...baseOptions,
            chart: { ...baseOptions.chart, type: 'area', height: 290 },
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
            chart: { ...baseOptions.chart, type: 'donut', height: 290 },
            series: seriesDona,
            labels: ['Raids / Squads', 'LinksPortal', 'Inteligencia OSINT'],
            colors: ['#ef4444', '#f59e0b', '#ff2a6d'],
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
