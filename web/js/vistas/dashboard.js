/* ==========================================================================
   VISTA: ANALÍTICA C4ISR (DASHBOARD CON TELEMETRÍA DE ENJAMBRE)
   Archivo: js/vistas/dashboard.js
   ========================================================================== */
window.C4ISR_Views = window.C4ISR_Views || {};

window.C4ISR_Views.dashboard = {
    charts: { timeline: null, distribution: null },

    async render(container) {
        // Estructura visual de telemetría y gráficos
        container.innerHTML = `
            <div class="kpi-grid" id="dashboard-kpis">
                <div style="color: var(--accent-cyan); font-family: var(--font-mono);">[ SISTEMA ] OBTENIENDO TELEMETRÍA...</div>
            </div>
            
            <div class="panel-header" style="margin-top: 2rem;">
                <span class="panel-title" style="color: var(--accent-rz); text-shadow: var(--glow-rz);">ENJAMBRE DE RECONOCIMIENTO (ESTADO DE RED)</span>
            </div>
            
            <div class="links-grid" id="dashboard-bots" style="margin-bottom: 2rem;">
                <!-- Los bots conectados se inyectarán aquí -->
            </div>

            <div class="chart-layout hidden" id="dashboard-charts">
                <div class="panel-container">
                    <div class="panel-header"><span class="panel-title">FLUJO TEMPORAL DE INTERCEPCIONES</span></div>
                    <div id="chart-timeline"></div>
                </div>
                <div class="panel-container">
                    <div class="panel-header"><span class="panel-title">VECTORES DE AMENAZA</span></div>
                    <div id="chart-distribution"></div>
                </div>
            </div>
        `;

        try {
            const datos = await C4ISR_API.getDatosGlobales();
            
            this.renderKPIs(datos);
            this.renderBots(datos.enjambre || []);
            this.renderCharts(datos);
            
            document.getElementById('dashboard-charts').classList.remove('hidden');
        } catch (error) {
            console.error("[Dashboard] Error al cargar telemetría:", error);
            const kpiContainer = document.getElementById('dashboard-kpis');
            if (kpiContainer) {
                kpiContainer.innerHTML = `<div class="login-error" style="display:block;">[!] ERROR DE ENLACE: NO SE PUDO ESTABLECER CONEXIÓN CON EL ENJAMBRE LOCAL.</div>`;
            }
        }
    },

    renderBots(bots) {
        const container = document.getElementById('dashboard-bots');
        
        if (bots.length === 0) {
            container.innerHTML = `
                <div style="grid-column: 1 / -1; padding: 2rem; text-align: center; border: 1px dashed rgba(255, 42, 109, 0.3); background: var(--bg-panel);">
                    <div style="color: var(--accent-rz); font-family: var(--font-mono);">[ ADVERTENCIA ] EL ENJAMBRE ESTÁ DESCONECTADO O EN MANTENIMIENTO.</div>
                </div>
            `;
            return;
        }

        let html = '';
        bots.forEach(bot => {
            html += `
                <div class="link-card" style="display: flex; align-items: center; gap: 1rem; padding: 1rem;">
                    <img src="${DOMPurify.sanitize(bot.avatar)}" alt="Avatar" style="width: 40px; height: 40px; border-radius: 50%; border: 2px solid var(--accent-green); object-fit: cover;">
                    <div>
                        <div style="color: var(--text-main); font-weight: bold; font-family: var(--font-display);">${DOMPurify.sanitize(bot.tag)}</div>
                        <div style="color: var(--text-muted); font-size: 0.75rem;">UID: ${DOMPurify.sanitize(bot.id)}</div>
                    </div>
                    <div style="margin-left: auto; display: flex; align-items: center; gap: 0.5rem; color: var(--accent-green); font-size: 0.8rem; font-weight: bold;">
                        <span class="status-dot online" style="margin:0;"></span> EN LÍNEA
                    </div>
                </div>
            `;
        });
        container.innerHTML = html;
    },

    renderKPIs(datos) {
        const kpiContainer = document.getElementById('dashboard-kpis');
        const totalRegistros = datos.total_registros || 0;
        const totalBlacklist = datos.blacklist ? datos.blacklist.length : 0;
        const totalLinks = datos.links ? datos.links.length : 0;
        const alertasActivas = datos.alertas_recientes || 0;

        kpiContainer.innerHTML = `
            <div class="kpi-card" style="border-bottom-color: var(--accent-cyan);">
                <div class="kpi-label">CAPTURA TOTAL OSINT</div>
                <div class="kpi-value">${totalRegistros}</div>
            </div>
            <div class="kpi-card status-red">
                <div class="kpi-label">INFRACTORES EN BLACKLIST</div>
                <div class="kpi-value">${totalBlacklist}</div>
            </div>
            <div class="kpi-card status-amber">
                <div class="kpi-label">ENLACES INTERCEPTADOS</div>
                <div class="kpi-value">${totalLinks}</div>
            </div>
            <div class="kpi-card ${alertasActivas > 0 ? 'status-amber' : 'status-green'}">
                <div class="kpi-label">ALERTAS RECIENTES 24H</div>
                <div class="kpi-value">${alertasActivas}</div>
            </div>
        `;
    },

    renderCharts(datos) {
        const baseOptions = {
            chart: { background: 'transparent', foreColor: '#64748b', toolbar: { show: false }, animations: { enabled: true } },
            theme: { mode: 'dark' },
            tooltip: { theme: 'dark' },
            dataLabels: { enabled: false },
            grid: { borderColor: 'rgba(255, 42, 109, 0.05)', strokeDashArray: 4 }
        };

        // Gráfico Timeline
        const timelineData = [{ x: '00:00', y: 5 }, { x: '08:00', y: 15 }, { x: '16:00', y: 45 }, { x: '24:00', y: 30 }];
        const optionsTimeline = {
            ...baseOptions,
            chart: { ...baseOptions.chart, type: 'area', height: 300 },
            series: [{ name: 'Intercepciones', data: timelineData }],
            colors: ['#00e5ff'],
            stroke: { curve: 'smooth', width: 2 },
            fill: { type: 'gradient', gradient: { shadeIntensity: 1, opacityFrom: 0.4, opacityTo: 0.05, stops: [0, 90, 100] } }
        };
        this.charts.timeline = new ApexCharts(document.querySelector("#chart-timeline"), optionsTimeline);
        this.charts.timeline.render();

        // Gráfico Dona con color Rz
        const distData = [
            datos.blacklist ? datos.blacklist.length : 10, 
            datos.links ? datos.links.length : 25, 
            30 // Asumimos OSINT general para rellenar visualmente si la DB es pequeña
        ];
        const optionsDistribution = {
            ...baseOptions,
            chart: { ...baseOptions.chart, type: 'donut', height: 300 },
            series: distData,
            labels: ['Módulos Ataque/Raids', 'LinksPortal', 'Radar OSINT'],
            colors: ['#ff3333', '#00e5ff', '#ff2a6d'], // El tercer color es Rz
            stroke: { show: true, colors: ['#0a0f12'], width: 2 },
            plotOptions: {
                pie: { donut: { size: '75%', labels: { show: true, total: { show: true, label: 'TOTAL', color: '#ff2a6d' } } } }
            },
            legend: { position: 'bottom', fontFamily: 'JetBrains Mono' }
        };
        this.charts.distribution = new ApexCharts(document.querySelector("#chart-distribution"), optionsDistribution);
        this.charts.distribution.render();
    },

    destroy() {
        if (this.charts.timeline) { this.charts.timeline.destroy(); this.charts.timeline = null; }
        if (this.charts.distribution) { this.charts.distribution.destroy(); this.charts.distribution = null; }
    }
};
