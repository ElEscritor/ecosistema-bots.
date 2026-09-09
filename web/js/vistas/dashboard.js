/* ==========================================================================
   VISTA: ANALÍTICA C4ISR (DASHBOARD)
   Archivo: js/vistas/dashboard.js
   Objetivo: Renderizar telemetría global y gráficos de ApexCharts
   ========================================================================== */

window.C4ISR_Views = window.C4ISR_Views || {};

window.C4ISR_Views.dashboard = {
    // Almacén de instancias de gráficos para su posterior destrucción
    charts: {
        timeline: null,
        distribution: null
    },

    async render(container) {
        // 1. Inyectar el esqueleto HTML del Dashboard
        container.innerHTML = `
            <div class="kpi-grid" id="dashboard-kpis">
                <div style="color: var(--accent-cyan); font-family: var(--font-mono);">[ SISTEMA ] OBTENIENDO TELEMETRÍA...</div>
            </div>
            
            <div class="chart-layout hidden" id="dashboard-charts">
                <div class="panel-container">
                    <div class="panel-header">
                        <span class="panel-title">FLUJO TEMPORAL DE INTERCEPCIONES</span>
                    </div>
                    <div id="chart-timeline"></div>
                </div>
                
                <div class="panel-container">
                    <div class="panel-header">
                        <span class="panel-title">VECTORES DE AMENAZA</span>
                    </div>
                    <div id="chart-distribution"></div>
                </div>
            </div>
        `;

        try {
            // 2. Extraer datos globales desde el backend
            const datos = await C4ISR_API.getDatosGlobales();
            
            // 3. Renderizar componentes con los datos obtenidos
            this.renderKPIs(datos);
            this.renderCharts(datos);
            
            // 4. Mostrar gráficos una vez procesados
            document.getElementById('dashboard-charts').classList.remove('hidden');

        } catch (error) {
            console.error("[Dashboard] Error al cargar telemetría:", error);
            const kpiContainer = document.getElementById('dashboard-kpis');
            if (kpiContainer) {
                kpiContainer.innerHTML = `<div class="login-error" style="display:block;">[!] ERROR DE ENLACE: NO SE PUDO ESTABLECER CONEXIÓN CON EL ENJAMBRE LOCAL.</div>`;
            }
        }
    },

    renderKPIs(datos) {
        const kpiContainer = document.getElementById('dashboard-kpis');
        if (!kpiContainer) return;

        // Cálculos preventivos en caso de que la estructura de la base de datos varíe
        const totalRegistros = datos.total_registros || 0;
        const totalBlacklist = datos.blacklist ? datos.blacklist.length : 0;
        const totalLinks = datos.links ? datos.links.length : 0;
        const alertasActivas = datos.alertas_recientes || 0;

        // Generar el HTML de las tarjetas
        kpiContainer.innerHTML = `
            <div class="kpi-card status-cyan">
                <span class="kpi-icon-bg">👁️</span>
                <div class="kpi-label">CAPTURA TOTAL OSINT</div>
                <div class="kpi-value">${totalRegistros}</div>
            </div>
            
            <div class="kpi-card status-red">
                <span class="kpi-icon-bg">☠️</span>
                <div class="kpi-label">INFRACTORES EN BLACKLIST</div>
                <div class="kpi-value">${totalBlacklist}</div>
            </div>
            
            <div class="kpi-card status-amber">
                <span class="kpi-icon-bg">🔗</span>
                <div class="kpi-label">ENLACES INTERCEPTADOS</div>
                <div class="kpi-value">${totalLinks}</div>
            </div>
            
            <div class="kpi-card ${alertasActivas > 0 ? 'status-amber' : 'status-green'}">
                <span class="kpi-icon-bg">⚠️</span>
                <div class="kpi-label">ALERTAS RECIENTES</div>
                <div class="kpi-value">${alertasActivas}</div>
            </div>
        `;
    },

    renderCharts(datos) {
        // Configuraciones base comunes para estética Cyber-Abyss
        const baseOptions = {
            chart: {
                background: 'transparent',
                foreColor: '#64748b', // var(--text-muted)
                toolbar: { show: false },
                animations: { enabled: true, easing: 'easeinout', speed: 800 }
            },
            theme: { mode: 'dark' },
            tooltip: { theme: 'dark' },
            dataLabels: { enabled: false },
            grid: {
                borderColor: 'rgba(0, 229, 255, 0.05)',
                strokeDashArray: 4,
            }
        };

        // 1. GRÁFICO DE ÁREA (LÍNEA DE TIEMPO)
        // Extraemos series de tiempo si el backend lo proporciona, o generamos un placeholder analítico
        const timelineData = datos.grafico_timeline || [
            { x: '00:00', y: 12 }, { x: '04:00', y: 5 }, { x: '08:00', y: 45 },
            { x: '12:00', y: 78 }, { x: '16:00', y: 34 }, { x: '20:00', y: 56 }
        ];

        const optionsTimeline = {
            ...baseOptions,
            chart: { ...baseOptions.chart, type: 'area', height: 300 },
            series: [{ name: 'Intercepciones', data: timelineData }],
            colors: ['#00e5ff'], // var(--accent-cyan)
            stroke: { curve: 'smooth', width: 2 },
            fill: {
                type: 'gradient',
                gradient: { shadeIntensity: 1, opacityFrom: 0.4, opacityTo: 0.05, stops: [0, 90, 100] }
            },
            xaxis: {
                type: 'category',
                axisBorder: { show: false },
                axisTicks: { show: false }
            }
        };

        this.charts.timeline = new ApexCharts(document.querySelector("#chart-timeline"), optionsTimeline);
        this.charts.timeline.render();

        // 2. GRÁFICO DE DONA (DISTRIBUCIÓN DE VECTORES)
        // Distribución por defecto basada en los módulos descritos en la arquitectura
        const distData = datos.grafico_distribucion || [
            datos.raids || 10, 
            datos.squads || 15, 
            datos.links ? datos.links.length : 25, 
            datos.org || 30
        ];

        const optionsDistribution = {
            ...baseOptions,
            chart: { ...baseOptions.chart, type: 'donut', height: 300 },
            series: distData,
            labels: ['Módulo Raids', 'Módulo Squads', 'LinksPortal', 'Radar Org'],
            colors: ['#ff3333', '#ffaa00', '#00e5ff', '#00ff66'], // Red, Amber, Cyan, Green
            stroke: { show: true, colors: ['#0a0f12'], width: 2 }, // Separadores oscuros
            plotOptions: {
                pie: {
                    donut: {
                        size: '75%',
                        labels: {
                            show: true,
                            name: { fontSize: '12px', fontFamily: 'JetBrains Mono' },
                            value: { fontSize: '24px', fontFamily: 'Share Tech Mono', color: '#e2e8f0' },
                            total: { show: true, label: 'TOTAL', color: '#00e5ff' }
                        }
                    }
                }
            },
            legend: { position: 'bottom', fontFamily: 'JetBrains Mono' }
        };

        this.charts.distribution = new ApexCharts(document.querySelector("#chart-distribution"), optionsDistribution);
        this.charts.distribution.render();
    },

    destroy() {
        // Purga activa de memoria: Destruir instancias de ApexCharts
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