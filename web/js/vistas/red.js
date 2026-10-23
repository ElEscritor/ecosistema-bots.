'use strict';

/* ==========================================================================
   VISTA: MAPA ESTELAR C4ISR v3.0 (HEXÁGONOS // LOD // CENIZA // DVR // VIP)
   Archivo: js/vistas/red.js
   ========================================================================== */

window.C4ISR_Views = window.C4ISR_Views || {};

const COLORES_ETIQUETA_SERVIDOR = {
    HOSTIL: '#ef4444',
    PROVEEDOR: '#f97316',
    SOCIAL: '#38bdf8',
    ALIADO: '#c084fc',
    OBJETIVO: '#fcee0a',
    CUSTOM: '#10b981'
};

window.C4ISR_Views.red = {
    canvas: null,
    ctx: null,
    animationFrameId: null,
    pollIntervalId: null,
    dvrPlayTimer: null,

    boundResize: null,
    boundMouseUp: null,

    nodes: new Map(),
    edges: [],
    altEdges: [],
    allianceEdges: [],
    adjacency: new Map(),
    serverMembers: new Map(),
    suspectPairs: [],
    altMapByUser: new Map(),
    dvrEvents: [],
    watchlistSet: new Set(),
    particles: [],
    dvrTraces: [],
    seenPulses: new Set(),

    camera: { x: 0, y: 0, zoom: 0.72 },
    isDraggingCanvas: false,
    draggedNode: null,
    hoveredNode: null,
    selectedNode: null,
    highlightedPair: null,
    lastMousePos: { x: 0, y: 0 },

    rightPanelTab: 'inspector', // 'inspector' | 'alts' | 'dvr'
    physicsEnabled: true,
    strategicMode: false,
    showUserLinks: true,
    showAltLinks: true,
    showAllianceLinks: true,
    onlyBridges: false,
    hideEmptyServers: false,
    searchTerm: '',

    async render(container) {
        container.innerHTML = `
            <div class="panel-header" style="margin-bottom: 0.6rem; padding-bottom: 0.5rem;">
                <div style="display: flex; align-items: center; gap: 0.45rem; flex-wrap: wrap;">
                    <span class="panel-title" style="font-size: 1.02rem; color: var(--accent-rz);">CARTOGRAFÍA ESTELAR C4ISR // SERVIDORES, CENIZA Y CÁMARA DVR</span>
                    <span id="red-stats-badge" class="badge badge-green">SINCRONIZANDO...</span>
                    <span id="red-alts-badge" class="badge badge-amber">0 ALTS</span>
                    <span id="red-ceniza-badge" class="badge badge-red hidden">0 EN CENIZA</span>
                </div>
                <div style="display: flex; gap: 0.35rem; flex-wrap: wrap;">
                    <button id="btn-toggle-strategic" class="btn-action" type="button" title="Oculta usuarios normales y muestra solo estaciones, puentes y rutas">VISTA ESTRATÉGICA: AUTO</button>
                    <button id="btn-toggle-empty-srv" class="btn-action" type="button">SIN VACÍOS: OFF</button>
                    <button id="btn-toggle-bridges" class="btn-action" type="button">SOLO PUENTES/VIP: OFF</button>
                    <button id="btn-toggle-alliances" class="btn-action" type="button">ALIANZAS: ON</button>
                    <button id="btn-toggle-chatlinks" class="btn-action" type="button">DIÁLOGO: ON</button>
                    <button id="btn-toggle-physics" class="btn-action" type="button">FÍSICAS: ON</button>
                    <button id="btn-center-graph" class="btn-action" type="button">CENTRAR</button>
                </div>
            </div>

            <div class="toolbar-tactical" style="margin-bottom: 0.6rem; padding: 0.5rem 0.85rem;">
                <div style="display: flex; align-items: center; gap: 0.5rem; flex: 1; min-width: 240px;">
                    <input type="text" id="red-search" class="search-input" style="width: 100%; max-width: 400px;" placeholder="Buscar servidor, etiqueta, usuario o UID (Enter para enfocar)..." autocomplete="off">
                </div>
                <div style="display: flex; gap: 0.85rem; align-items: center; font-family: var(--font-mono); font-size: 0.7rem; color: var(--text-secondary); flex-wrap: wrap;">
                    <span><strong style="color: #ef4444;">&#11042; HEX ROJO:</strong> SERVER ACTIVO</span>
                    <span><strong style="color: #94a3b8;">&#11042; HEX GRIS:</strong> SERVER CENIZA (RAIDEADO)</span>
                    <span><strong style="color: #10b981;">&#9679; VERDE:</strong> USUARIO</span>
                    <span><strong style="color: #fbbf24;">&#9733; ORO:</strong> PUENTE / VIP</span>
                    <span><strong style="color: #c084fc;">&#10548; PÚRPURA:</strong> ALIANZA</span>
                </div>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 375px; gap: 0.85rem; height: calc(100vh - 210px); min-height: 440px;">
                <div id="canvas-wrapper" style="position: relative; background: radial-gradient(circle at 50% 50%, #130f1e 0%, #060509 100%); border: var(--border-thin); border-radius: var(--radius-md); overflow: hidden;">
                    <canvas id="net-canvas" style="width: 100%; height: 100%; display: block; cursor: grab;"></canvas>

                    <div id="hud-coords" style="position: absolute; top: 10px; left: 12px; font-family: var(--font-mono); font-size: 0.68rem; color: rgba(255, 42, 109, 0.82); background: rgba(9, 8, 12, 0.8); padding: 4px 9px; border-left: 2px solid var(--accent-rz); pointer-events: none;">
                        C4ISR // SECTOR-SCAN // ZOOM: 72%
                    </div>

                    <div id="canvas-hover-tooltip" class="hidden" style="position: absolute; pointer-events: none; z-index: 30; background: rgba(11, 9, 16, 0.96); border: 1px solid var(--accent-rz); border-left: 3px solid var(--accent-rz); padding: 7px 11px; border-radius: 4px; font-family: var(--font-mono); font-size: 0.72rem; color: var(--text-main); box-shadow: 0 8px 22px rgba(0,0,0,0.9); max-width: 310px;"></div>

                    <div id="live-feed-ticker" style="position: absolute; bottom: 12px; left: 12px; right: 12px; max-width: fit-content; font-family: var(--font-mono); font-size: 0.72rem; color: var(--accent-green); background: rgba(9, 8, 12, 0.92); padding: 5px 12px; border: 1px solid rgba(16, 185, 129, 0.4); border-left: 3px solid var(--accent-green); border-radius: 4px; pointer-events: none; box-shadow: 0 4px 12px rgba(0,0,0,0.6);">
                        [RADAR ACTIVO] Escaneando tráfico e incursiones...
                    </div>
                </div>

                <div class="osint-panel" style="height: 100%;">
                    <div class="panel-header" style="margin: 0; padding: 0.55rem 0.7rem; display: flex; gap: 0.35rem;">
                        <button id="tab-btn-inspector" class="btn-action" type="button" style="flex: 1; padding: 0.4rem 0.3rem; font-size: 0.7rem; background: var(--accent-rz); color: #fff;">INSPECTOR</button>
                        <button id="tab-btn-alts" class="btn-action" type="button" style="flex: 1; padding: 0.4rem 0.3rem; font-size: 0.7rem;">ALTS (0)</button>
                        <button id="tab-btn-dvr" class="btn-action" type="button" style="flex: 1; padding: 0.4rem 0.3rem; font-size: 0.7rem;">CÁMARA DVR</button>
                    </div>
                    <div id="node-inspector-content" class="osint-content" style="font-family: var(--font-mono); font-size: 0.77rem;">
                        <div style="color: var(--text-muted); padding-top: 0.75rem; line-height: 1.55;">
                            &#11042; Haz clic sobre cualquier <strong style="color: #ef4444;">Estación Hexagonal (Servidor)</strong> para asignarle una etiqueta de 1-2 palabras, auditar su redundancia de exploradores o inspeccionar sus cenizas si fue raideado.<br><br>
                            &#9679; Haz clic sobre un <strong style="color: #10b981;">Usuario (Verde)</strong> para ver la edad real de su cuenta (Snowflake), activar el seguimiento <strong>VIP</strong> o cazar sus cuentas espejo.
                        </div>
                    </div>
                    <div id="alts-radar-content" class="osint-content hidden" style="font-family: var(--font-mono); font-size: 0.77rem;"></div>
                    <div id="dvr-camera-content" class="osint-content hidden" style="font-family: var(--font-mono); font-size: 0.77rem;"></div>
                </div>
            </div>
        `;

        this.canvas = document.getElementById('net-canvas');
        this.ctx = this.canvas.getContext('2d');

        this.resizeCanvas();
        this.bindEvents();
        await this.fetchAndSyncTopology();
        this.centerCamera();
        this.startAnimationLoop();

        this.pollIntervalId = setInterval(() => {
            this.fetchAndSyncTopology();
        }, 4000);
    },

    resizeCanvas() {
        const wrapper = document.getElementById('canvas-wrapper');
        if (!wrapper || !this.canvas) return;
        this.canvas.width = wrapper.clientWidth || 800;
        this.canvas.height = wrapper.clientHeight || 600;
    },

    centerCamera() {
        if (!this.canvas) return;
        this.camera.x = this.canvas.width / 2;
        this.camera.y = this.canvas.height / 2;
        this.camera.zoom = 0.72;
        this.updateHudCoords();
    },

    isStrategicViewActive() {
        return this.strategicMode || this.camera.zoom < 0.52;
    },

    updateHudCoords() {
        const hud = document.getElementById('hud-coords');
        if (hud) {
            const lodTag = this.isStrategicViewActive() ? 'MODO ESTELAR (CLANES/PUENTES)' : 'MODO TÁCTICO DETALLADO';
            hud.textContent = `C4ISR // ${lodTag} // ZOOM: ${Math.round(this.camera.zoom * 100)}% // NODOS: ${this.countVisibleNodes()}`;
        }
    },

    countVisibleNodes() {
        let count = 0;
        for (const n of this.nodes.values()) {
            if (this.isNodeVisible(n)) count++;
        }
        return count;
    },

    switchRightTab(tabName) {
        this.rightPanelTab = tabName;
        const inspectorEl = document.getElementById('node-inspector-content');
        const altsEl = document.getElementById('alts-radar-content');
        const dvrEl = document.getElementById('dvr-camera-content');
        const btnInsp = document.getElementById('tab-btn-inspector');
        const btnAlts = document.getElementById('tab-btn-alts');
        const btnDvr = document.getElementById('tab-btn-dvr');

        if (!inspectorEl || !altsEl || !dvrEl || !btnInsp || !btnAlts || !btnDvr) return;

        inspectorEl.classList.add('hidden');
        altsEl.classList.add('hidden');
        dvrEl.classList.add('hidden');

        [btnInsp, btnAlts, btnDvr].forEach(b => {
            b.style.background = 'rgba(255, 42, 109, 0.08)';
            b.style.color = 'var(--text-main)';
        });

        if (tabName === 'alts') {
            altsEl.classList.remove('hidden');
            btnAlts.style.background = 'var(--accent-rz)';
            btnAlts.style.color = '#ffffff';
            this.renderAltsRadarList();
        } else if (tabName === 'dvr') {
            dvrEl.classList.remove('hidden');
            btnDvr.style.background = 'var(--accent-rz)';
            btnDvr.style.color = '#ffffff';
            this.renderDvrCameraList();
        } else {
            inspectorEl.classList.remove('hidden');
            btnInsp.style.background = 'var(--accent-rz)';
            btnInsp.style.color = '#ffffff';
        }
    },

    bindEvents() {
        this.boundResize = () => this.resizeCanvas();
        this.boundMouseUp = () => {
            this.draggedNode = null;
            this.isDraggingCanvas = false;
        };

        window.addEventListener('resize', this.boundResize);
        window.addEventListener('mouseup', this.boundMouseUp);

        const btnStrategic = document.getElementById('btn-toggle-strategic');
        const btnEmptySrv = document.getElementById('btn-toggle-empty-srv');
        const btnAlliances = document.getElementById('btn-toggle-alliances');
        const btnPhysics = document.getElementById('btn-toggle-physics');
        const btnChatLinks = document.getElementById('btn-toggle-chatlinks');
        const btnBridges = document.getElementById('btn-toggle-bridges');
        const btnCenter = document.getElementById('btn-center-graph');
        const searchInput = document.getElementById('red-search');
        const tabInspector = document.getElementById('tab-btn-inspector');
        const tabAlts = document.getElementById('tab-btn-alts');
        const tabDvr = document.getElementById('tab-btn-dvr');

        if (tabInspector) tabInspector.addEventListener('click', () => this.switchRightTab('inspector'));
        if (tabAlts) tabAlts.addEventListener('click', () => this.switchRightTab('alts'));
        if (tabDvr) tabDvr.addEventListener('click', () => this.switchRightTab('dvr'));

        if (btnStrategic) {
            btnStrategic.addEventListener('click', () => {
                this.strategicMode = !this.strategicMode;
                btnStrategic.textContent = `VISTA ESTRATÉGICA: ${this.strategicMode ? 'FORZADA' : 'AUTO'}`;
                this.updateHudCoords();
            });
        }

        if (btnEmptySrv) {
            btnEmptySrv.addEventListener('click', () => {
                this.hideEmptyServers = !this.hideEmptyServers;
                btnEmptySrv.textContent = `SIN VACÍOS: ${this.hideEmptyServers ? 'ON' : 'OFF'}`;
                this.updateHudCoords();
            });
        }

        if (btnAlliances) {
            btnAlliances.addEventListener('click', () => {
                this.showAllianceLinks = !this.showAllianceLinks;
                btnAlliances.textContent = `ALIANZAS: ${this.showAllianceLinks ? 'ON' : 'OFF'}`;
            });
        }

        if (btnPhysics) {
            btnPhysics.addEventListener('click', () => {
                this.physicsEnabled = !this.physicsEnabled;
                btnPhysics.textContent = `FÍSICAS: ${this.physicsEnabled ? 'ON' : 'OFF'}`;
            });
        }

        if (btnChatLinks) {
            btnChatLinks.addEventListener('click', () => {
                this.showUserLinks = !this.showUserLinks;
                btnChatLinks.textContent = `DIÁLOGO: ${this.showUserLinks ? 'ON' : 'OFF'}`;
            });
        }

        if (btnBridges) {
            btnBridges.addEventListener('click', () => {
                this.onlyBridges = !this.onlyBridges;
                btnBridges.textContent = `SOLO PUENTES/VIP: ${this.onlyBridges ? 'ON' : 'OFF'}`;
                this.updateHudCoords();
            });
        }

        if (btnCenter) {
            btnCenter.addEventListener('click', () => {
                this.selectedNode = null;
                this.highlightedPair = null;
                this.centerCamera();
            });
        }

        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                this.searchTerm = e.target.value.toLowerCase().trim();
                this.updateHudCoords();
            });
            searchInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && this.searchTerm) {
                    for (const n of this.nodes.values()) {
                        if (this.isNodeVisible(n)) {
                            this.focusSingleNode(n);
                            break;
                        }
                    }
                }
            });
        }

        this.canvas.addEventListener('mousedown', (e) => {
            const pos = this.screenToWorld(e.offsetX, e.offsetY);
            const hit = this.findNodeAt(pos.x, pos.y);
            if (hit) {
                this.draggedNode = hit;
                this.selectedNode = hit;
                this.highlightedPair = null;
                this.switchRightTab('inspector');
                this.renderInspector(hit);
            } else {
                this.selectedNode = null;
                this.highlightedPair = null;
                this.isDraggingCanvas = true;
                this.lastMousePos = { x: e.clientX, y: e.clientY };
            }
        });

        this.canvas.addEventListener('mousemove', (e) => {
            const pos = this.screenToWorld(e.offsetX, e.offsetY);
            if (this.draggedNode) {
                this.draggedNode.x = pos.x;
                this.draggedNode.y = pos.y;
                this.draggedNode.vx = 0;
                this.draggedNode.vy = 0;
            } else if (this.isDraggingCanvas) {
                const dx = e.clientX - this.lastMousePos.x;
                const dy = e.clientY - this.lastMousePos.y;
                this.camera.x += dx;
                this.camera.y += dy;
                this.lastMousePos = { x: e.clientX, y: e.clientY };
            } else {
                const hit = this.findNodeAt(pos.x, pos.y);
                this.hoveredNode = hit;
                this.canvas.style.cursor = hit ? 'pointer' : 'grab';
                this.updateFloatingTooltip(hit, e.offsetX, e.offsetY);
            }
        });

        this.canvas.addEventListener('mouseleave', () => {
            this.hoveredNode = null;
            this.updateFloatingTooltip(null, 0, 0);
        });

        this.canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            const factor = e.deltaY < 0 ? 1.12 : 0.89;
            const newZoom = Math.max(0.15, Math.min(3.8, this.camera.zoom * factor));

            const wx = (e.offsetX - this.camera.x) / this.camera.zoom;
            const wy = (e.offsetY - this.camera.y) / this.camera.zoom;
            this.camera.zoom = newZoom;
            this.camera.x = e.offsetX - wx * newZoom;
            this.camera.y = e.offsetY - wy * newZoom;
            this.updateHudCoords();
        }, { passive: false });
    },

    updateFloatingTooltip(node, mx, my) {
        const tooltip = document.getElementById('canvas-hover-tooltip');
        if (!tooltip) return;
        if (!node) {
            tooltip.classList.add('hidden');
            return;
        }

        if (node.type === 'SERVER') {
            const membersCount = (this.serverMembers.get(node.key) || []).length;
            const esCeniza = Boolean(node.meta?.estadoCeniza?.raideado);
            const tagObj = node.meta?.etiquetaManual;
            const tagHtml = tagObj?.texto
                ? `<span style="background:rgba(255,255,255,0.1);padding:1px 5px;border-radius:3px;color:${COLORES_ETIQUETA_SERVIDOR[tagObj.tipo] || '#10b981'};margin-left:5px;">[${DOMPurify.sanitize(tagObj.texto)}]</span>`
                : '';
            const cenizaHtml = esCeniza
                ? `<div style="color:#f87171;font-weight:700;margin-top:2px;">[!] ESTADO CENIZA: ${DOMPurify.sanitize(node.meta.estadoCeniza.motivo || 'Raideado')}</div>`
                : '';
            const inviteTag = node.meta?.inviteUrl
                ? `<div style="color:#34d399;margin-top:2px;">&#128279; ${DOMPurify.sanitize(node.meta.inviteUrl)}</div>`
                : '';

            tooltip.style.borderColor = esCeniza ? '#94a3b8' : '#ef4444';
            tooltip.innerHTML = `
                <div style="color:${esCeniza ? '#cbd5e1' : '#ef4444'};font-weight:700;">&#11042; ${DOMPurify.sanitize(node.label)}${tagHtml}</div>
                <div style="color:var(--text-secondary);">Sujetos: <b>${membersCount}</b> | Msgs: <b>${node.meta?.mensajesSesion || 0}</b> | Bots: <b>${node.meta?.redundancia || 0}</b></div>
                ${cenizaHtml}
                ${inviteTag}
            `;
        } else {
            const statusColor = node.enWatchlist
                ? '#fbbf24'
                : (node.altRole ? '#fcee0a' : (node.fichado ? '#ff2a6d' : '#10b981'));
            const burnerBadge = node.meta?.esBurner
                ? `<span style="color:#ef4444;font-weight:700;"> [BURNER ${node.meta.diasAntiguedad}d]</span>`
                : '';
            tooltip.style.borderColor = statusColor;
            tooltip.innerHTML = `
                <div style="color:${statusColor};font-weight:700;">${node.enWatchlist ? '&#9733; [VIP] ' : '[USUARIO] '}${DOMPurify.sanitize(node.label)}${burnerBadge}</div>
                <div style="color:var(--text-secondary);">UID: ${DOMPurify.sanitize(String(node.rawId))}</div>
                <div style="color:var(--text-main);">Servers: <b>${node.serverCount}</b> | Msgs: <b>${node.meta?.totalMensajes || 0}</b> | Infracciones: <b>${node.infracciones}</b></div>
            `;
        }

        tooltip.classList.remove('hidden');
        const left = Math.min((this.canvas?.width || 800) - 315, mx + 16);
        const top = Math.max(12, my - 18);
        tooltip.style.left = `${left}px`;
        tooltip.style.top = `${top}px`;
    },

    screenToWorld(sx, sy) {
        return {
            x: (sx - this.camera.x) / this.camera.zoom,
            y: (sy - this.camera.y) / this.camera.zoom
        };
    },

    findNodeAt(wx, wy) {
        for (const node of this.nodes.values()) {
            if (node.type !== 'USER' || !this.isNodeVisible(node)) continue;
            const dx = wx - node.x;
            const dy = wy - node.y;
            if (Math.sqrt(dx * dx + dy * dy) <= node.radius + 4) return node;
        }
        for (const node of this.nodes.values()) {
            if (node.type !== 'SERVER' || !this.isNodeVisible(node)) continue;
            const dx = wx - node.x;
            const dy = wy - node.y;
            if (Math.sqrt(dx * dx + dy * dy) <= node.radius + 6) return node;
        }
        return null;
    },

    isNodeVisible(node) {
        if (node.type === 'SERVER' && this.hideEmptyServers) {
            const connected = (this.serverMembers.get(node.key) || []).length;
            const esCeniza = Boolean(node.meta?.estadoCeniza?.raideado);
            const tieneEtiqueta = Boolean(node.meta?.etiquetaManual?.texto);
            if (connected === 0 && !esCeniza && !tieneEtiqueta && (!node.meta?.alianzasSalientes || node.meta.alianzasSalientes.length === 0)) {
                return false;
            }
        }

        if (node.type === 'USER') {
            // Si estamos en Vista Estratégica (Zoom lejano o botón activo), ocultar usuarios comunes de 1 solo servidor
            // para eliminar el efecto "Agar.io" y dejar solo Puentes Multi-Server, Alts, VIPs o el nodo seleccionado
            if (this.isStrategicViewActive() && !this.searchTerm) {
                const isSelectedOrNeighbor = this.selectedNode &&
                    (this.selectedNode.key === node.key || (this.adjacency.get(this.selectedNode.key)?.has(node.key)));
                if (!isSelectedOrNeighbor && node.serverCount < 2 && !node.enWatchlist && !node.altRole) {
                    return false;
                }
            }
            if (this.onlyBridges) {
                if (node.serverCount < 2 && !node.fichado && !node.altRole && !node.enWatchlist) return false;
            }
        }

        if (this.searchTerm) {
            const tagText = String(node.meta?.etiquetaManual?.texto || '').toLowerCase();
            const prevName = String(node.meta?.nombreOriginal || '').toLowerCase();
            const matchSelf = node.label.toLowerCase().includes(this.searchTerm) ||
                prevName.includes(this.searchTerm) ||
                tagText.includes(this.searchTerm) ||
                String(node.rawId).includes(this.searchTerm) ||
                String(node.meta?.inviteUrl || '').toLowerCase().includes(this.searchTerm);
            if (matchSelf) return true;

            const neighbors = this.adjacency.get(node.key);
            if (neighbors) {
                for (const nKey of neighbors) {
                    const nb = this.nodes.get(nKey);
                    if (nb && (nb.label.toLowerCase().includes(this.searchTerm) || String(nb.meta?.etiquetaManual?.texto || '').toLowerCase().includes(this.searchTerm))) {
                        return true;
                    }
                }
            }
            return false;
        }
        return true;
    },

    analyzeMirrorAccounts(usuarios, interacciones) {
        const chatNeighbors = new Map();
        const directWeights = new Map();

        for (const u of usuarios) {
            chatNeighbors.set(u.id, new Set());
        }

        for (const rel of interacciones) {
            if (!chatNeighbors.has(rel.u1)) chatNeighbors.set(rel.u1, new Set());
            if (!chatNeighbors.has(rel.u2)) chatNeighbors.set(rel.u2, new Set());
            chatNeighbors.get(rel.u1).add(rel.u2);
            chatNeighbors.get(rel.u2).add(rel.u1);

            const pairKey = rel.u1 < rel.u2 ? `${rel.u1}:${rel.u2}` : `${rel.u2}:${rel.u1}`;
            directWeights.set(pairKey, rel.weight || 1);
        }

        const getBlockName = (h) => {
            if (h >= 0 && h < 6) return 'MADRUGADA';
            if (h >= 6 && h < 12) return 'MAÑANA';
            if (h >= 12 && h < 18) return 'TARDE';
            return 'NOCHE';
        };

        const candidatos = usuarios.filter(u => {
            const nChat = chatNeighbors.get(u.id)?.size || 0;
            const nSrv = Object.keys(u.servidores || {}).length;
            return (nChat + nSrv) >= 2;
        });

        const paresDetectados = [];
        const mapaAltsUsuario = new Map();

        for (let i = 0; i < candidatos.length; i++) {
            const u = candidatos[i];
            const uChatSet = chatNeighbors.get(u.id) || new Set();
            const uSrvKeys = Object.keys(u.servidores || {});

            for (let j = i + 1; j < candidatos.length; j++) {
                const v = candidatos[j];
                const pairKey = u.id < v.id ? `${u.id}:${v.id}` : `${v.id}:${u.id}`;
                const pesoDirecto = directWeights.get(pairKey) || 0;

                if (pesoDirecto > 1) continue;

                const vChatSet = chatNeighbors.get(v.id) || new Set();
                const vSrvKeys = Object.keys(v.servidores || {});

                const featuresU = new Set();
                const featuresV = new Set();

                uChatSet.forEach(id => { if (id !== v.id) featuresU.add(`USR_${id}`); });
                vChatSet.forEach(id => { if (id !== u.id) featuresV.add(`USR_${id}`); });
                uSrvKeys.forEach(sId => featuresU.add(`SRV_${sId}`));
                vSrvKeys.forEach(sId => featuresV.add(`SRV_${sId}`));

                if (featuresU.size < 2 || featuresV.size < 2) continue;

                const interseccion = [];
                for (const item of featuresU) {
                    if (featuresV.has(item)) interseccion.push(item);
                }

                const sharedServers = uSrvKeys.filter(s => vSrvKeys.includes(s));
                if (interseccion.length < 2 || sharedServers.length === 0) continue;

                const sharedChatPartners = [...uChatSet].filter(id => id !== v.id && vChatSet.has(id));
                if (sharedChatPartners.length === 0 && sharedServers.length < 3) continue;

                const unionSize = featuresU.size + featuresV.size - interseccion.length;
                const jaccard = unionSize > 0 ? (interseccion.length / unionSize) : 0;

                if (jaccard < 0.68) continue;

                const rawHoursU = Array.isArray(u.horasActivas) ? u.horasActivas : [];
                const rawHoursV = Array.isArray(v.horasActivas) ? v.horasActivas : [];
                const tieneMuestraHoraria = rawHoursU.length >= 2 && rawHoursV.length >= 2;

                const horasU = new Set(rawHoursU);
                const horasV = new Set(rawHoursV);
                let horasSuenoComunes = 0;

                if (tieneMuestraHoraria) {
                    for (let h = 0; h < 24; h++) {
                        if (!horasU.has(h) && !horasV.has(h)) horasSuenoComunes++;
                    }
                }

                const blocksU = new Set(rawHoursU.map(getBlockName));
                const blocksV = new Set(rawHoursV.map(getBlockName));
                let sharedBlocks = 0;
                blocksU.forEach(b => { if (blocksV.has(b)) sharedBlocks++; });
                const exclusionHoraria = tieneMuestraHoraria && (blocksU.size > 0 && blocksV.size > 0 && sharedBlocks === 0);

                let relevosRapidos = 0;
                for (const sId of sharedServers) {
                    const lastU = u.servidores[sId]?.lastSeen || 0;
                    const lastV = v.servidores[sId]?.lastSeen || 0;
                    const gapMs = Math.abs(lastU - lastV);
                    if (gapMs >= 8000 && gapMs <= 600000) {
                        relevosRapidos++;
                    }
                }

                const esCritico = (relevosRapidos >= 1 && sharedChatPartners.length >= 1) ||
                    (exclusionHoraria && horasSuenoComunes >= 6);
                const nivelAlerta = esCritico ? 'CRÍTICO' : 'ADVERTENCIA';

                const record = {
                    uId: u.id,
                    uTag: u.tag || 'Usuario',
                    vId: v.id,
                    vTag: v.tag || 'Usuario',
                    jaccard,
                    sharedChatCount: sharedChatPartners.length,
                    sharedServerCount: sharedServers.length,
                    sharedSleepHours: horasSuenoComunes,
                    fastHandoffs: relevosRapidos,
                    exclusionHoraria,
                    nivelAlerta
                };

                paresDetectados.push(record);

                if (!mapaAltsUsuario.has(u.id)) mapaAltsUsuario.set(u.id, []);
                if (!mapaAltsUsuario.has(v.id)) mapaAltsUsuario.set(v.id, []);
                mapaAltsUsuario.get(u.id).push({ mirrorId: v.id, mirrorTag: v.tag, ...record });
                mapaAltsUsuario.get(v.id).push({ mirrorId: u.id, mirrorTag: u.tag, ...record });
            }
        }

        paresDetectados.sort((a, b) => {
            if ((a.nivelAlerta === 'CRÍTICO') !== (b.nivelAlerta === 'CRÍTICO')) {
                return a.nivelAlerta === 'CRÍTICO' ? -1 : 1;
            }
            return b.jaccard - a.jaccard;
        });

        this.suspectPairs = paresDetectados;
        this.altMapByUser = mapaAltsUsuario;

        const badgeAlts = document.getElementById('red-alts-badge');
        if (badgeAlts) {
            badgeAlts.textContent = `${paresDetectados.length} ALTS`;
            badgeAlts.className = paresDetectados.some(p => p.nivelAlerta === 'CRÍTICO')
                ? 'badge badge-red'
                : (paresDetectados.length > 0 ? 'badge badge-amber' : 'badge badge-green');
        }

        const tabBtnAlts = document.getElementById('tab-btn-alts');
        if (tabBtnAlts) {
            tabBtnAlts.textContent = `ALTS (${paresDetectados.length})`;
        }

        if (this.rightPanelTab === 'alts') {
            this.renderAltsRadarList();
        }
    },

    async fetchAndSyncTopology() {
        try {
            const data = await window.C4ISR_API.getRedTopologia();
            const servidores = Array.isArray(data.servidores) ? data.servidores : [];
            const usuarios = Array.isArray(data.usuarios) ? data.usuarios : [];
            const interacciones = Array.isArray(data.interacciones) ? data.interacciones : [];
            const alianzas = Array.isArray(data.alianzas) ? data.alianzas : [];
            const pulsos = Array.isArray(data.pulsos) ? data.pulsos : [];
            this.dvrEvents = Array.isArray(data.bitacoraDvr) ? data.bitacoraDvr.slice().reverse() : [];
            this.watchlistSet = new Set(Array.isArray(data.watchlist) ? data.watchlist.map(String) : []);

            const badge = document.getElementById('red-stats-badge');
            if (badge) {
                badge.textContent = `${servidores.length} ESTACIONES // ${usuarios.length} SUJETOS`;
            }

            const totalCeniza = servidores.filter(s => s.estadoCeniza?.raideado).length;
            const cenizaBadge = document.getElementById('red-ceniza-badge');
            if (cenizaBadge) {
                if (totalCeniza > 0) {
                    cenizaBadge.textContent = `${totalCeniza} EN CENIZA`;
                    cenizaBadge.classList.remove('hidden');
                } else {
                    cenizaBadge.classList.add('hidden');
                }
            }

            this.analyzeMirrorAccounts(usuarios, interacciones);

            this.adjacency.clear();
            this.serverMembers.clear();

            const addNeighbor = (k1, k2) => {
                if (!this.adjacency.has(k1)) this.adjacency.set(k1, new Set());
                if (!this.adjacency.has(k2)) this.adjacency.set(k2, new Set());
                this.adjacency.get(k1).add(k2);
                this.adjacency.get(k2).add(k1);
            };

            const activeServers = servidores.filter(
                s => (s.usuariosCount || 0) > 0 || (s.alianzasSalientes && s.alianzasSalientes.length > 0) || s.estadoCeniza?.raideado
            );
            const emptyServers = servidores.filter(
                s => (s.usuariosCount || 0) === 0 && (!s.alianzasSalientes || s.alianzasSalientes.length === 0) && !s.estadoCeniza?.raideado
            );

            activeServers.forEach((srv, idx) => {
                const key = `SRV_${srv.id}`;
                this.serverMembers.set(key, []);
                let node = this.nodes.get(key);
                const radius = Math.max(22, Math.min(48, 18 + Math.sqrt(srv.usuariosCount || 1) * 2.5));
                if (!node) {
                    const angle = (idx / Math.max(1, activeServers.length)) * Math.PI * 2;
                    const dist = activeServers.length === 1 ? 0 : 300 + (idx % 2) * 150;
                    node = {
                        key,
                        rawId: srv.id,
                        type: 'SERVER',
                        label: srv.name || 'Servidor',
                        x: Math.cos(angle) * dist,
                        y: Math.sin(angle) * dist,
                        vx: 0,
                        vy: 0,
                        radius,
                        connectedUsersCount: srv.usuariosCount || 0,
                        meta: srv
                    };
                    this.nodes.set(key, node);
                } else {
                    node.label = srv.name || node.label;
                    node.radius = radius;
                    node.connectedUsersCount = srv.usuariosCount || 0;
                    node.meta = srv;
                }
            });

            emptyServers.forEach((srv, idx) => {
                const key = `SRV_${srv.id}`;
                this.serverMembers.set(key, []);
                let node = this.nodes.get(key);
                if (!node) {
                    const angle = (idx / Math.max(1, emptyServers.length)) * Math.PI * 2;
                    const ringRadius = 680 + (idx % 3) * 90;
                    node = {
                        key,
                        rawId: srv.id,
                        type: 'SERVER',
                        label: srv.name || 'Servidor',
                        x: Math.cos(angle) * ringRadius,
                        y: Math.sin(angle) * ringRadius,
                        vx: 0,
                        vy: 0,
                        radius: 16,
                        connectedUsersCount: 0,
                        meta: srv
                    };
                    this.nodes.set(key, node);
                } else {
                    node.label = srv.name || node.label;
                    node.connectedUsersCount = 0;
                    node.meta = srv;
                }
            });

            const nuevasAristas = [];
            const serverSpawnIndex = new Map();

            usuarios.forEach((usr) => {
                const key = `USR_${usr.id}`;
                const srvKeys = Object.keys(usr.servidores || {});
                const serverCount = srvKeys.length;
                const altsDeUsuario = this.altMapByUser.get(usr.id) || [];
                const altRole = altsDeUsuario.some(a => a.nivelAlerta === 'CRÍTICO')
                    ? 'CRITICO'
                    : (altsDeUsuario.length > 0 ? 'ADVERTENCIA' : null);
                const enWatchlist = Boolean(usr.enWatchlist || this.watchlistSet.has(String(usr.id)));

                const radius = Math.max(
                    6.5,
                    Math.min(18, 5.5 + Math.log2((usr.totalMensajes || 1) + 1) * 1.9 + (serverCount > 1 ? 3.5 : 0) + (enWatchlist ? 3 : 0))
                );

                let node = this.nodes.get(key);
                if (!node) {
                    const firstSrvKey = srvKeys.length > 0 ? `SRV_${srvKeys[0]}` : null;
                    const parentSrv = firstSrvKey ? this.nodes.get(firstSrvKey) : null;
                    const idxInSrv = (serverSpawnIndex.get(firstSrvKey) || 0);
                    serverSpawnIndex.set(firstSrvKey, idxInSrv + 1);

                    const goldenAngle = idxInSrv * 2.3999632;
                    const spiralRadius = 58 + Math.sqrt(idxInSrv + 1) * 23;
                    const baseX = parentSrv ? parentSrv.x : 0;
                    const baseY = parentSrv ? parentSrv.y : 0;

                    node = {
                        key,
                        rawId: usr.id,
                        type: 'USER',
                        label: usr.tag || 'Usuario',
                        x: baseX + Math.cos(goldenAngle) * spiralRadius,
                        y: baseY + Math.sin(goldenAngle) * spiralRadius,
                        vx: 0,
                        vy: 0,
                        radius,
                        serverCount,
                        fichado: Boolean(usr.fichado),
                        infracciones: usr.infracciones || 0,
                        enWatchlist,
                        altRole,
                        meta: usr
                    };
                    this.nodes.set(key, node);
                } else {
                    node.label = usr.tag || node.label;
                    node.radius = radius;
                    node.serverCount = serverCount;
                    node.fichado = Boolean(usr.fichado);
                    node.infracciones = usr.infracciones || 0;
                    node.enWatchlist = enWatchlist;
                    node.altRole = altRole;
                    node.meta = usr;
                }

                for (const sId of srvKeys) {
                    const targetKey = `SRV_${sId}`;
                    if (this.nodes.has(targetKey)) {
                        nuevasAristas.push({
                            source: key,
                            target: targetKey,
                            weight: usr.servidores[sId].count || 1,
                            kind: 'MEMBERSHIP'
                        });
                        addNeighbor(key, targetKey);
                        if (!this.serverMembers.has(targetKey)) this.serverMembers.set(targetKey, []);
                        this.serverMembers.get(targetKey).push(node);
                    }
                }
            });

            for (const rel of interacciones) {
                const k1 = `USR_${rel.u1}`;
                const k2 = `USR_${rel.u2}`;
                if (this.nodes.has(k1) && this.nodes.has(k2)) {
                    nuevasAristas.push({
                        source: k1,
                        target: k2,
                        weight: rel.weight || 1,
                        kind: 'CHAT'
                    });
                    addNeighbor(k1, k2);
                }
            }

            this.altEdges = [];
            for (const pair of this.suspectPairs) {
                const k1 = `USR_${pair.uId}`;
                const k2 = `USR_${pair.vId}`;
                if (this.nodes.has(k1) && this.nodes.has(k2)) {
                    this.altEdges.push({
                        source: k1,
                        target: k2,
                        jaccard: pair.jaccard,
                        critical: pair.nivelAlerta === 'CRÍTICO'
                    });
                    addNeighbor(k1, k2);
                }
            }

            this.allianceEdges = [];
            for (const ally of alianzas) {
                const sKey = `SRV_${ally.sourceServerId}`;
                const tKey = `SRV_${ally.targetServerId}`;
                if (this.nodes.has(sKey) && this.nodes.has(tKey)) {
                    this.allianceEdges.push({
                        source: sKey,
                        target: tKey,
                        code: ally.code,
                        inviteUrl: ally.inviteUrl
                    });
                    addNeighbor(sKey, tKey);
                }
            }

            this.edges = nuevasAristas;
            this.updateHudCoords();

            if (this.seenPulses.size > 500) this.seenPulses.clear();
            for (const p of pulsos) {
                const pulseKey = `${p.userId}_${p.guildId}_${p.ts}`;
                if (!this.seenPulses.has(pulseKey)) {
                    this.seenPulses.add(pulseKey);
                    const isVip = this.watchlistSet.has(String(p.userId));
                    this.spawnParticle(`USR_${p.userId}`, `SRV_${p.guildId}`, isVip ? '#fbbf24' : '#34d399');
                    const ticker = document.getElementById('live-feed-ticker');
                    if (ticker) {
                        const vipPrefix = isVip ? '<span style="color:#fbbf24;font-weight:700;">[★ VIP EN MOVIMIENTO]</span> ' : '[IMPULSO EN VIVO] ';
                        ticker.innerHTML = `${vipPrefix}<strong>${DOMPurify.sanitize(String(p.userTag))}</strong> &rarr; ${DOMPurify.sanitize(String(p.guildName))}`;
                    }
                }
            }

            if (this.rightPanelTab === 'dvr') {
                this.renderDvrCameraList();
            }

            if (this.selectedNode && this.nodes.has(this.selectedNode.key)) {
                this.selectedNode = this.nodes.get(this.selectedNode.key);
                if (this.rightPanelTab === 'inspector') {
                    // Evitar pisar el input de etiqueta si el usuario está escribiendo en él
                    const activeEl = document.activeElement;
                    if (!activeEl || activeEl.id !== 'input-srv-tag') {
                        this.renderInspector(this.selectedNode);
                    }
                }
            }
        } catch (err) {
            console.error('[Vista Red] Error sincronizando topología:', err);
        }
    },

    spawnParticle(sourceKey, targetKey, color = '#34d399') {
        if (!this.nodes.has(sourceKey) || !this.nodes.has(targetKey)) return;
        this.particles.push({
            sourceKey,
            targetKey,
            color,
            progress: 0,
            speed: 0.022 + Math.random() * 0.014
        });
    },

    spawnDvrTrace(fromSrvKey, toSrvKey, label, color = '#fcee0a') {
        if (!this.nodes.has(fromSrvKey) || !this.nodes.has(toSrvKey)) return;
        this.dvrTraces.push({
            fromKey: fromSrvKey,
            toKey: toSrvKey,
            label,
            color,
            progress: 0,
            alpha: 1.0
        });
    },

    focusSingleNode(node) {
        if (!node || !this.canvas) return;
        this.selectedNode = node;
        this.highlightedPair = null;
        this.camera.zoom = 1.2;
        this.camera.x = (this.canvas.width / 2) - (node.x * this.camera.zoom);
        this.camera.y = (this.canvas.height / 2) - (node.y * this.camera.zoom);
        this.switchRightTab('inspector');
        this.renderInspector(node);
        this.updateHudCoords();
    },

    focusOnNodePair(key1, key2) {
        const n1 = this.nodes.get(key1);
        const n2 = this.nodes.get(key2);
        if (!n1 || !n2 || !this.canvas) return;

        this.selectedNode = null;
        this.highlightedPair = [key1, key2];
        const midX = (n1.x + n2.x) / 2;
        const midY = (n1.y + n2.y) / 2;
        this.camera.zoom = 1.05;
        this.camera.x = (this.canvas.width / 2) - (midX * this.camera.zoom);
        this.camera.y = (this.canvas.height / 2) - (midY * this.camera.zoom);
        this.updateHudCoords();
    },

    stepPhysics() {
        if (!this.physicsEnabled) return;
        const visibleNodes = Array.from(this.nodes.values()).filter(n => this.isNodeVisible(n));

        for (let i = 0; i < visibleNodes.length; i++) {
            const n1 = visibleNodes[i];
            for (let j = i + 1; j < visibleNodes.length; j++) {
                const n2 = visibleNodes[j];
                let dx = n2.x - n1.x;
                let dy = n2.y - n1.y;
                let distSq = dx * dx + dy * dy;
                if (distSq < 1) {
                    dx = (Math.random() - 0.5) * 2;
                    dy = (Math.random() - 0.5) * 2;
                    distSq = 4;
                }
                const bothServers = n1.type === 'SERVER' && n2.type === 'SERVER';
                const maxDist = bothServers ? 650 : 290;
                if (distSq > maxDist * maxDist) continue;

                const dist = Math.sqrt(distSq);
                const repulsionForce = bothServers ? 5600 : 1020;
                const force = repulsionForce / distSq;
                const fx = (dx / dist) * force;
                const fy = (dy / dist) * force;

                if (n1 !== this.draggedNode) { n1.vx -= fx; n1.vy -= fy; }
                if (n2 !== this.draggedNode) { n2.vx += fx; n2.vy += fy; }
            }
        }

        for (const edge of this.edges) {
            if (edge.kind === 'CHAT' && !this.showUserLinks) continue;
            const s = this.nodes.get(edge.source);
            const t = this.nodes.get(edge.target);
            if (!s || !t || !this.isNodeVisible(s) || !this.isNodeVisible(t)) continue;

            const dx = t.x - s.x;
            const dy = t.y - s.y;
            const dist = Math.sqrt(dx * dx + dy * dy) || 1;

            let targetLen = 85;
            if (edge.kind === 'MEMBERSHIP') {
                const srvMembers = (this.serverMembers.get(t.key) || []).length;
                targetLen = 98 + Math.min(270, Math.sqrt(srvMembers) * 16.5);
            }

            const strength = edge.kind === 'MEMBERSHIP' ? 0.032 : 0.012;
            const force = (dist - targetLen) * strength;
            const fx = (dx / dist) * force;
            const fy = (dy / dist) * force;

            if (s !== this.draggedNode) { s.vx += fx; s.vy += fy; }
            if (t !== this.draggedNode) { t.vx -= fx * 0.12; t.vy -= fy * 0.12; }
        }

        for (const n of visibleNodes) {
            if (n === this.draggedNode) continue;
            const esCeniza = Boolean(n.meta?.estadoCeniza?.raideado);
            if (n.type === 'SERVER' && n.connectedUsersCount === 0 && !esCeniza && (!n.meta?.alianzasSalientes || n.meta.alianzasSalientes.length === 0)) {
                const distCenter = Math.sqrt(n.x * n.x + n.y * n.y) || 1;
                const targetRing = 710;
                const radialForce = (targetRing - distCenter) * 0.008;
                n.vx += (n.x / distCenter) * radialForce;
                n.vy += (n.y / distCenter) * radialForce;
            } else {
                n.vx -= n.x * 0.0009;
                n.vy -= n.y * 0.0009;
            }
            n.vx *= 0.80;
            n.vy *= 0.80;
            n.x += n.vx;
            n.y += n.vy;
        }
    },

    drawHexagon(ctx, x, y, radius) {
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
            const angle = (Math.PI / 3) * i - Math.PI / 6;
            const hx = x + radius * Math.cos(angle);
            const hy = y + radius * Math.sin(angle);
            if (i === 0) ctx.moveTo(hx, hy);
            else ctx.lineTo(hx, hy);
        }
        ctx.closePath();
    },

    drawTacticalGrid(ctx, w, h) {
        ctx.save();
        const gridStep = 85 * this.camera.zoom;
        if (gridStep >= 18) {
            ctx.strokeStyle = 'rgba(255, 42, 109, 0.04)';
            ctx.lineWidth = 1;
            const offsetX = this.camera.x % gridStep;
            const offsetY = this.camera.y % gridStep;

            ctx.beginPath();
            for (let x = offsetX; x < w; x += gridStep) {
                ctx.moveTo(x, 0);
                ctx.lineTo(x, h);
            }
            for (let y = offsetY; y < h; y += gridStep) {
                ctx.moveTo(0, y);
                ctx.lineTo(w, y);
            }
            ctx.stroke();
        }
        ctx.restore();
    },

    drawFrame() {
        if (!this.ctx || !this.canvas) return;
        const ctx = this.ctx;
        const w = this.canvas.width;
        const h = this.canvas.height;
        const now = Date.now();
        const t = now * 0.0045;
        const pulse = (Math.sin(t) + 1) * 0.5;

        ctx.clearRect(0, 0, w, h);
        this.drawTacticalGrid(ctx, w, h);

        const focusNode = this.hoveredNode || this.selectedNode;
        const focusNeighbors = focusNode ? (this.adjacency.get(focusNode.key) || new Set()) : null;

        const isNodeHighlighted = (nodeKey) => {
            if (this.highlightedPair) return this.highlightedPair.includes(nodeKey);
            if (!focusNode) return true;
            return nodeKey === focusNode.key || (focusNeighbors && focusNeighbors.has(nodeKey));
        };

        ctx.save();
        ctx.translate(this.camera.x, this.camera.y);
        ctx.scale(this.camera.zoom, this.camera.zoom);

        // 0. Dibujar Halos de Soberanía (Territorios de Clanes/Servidores Activos)
        for (const node of this.nodes.values()) {
            if (node.type !== 'SERVER' || !this.isNodeVisible(node) || node.connectedUsersCount < 3) continue;
            const esCeniza = Boolean(node.meta?.estadoCeniza?.raideado);
            const territoryRadius = Math.min(220, 65 + Math.sqrt(node.connectedUsersCount) * 14);
            const grad = ctx.createRadialGradient(node.x, node.y, node.radius, node.x, node.y, territoryRadius);
            if (esCeniza) {
                grad.addColorStop(0, 'rgba(100, 116, 139, 0.14)');
                grad.addColorStop(1, 'rgba(100, 116, 139, 0)');
            } else {
                grad.addColorStop(0, 'rgba(239, 68, 68, 0.09)');
                grad.addColorStop(1, 'rgba(239, 68, 68, 0)');
            }
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(node.x, node.y, territoryRadius, 0, Math.PI * 2);
            ctx.fill();
        }

        // 1. Dibujar Aristas de Membresía y Chat
        for (const edge of this.edges) {
            if (edge.kind === 'CHAT' && !this.showUserLinks) continue;
            const s = this.nodes.get(edge.source);
            const tNode = this.nodes.get(edge.target);
            if (!s || !tNode || !this.isNodeVisible(s) || !this.isNodeVisible(tNode)) continue;

            const edgeActive = !focusNode
                ? !this.highlightedPair
                : (s.key === focusNode.key || tNode.key === focusNode.key);

            ctx.beginPath();
            ctx.moveTo(s.x, s.y);
            ctx.lineTo(tNode.x, tNode.y);
            if (edge.kind === 'MEMBERSHIP') {
                const isBridge = s.serverCount >= 2 || s.enWatchlist;
                if (focusNode && edgeActive) {
                    ctx.strokeStyle = isBridge ? 'rgba(251, 191, 36, 0.88)' : 'rgba(16, 185, 129, 0.72)';
                    ctx.lineWidth = 2.0;
                } else {
                    const alpha = edgeActive ? (isBridge ? 0.45 : 0.20) : 0.035;
                    ctx.strokeStyle = isBridge ? `rgba(251, 191, 36, ${alpha})` : `rgba(16, 185, 129, ${alpha})`;
                    ctx.lineWidth = Math.min(3.0, 0.8 + Math.log2(edge.weight + 1) * 0.45);
                }
            } else {
                const alpha = edgeActive ? 0.36 : 0.035;
                ctx.strokeStyle = `rgba(56, 189, 248, ${alpha})`;
                ctx.lineWidth = edgeActive && focusNode ? 1.8 : 1.0;
            }
            ctx.stroke();
        }

        // 2. Dibujar Rutas Curvas Hiperespaciales de Alianzas (Curvas de Bézier Púrpura)
        if (this.showAllianceLinks) {
            for (const ally of this.allianceEdges) {
                const s = this.nodes.get(ally.source);
                const tNode = this.nodes.get(ally.target);
                if (!s || !tNode || !this.isNodeVisible(s) || !this.isNodeVisible(tNode)) continue;

                const isHighlighted = !focusNode || focusNode.key === s.key || focusNode.key === tNode.key;
                const dx = tNode.x - s.x;
                const dy = tNode.y - s.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist <= s.radius + tNode.radius) continue;

                // Punto de control perpendicular para formar un arco limpio sin cruzar el centro como una telaraña
                const midX = (s.x + tNode.x) / 2;
                const midY = (s.y + tNode.y) / 2;
                const normX = -dy / dist;
                const normY = dx / dist;
                const curveOffset = Math.min(90, dist * 0.18);
                const ctrlX = midX + normX * curveOffset;
                const ctrlY = midY + normY * curveOffset;

                ctx.save();
                ctx.globalAlpha = isHighlighted ? 0.88 : 0.10;
                ctx.beginPath();
                ctx.moveTo(s.x, s.y);
                ctx.quadraticCurveTo(ctrlX, ctrlY, tNode.x, tNode.y);
                ctx.strokeStyle = '#c084fc';
                ctx.lineWidth = isHighlighted && focusNode ? 2.6 : 1.8;
                ctx.stroke();

                // Pulso viajero sobre la curva de alianza
                const u = ((now * 0.00045) % 1.0);
                const invU = 1 - u;
                const px = invU * invU * s.x + 2 * invU * u * ctrlX + u * u * tNode.x;
                const py = invU * invU * s.y + 2 * invU * u * ctrlY + u * u * tNode.y;
                ctx.beginPath();
                ctx.arc(px, py, 3.0, 0, Math.PI * 2);
                ctx.fillStyle = '#e9d5ff';
                ctx.fill();
                ctx.restore();
            }
        }

        // 3. Dibujar Enlaces Espejo Punteados entre Cuentas Alt Detectadas
        if (this.showAltLinks) {
            for (const altEdge of this.altEdges) {
                const s = this.nodes.get(altEdge.source);
                const tNode = this.nodes.get(altEdge.target);
                if (!s || !tNode || !this.isNodeVisible(s) || !this.isNodeVisible(tNode)) continue;

                const isHighlighted = (this.highlightedPair &&
                    this.highlightedPair.includes(s.key) &&
                    this.highlightedPair.includes(tNode.key)) ||
                    (focusNode && (focusNode.key === s.key || focusNode.key === tNode.key));

                ctx.save();
                ctx.beginPath();
                ctx.setLineDash([6, 6]);
                ctx.moveTo(s.x, s.y);
                ctx.lineTo(tNode.x, tNode.y);
                ctx.strokeStyle = altEdge.critical ? '#ff003c' : '#fcee0a';
                ctx.globalAlpha = (!focusNode || isHighlighted) ? 0.95 : 0.15;
                ctx.lineWidth = isHighlighted ? 2.8 : 1.6;
                ctx.stroke();

                if (this.camera.zoom > 0.65 || isHighlighted) {
                    const mx = (s.x + tNode.x) / 2;
                    const my = (s.y + tNode.y) / 2;
                    ctx.font = 'bold 9.5px "JetBrains Mono", monospace';
                    ctx.fillStyle = altEdge.critical ? '#ff003c' : '#fcee0a';
                    ctx.textAlign = 'center';
                    ctx.fillText(`ALT ${Math.round(altEdge.jaccard * 100)}%`, mx, my - 5);
                }
                ctx.restore();
            }
        }

        // 4. Dibujar Trazas de Reproducción de Cámara DVR (Saltos de Servidor a Servidor)
        for (let i = this.dvrTraces.length - 1; i >= 0; i--) {
            const tr = this.dvrTraces[i];
            tr.progress = Math.min(1.0, tr.progress + 0.018);
            if (tr.progress >= 1.0) {
                tr.alpha -= 0.008;
                if (tr.alpha <= 0) {
                    this.dvrTraces.splice(i, 1);
                    continue;
                }
            }
            const nFrom = this.nodes.get(tr.fromKey);
            const nTo = this.nodes.get(tr.toKey);
            if (!nFrom || !nTo) continue;

            const curX = nFrom.x + (nTo.x - nFrom.x) * tr.progress;
            const curY = nFrom.y + (nTo.y - nFrom.y) * tr.progress;

            ctx.save();
            ctx.globalAlpha = tr.alpha;
            ctx.beginPath();
            ctx.setLineDash([8, 4]);
            ctx.moveTo(nFrom.x, nFrom.y);
            ctx.lineTo(curX, curY);
            ctx.strokeStyle = tr.color;
            ctx.lineWidth = 3.2;
            ctx.stroke();

            ctx.beginPath();
            ctx.arc(curX, curY, 6, 0, Math.PI * 2);
            ctx.fillStyle = '#ffffff';
            ctx.shadowColor = tr.color;
            ctx.shadowBlur = 14;
            ctx.fill();

            ctx.font = 'bold 11px "JetBrains Mono", monospace';
            ctx.fillStyle = tr.color;
            ctx.textAlign = 'center';
            ctx.fillText(tr.label, curX, curY - 12);
            ctx.restore();
        }

        // 5. Dibujar Partículas de Actividad en Vivo
        for (let i = this.particles.length - 1; i >= 0; i--) {
            const p = this.particles[i];
            p.progress += p.speed;
            if (p.progress >= 1) {
                this.particles.splice(i, 1);
                continue;
            }
            const s = this.nodes.get(p.sourceKey);
            const tNode = this.nodes.get(p.targetKey);
            if (!s || !tNode) continue;

            const px = s.x + (tNode.x - s.x) * p.progress;
            const py = s.y + (tNode.y - s.y) * p.progress;

            ctx.beginPath();
            ctx.arc(px, py, 3.6, 0, Math.PI * 2);
            ctx.fillStyle = p.color || '#34d399';
            ctx.shadowColor = p.color || '#10b981';
            ctx.shadowBlur = 10;
            ctx.fill();
            ctx.shadowBlur = 0;
        }

        // 6. Dibujar Nodos (Servidores = Estaciones Hexagonales, Usuarios = Satélites Tácticos)
        for (const node of this.nodes.values()) {
            if (!this.isNodeVisible(node)) continue;

            const isActive = isNodeHighlighted(node.key);
            const isSelected = (this.selectedNode && this.selectedNode.key === node.key) ||
                (this.highlightedPair && this.highlightedPair.includes(node.key));
            const isHovered = this.hoveredNode && this.hoveredNode.key === node.key;

            ctx.save();
            ctx.globalAlpha = isActive ? 1.0 : 0.14;

            if (node.type === 'SERVER') {
                const hasUsers = node.connectedUsersCount > 0;
                const esCeniza = Boolean(node.meta?.estadoCeniza?.raideado);
                const etiquetaObj = node.meta?.etiquetaManual;

                // Anillo exterior hexagonal pulsante
                if (hasUsers || esCeniza || isSelected || isHovered) {
                    this.drawHexagon(ctx, node.x, node.y, node.radius + 6 + pulse * 6);
                    if (esCeniza) {
                        ctx.setLineDash([5, 4]);
                        ctx.strokeStyle = `rgba(148, 163, 184, ${0.7 - pulse * 0.35})`;
                    } else {
                        ctx.strokeStyle = `rgba(239, 68, 68, ${0.6 - pulse * 0.4})`;
                    }
                    ctx.lineWidth = 1.8;
                    ctx.stroke();
                    ctx.setLineDash([]);
                }

                // Cuerpo Hexagonal del Servidor
                this.drawHexagon(ctx, node.x, node.y, node.radius);
                if (esCeniza) {
                    ctx.fillStyle = '#334155'; // Gris Carbón Ceniza
                } else {
                    ctx.fillStyle = hasUsers ? '#dc2626' : '#5c1414';
                }
                ctx.fill();
                ctx.lineWidth = isSelected || isHovered ? 3.2 : 1.8;
                ctx.strokeStyle = isSelected || isHovered
                    ? '#ffffff'
                    : (esCeniza ? '#94a3b8' : '#fca5a5');
                ctx.stroke();

                // Núcleo interior táctico
                this.drawHexagon(ctx, node.x, node.y, node.radius * 0.45);
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)';
                ctx.lineWidth = 1;
                ctx.stroke();

                // Insignia superior si tiene Etiqueta Manual (1-2 palabras) o si está en Estado Ceniza
                if (esCeniza) {
                    ctx.font = 'bold 9.5px "JetBrains Mono", monospace';
                    ctx.fillStyle = '#cbd5e1';
                    ctx.textAlign = 'center';
                    ctx.fillText('[CENIZA // RAIDEADO]', node.x, node.y - node.radius - 9);
                } else if (etiquetaObj && etiquetaObj.texto) {
                    const tagColor = COLORES_ETIQUETA_SERVIDOR[etiquetaObj.tipo] || '#10b981';
                    ctx.font = 'bold 9.5px "JetBrains Mono", monospace';
                    ctx.fillStyle = tagColor;
                    ctx.textAlign = 'center';
                    ctx.fillText(`[${etiquetaObj.texto}]`, node.x, node.y - node.radius - 9);
                }

                // Nombre del Servidor debajo del Hexágono
                ctx.font = 'bold 11px "JetBrains Mono", monospace';
                ctx.fillStyle = esCeniza ? '#94a3b8' : '#ffffff';
                ctx.textAlign = 'center';
                ctx.fillText(node.label.slice(0, 25), node.x, node.y + node.radius + 15);
            } else {
                const isBridge = node.serverCount >= 2;
                const isVip = Boolean(node.enWatchlist);

                if (isVip) {
                    ctx.save();
                    ctx.translate(node.x, node.y);
                    ctx.rotate(t * 0.7);
                    ctx.beginPath();
                    ctx.setLineDash([5, 3]);
                    ctx.arc(0, 0, node.radius + 8 + pulse * 5, 0, Math.PI * 2);
                    ctx.strokeStyle = '#fbbf24';
                    ctx.lineWidth = 2.2;
                    ctx.stroke();
                    ctx.restore();
                } else if (node.altRole) {
                    const isCrit = node.altRole === 'CRITICO';
                    ctx.save();
                    ctx.translate(node.x, node.y);
                    ctx.rotate(isCrit ? t * 0.6 : -t * 0.4);
                    ctx.beginPath();
                    ctx.setLineDash([4, 4]);
                    ctx.arc(0, 0, node.radius + 7 + pulse * 4, 0, Math.PI * 2);
                    ctx.strokeStyle = isCrit ? '#ff003c' : '#fcee0a';
                    ctx.lineWidth = 1.8;
                    ctx.stroke();
                    ctx.restore();
                } else if (isBridge || node.fichado) {
                    ctx.beginPath();
                    ctx.arc(node.x, node.y, node.radius + 3.5 + pulse * 3, 0, Math.PI * 2);
                    ctx.strokeStyle = node.fichado ? '#ff2a6d' : '#fbbf24';
                    ctx.lineWidth = 1.4;
                    ctx.stroke();
                }

                ctx.beginPath();
                ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
                ctx.fillStyle = isVip ? '#fbbf24' : '#10b981';
                ctx.fill();
                ctx.lineWidth = isSelected || isHovered ? 2.5 : 1.1;
                ctx.strokeStyle = isSelected || isHovered ? '#ffffff' : '#059669';
                ctx.stroke();

                const showLabel = isHovered || isSelected || isVip || node.altRole || isBridge || this.camera.zoom > 1.05;
                if (showLabel) {
                    ctx.font = '10px "JetBrains Mono", monospace';
                    ctx.fillStyle = isVip
                        ? '#fbbf24'
                        : (node.altRole ? (node.altRole === 'CRITICO' ? '#ff003c' : '#fcee0a') : (isBridge ? '#fbbf24' : '#e2e8f0'));
                    ctx.textAlign = 'center';
                    ctx.fillText(node.label.slice(0, 18), node.x, node.y - node.radius - 5);
                }
            }

            ctx.restore();
        }

        ctx.restore();
    },

    renderAltsRadarList() {
        const container = document.getElementById('alts-radar-content');
        if (!container) return;

        if (this.suspectPairs.length === 0) {
            container.innerHTML = `
                <div style="padding: 1rem 0.4rem; color: var(--text-muted); line-height: 1.5;">
                    <div style="color: var(--accent-green); font-weight: 700; margin-bottom: 0.4rem;">[ TOPOLOGÍA LIMPIA ]</div>
                    Aún no se detectan pares de usuarios con índice de Jaccard &ge; 68% y muestras horarias sincronizadas.
                </div>
            `;
            return;
        }

        container.innerHTML = this.suspectPairs.map((pair, idx) => {
            const isCrit = pair.nivelAlerta === 'CRÍTICO';
            const badgeColor = isCrit ? '#ff003c' : '#fcee0a';
            const uSafe = DOMPurify.sanitize(pair.uTag);
            const vSafe = DOMPurify.sanitize(pair.vTag);

            return `
                <div class="alt-pair-card" data-u="${DOMPurify.sanitize(String(pair.uId))}" data-v="${DOMPurify.sanitize(String(pair.vId))}" style="border: 1px solid ${badgeColor}; border-left: 4px solid ${badgeColor}; background: rgba(255, 255, 255, 0.02); padding: 0.65rem 0.75rem; margin-bottom: 0.65rem; border-radius: 4px; cursor: pointer;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                        <span style="color: ${badgeColor}; font-weight: 700; font-size: 0.72rem;">#${idx + 1} [${pair.nivelAlerta}]</span>
                        <span style="color: var(--text-main); font-weight: 700; font-size: 0.74rem;">JACCARD: ${(pair.jaccard * 100).toFixed(1)}%</span>
                    </div>
                    <div style="color: #ffffff; font-weight: 600; margin-bottom: 4px;">
                        ${uSafe} &harr; ${vSafe}
                    </div>
                    <div style="color: var(--text-secondary); font-size: 0.71rem; line-height: 1.4;">
                        &#9679; Vecinos Chat Comunes: <strong>${pair.sharedChatCount}</strong> | Servers: <strong>${pair.sharedServerCount}</strong><br>
                        &#9679; Sueño Sincronizado: <strong>${pair.sharedSleepHours}h</strong> | Relevos &lt;10m: <strong>${pair.fastHandoffs}</strong>
                    </div>
                </div>
            `;
        }).join('');

        container.querySelectorAll('.alt-pair-card').forEach(card => {
            card.addEventListener('click', () => {
                const uId = card.getAttribute('data-u');
                const vId = card.getAttribute('data-v');
                this.focusOnNodePair(`USR_${uId}`, `USR_${vId}`);
            });
        });
    },

    renderDvrCameraList() {
        const container = document.getElementById('dvr-camera-content');
        if (!container) return;

        if (this.dvrEvents.length === 0) {
            container.innerHTML = `
                <div style="padding: 1rem 0.4rem; color: var(--text-muted); line-height: 1.55;">
                    <div style="color: var(--accent-info); font-weight: 700; margin-bottom: 0.4rem;">[ CÁMARA DVR EN GRABACIÓN ]</div>
                    Aquí quedan grabados automáticamente los desplazamientos de usuarios cuando saltan de un servidor A a un servidor B, los movimientos de objetivos VIP y los ataques que reducen un servidor a cenizas.
                </div>
            `;
            return;
        }

        const headerPlayHtml = `
            <div style="margin-bottom: 0.75rem; display: flex; justify-content: space-between; align-items: center;">
                <span style="color: var(--accent-amber); font-weight: 700; font-size: 0.72rem;">ÚLTIMOS ${this.dvrEvents.length} EVENTOS GRABADOS</span>
                <button id="btn-play-all-dvr" class="btn-action" type="button" style="font-size: 0.68rem; padding: 3px 8px;">&#9654; REPRODUCIR SECUENCIA</button>
            </div>
        `;

        const itemsHtml = this.dvrEvents.slice(0, 60).map((ev) => {
            const fecha = new Date(ev.ts || Date.now()).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            let borderCol = '#38bdf8';
            if (ev.tipo === 'RAID_CENIZA') borderCol = '#ef4444';
            else if (ev.tipo === 'COMANDO_SQUAD') borderCol = '#f97316';
            else if (ev.tipo === 'MOVIMIENTO_VIP') borderCol = '#fbbf24';

            return `
                <div class="dvr-event-card" data-from="SRV_${DOMPurify.sanitize(String(ev.fromGuildId || ''))}" data-to="SRV_${DOMPurify.sanitize(String(ev.toGuildId || ''))}" data-label="${DOMPurify.sanitize(String(ev.userTag || 'EVENTO'))}" data-color="${borderCol}" style="border-left: 3px solid ${borderCol}; background: rgba(255,255,255,0.025); padding: 0.55rem 0.7rem; margin-bottom: 0.5rem; border-radius: 3px; cursor: pointer;">
                    <div style="display:flex;justify-content:space-between;font-size:0.68rem;color:var(--text-muted);margin-bottom:2px;">
                        <span style="color:${borderCol};font-weight:700;">[${DOMPurify.sanitize(String(ev.tipo || 'EVENTO'))}]</span>
                        <span>${fecha}</span>
                    </div>
                    <div style="color:var(--text-main);font-size:0.73rem;line-height:1.35;">
                        ${DOMPurify.sanitize(String(ev.detalle || ''))}
                    </div>
                </div>
            `;
        }).join('');

        container.innerHTML = headerPlayHtml + itemsHtml;

        container.querySelectorAll('.dvr-event-card').forEach(card => {
            card.addEventListener('click', () => {
                const fromKey = card.getAttribute('data-from');
                const toKey = card.getAttribute('data-to');
                const label = card.getAttribute('data-label');
                const color = card.getAttribute('data-color');

                if (fromKey && toKey && fromKey !== toKey && this.nodes.has(fromKey) && this.nodes.has(toKey)) {
                    this.focusOnNodePair(fromKey, toKey);
                    this.spawnDvrTrace(fromKey, toKey, label, color);
                } else if (this.nodes.has(toKey)) {
                    this.focusSingleNode(this.nodes.get(toKey));
                }
            });
        });

        const btnPlayAll = document.getElementById('btn-play-all-dvr');
        if (btnPlayAll) {
            btnPlayAll.addEventListener('click', () => {
                const chronological = this.dvrEvents.slice(0, 15).reverse();
                let idx = 0;
                if (this.dvrPlayTimer) clearInterval(this.dvrPlayTimer);
                this.dvrPlayTimer = setInterval(() => {
                    if (idx >= chronological.length) {
                        clearInterval(this.dvrPlayTimer);
                        return;
                    }
                    const ev = chronological[idx++];
                    const fKey = `SRV_${ev.fromGuildId}`;
                    const tKey = `SRV_${ev.toGuildId}`;
                    if (this.nodes.has(fKey) && this.nodes.has(tKey)) {
                        this.spawnDvrTrace(fKey, tKey, ev.userTag || ev.tipo, '#fcee0a');
                    }
                }, 650);
            });
        }
    },

    renderInspector(node) {
        const panel = document.getElementById('node-inspector-content');
        if (!panel || !node) return;

        if (node.type === 'SERVER') {
            const srv = node.meta || {};
            const exploradores = Array.isArray(srv.exploradores) && srv.exploradores.length > 0
                ? srv.exploradores.join(', ')
                : 'Registro Histórico';
            const numExploradores = srv.redundancia || (Array.isArray(srv.exploradores) ? srv.exploradores.length : 0);
            const redundanciaBadge = numExploradores >= 2
                ? `<span style="color:#34d399;font-weight:700;">ÓPTIMA (${numExploradores} unidades)</span>`
                : `<span style="color:#fbbf24;font-weight:700;">FRÁGIL (${numExploradores} unidad)</span>`;

            // Bloque especial si el Servidor está en Estado Ceniza (Raideado)
            let cenizaDossierHtml = '';
            if (srv.estadoCeniza && srv.estadoCeniza.raideado) {
                const c = srv.estadoCeniza;
                const linkRaidHtml = c.linkRaid
                    ? `<div><strong>Link Espameado en Raid:</strong> <a href="${DOMPurify.sanitize(c.linkRaid)}" target="_blank" rel="noopener noreferrer" style="color:#fcee0a;">${DOMPurify.sanitize(c.linkRaid)}</a></div>`
                    : '';
                cenizaDossierHtml = `
                    <div style="margin-bottom: 0.85rem; padding: 0.65rem 0.75rem; background: rgba(148, 163, 184, 0.12); border: 1px solid #94a3b8; border-left: 4px solid #ef4444; border-radius: 4px;">
                        <div style="color: #f87171; font-weight: 700; font-size: 0.74rem; margin-bottom: 4px;">[ REPORTE FORENSE DE CENIZAS // SERVIDOR RAIDEADO ]</div>
                        <div style="font-size: 0.72rem; line-height: 1.45; color: var(--text-main);">
                            <div><strong>Nombre Previo al Raid:</strong> <span style="color:#fbbf24;">${DOMPurify.sanitize(c.nombreAnterior || node.label)}</span></div>
                            <div><strong>Causa Detectada:</strong> ${DOMPurify.sanitize(c.motivo || 'Ataque masivo')}</div>
                            <div><strong>Ejecutor Detectado:</strong> ${DOMPurify.sanitize(c.atacanteTag || 'Desconocido')}</div>
                            ${linkRaidHtml}
                        </div>
                    </div>
                `;
            }

            // Editor de Etiqueta Manual de 1-2 palabras
            const currentTagText = srv.etiquetaManual?.texto || '';
            const currentTagType = srv.etiquetaManual?.tipo || 'HOSTIL';

            const tagEditorHtml = `
                <div style="margin-bottom: 0.85rem; padding: 0.6rem 0.7rem; background: rgba(255,255,255,0.03); border: var(--border-subtle); border-radius: 4px;">
                    <div style="color: var(--accent-amber); font-weight: 700; font-size: 0.7rem; margin-bottom: 5px;">ETIQUETA TÁCTICA EN MAPA (1-2 PALABRAS):</div>
                    <div style="display: flex; gap: 4px; margin-bottom: 5px;">
                        <input type="text" id="input-srv-tag" class="search-input" value="${DOMPurify.sanitize(currentTagText)}" placeholder="Ej: PROVEEDOR / RAIDERS / SOCIAL" maxlength="20" style="width: 100%; padding: 4px 7px; font-size: 0.73rem;">
                        <select id="select-srv-tag-type" style="background: var(--bg-input); color: var(--text-main); border: 1px solid rgba(255,255,255,0.14); border-radius: 4px; font-family: var(--font-mono); font-size: 0.7rem; padding: 2px 4px;">
                            <option value="HOSTIL" ${currentTagType === 'HOSTIL' ? 'selected' : ''}>ROJO</option>
                            <option value="PROVEEDOR" ${currentTagType === 'PROVEEDOR' ? 'selected' : ''}>NARANJA</option>
                            <option value="SOCIAL" ${currentTagType === 'SOCIAL' ? 'selected' : ''}>AZUL</option>
                            <option value="ALIADO" ${currentTagType === 'ALIADO' ? 'selected' : ''}>PÚRPURA</option>
                            <option value="OBJETIVO" ${currentTagType === 'OBJETIVO' ? 'selected' : ''}>AMARILLO</option>
                        </select>
                    </div>
                    <div style="display: flex; gap: 4px;">
                        <button id="btn-save-srv-tag" class="btn-action" type="button" style="flex: 1; padding: 4px; font-size: 0.7rem;">FIJAR EN MAPA</button>
                        <button id="btn-clear-srv-tag" class="btn-action btn-purge" type="button" style="padding: 4px 8px; font-size: 0.7rem;">BORRAR</button>
                    </div>
                </div>
            `;

            let inviteBlockHtml = '';
            if (srv.inviteUrl) {
                const safeUrl = DOMPurify.sanitize(String(srv.inviteUrl));
                inviteBlockHtml = `
                    <div style="margin-bottom: 0.85rem; padding: 0.55rem 0.7rem; background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.45); border-radius: 4px;">
                        <div style="color: var(--accent-green); font-weight: 700; font-size: 0.69rem; margin-bottom: 2px;">[ INVITACIÓN CAZADA DE ESTE SERVIDOR ]</div>
                        <a href="${safeUrl}" target="_blank" rel="noopener noreferrer" style="color: #ffffff; font-weight: 700; font-size: 0.8rem; text-decoration: underline;">${safeUrl}</a>
                    </div>
                `;
            }

            const members = (this.serverMembers.get(node.key) || [])
                .slice()
                .sort((a, b) => (b.infracciones - a.infracciones) || ((b.meta?.totalMensajes || 0) - (a.meta?.totalMensajes || 0)));

            const membersHtml = members.slice(0, 60).map(m => {
                const badgeCol = m.enWatchlist ? '#fbbf24' : (m.altRole ? '#fcee0a' : (m.infracciones > 0 ? '#ef4444' : '#10b981'));
                return `
                    <div class="srv-member-row" data-ukey="${DOMPurify.sanitize(m.key)}" style="display:flex;justify-content:space-between;align-items:center;padding:5px 6px;border-bottom:var(--border-subtle);cursor:pointer;">
                        <span style="color:var(--text-main);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:190px;">${m.enWatchlist ? '&#9733; ' : '&#9679; '}${DOMPurify.sanitize(m.label)}</span>
                        <span style="color:${badgeCol};font-size:0.7rem;font-weight:700;">${m.infracciones > 0 ? `NIVEL ${m.infracciones}` : `${m.meta?.totalMensajes || 1} MSGS`}</span>
                    </div>
                `;
            }).join('');

            panel.innerHTML = `
                <div style="border-left: 3px solid #ef4444; padding-left: 0.75rem; margin-bottom: 0.8rem;">
                    <div style="color: #ef4444; font-weight: 700;">[ ESTACIÓN HEXAGONAL // SERVIDOR ]</div>
                    <div style="font-size: 0.98rem; color: var(--text-main); font-weight: 700; margin-top: 3px;">${DOMPurify.sanitize(node.label)}</div>
                    <div class="selectable" style="color: var(--text-muted); font-size: 0.71rem;">ID: ${DOMPurify.sanitize(String(node.rawId))}</div>
                </div>
                ${cenizaDossierHtml}
                ${tagEditorHtml}
                ${inviteBlockHtml}
                <div style="margin-bottom: 0.35rem;"><strong>Sujetos Monitoreados Aquí:</strong> <span style="color: var(--accent-green);">${members.length}</span></div>
                <div style="margin-bottom: 0.35rem;"><strong>Miembros Totales Discord:</strong> ${srv.memberCount || 'N/A'}</div>
                <div style="margin-bottom: 0.35rem;"><strong>Cobertura de Redundancia:</strong> ${redundanciaBadge}</div>
                <div style="margin-bottom: 0.75rem; font-size: 0.72rem; color: var(--text-secondary);"><strong>Exploradores:</strong> ${DOMPurify.sanitize(exploradores)}</div>
                <div style="color: var(--accent-rz); font-weight: 700; margin-bottom: 0.35rem;">SUJETOS ACTIVOS EN ESTE SERVIDOR (${members.length}):</div>
                <div style="max-height: 210px; overflow-y: auto; border: var(--border-subtle); border-radius: 4px; background: rgba(0,0,0,0.2);">
                    ${membersHtml || '<div style="padding:0.75rem;color:var(--text-muted);">Sin usuarios registrados aún.</div>'}
                </div>
            `;

            const btnSaveTag = document.getElementById('btn-save-srv-tag');
            const btnClearTag = document.getElementById('btn-clear-srv-tag');
            const inputTag = document.getElementById('input-srv-tag');
            const selectType = document.getElementById('select-srv-tag-type');

            if (btnSaveTag && inputTag && selectType) {
                btnSaveTag.addEventListener('click', async () => {
                    const texto = inputTag.value.trim();
                    const tipo = selectType.value;
                    btnSaveTag.textContent = 'GUARDANDO...';
                    try {
                        const res = await window.C4ISR_API.guardarEtiquetaServidor(String(node.rawId), texto, tipo);
                        node.meta.etiquetaManual = res.etiqueta;
                        btnSaveTag.textContent = '¡FIJADO!';
                        setTimeout(() => { if (btnSaveTag) btnSaveTag.textContent = 'FIJAR EN MAPA'; }, 900);
                    } catch (_) {
                        btnSaveTag.textContent = 'ERROR';
                    }
                });
            }

            if (btnClearTag && inputTag) {
                btnClearTag.addEventListener('click', async () => {
                    inputTag.value = '';
                    try {
                        await window.C4ISR_API.guardarEtiquetaServidor(String(node.rawId), '', 'CUSTOM');
                        node.meta.etiquetaManual = null;
                    } catch (_) {}
                });
            }

            panel.querySelectorAll('.srv-member-row').forEach(row => {
                row.addEventListener('click', () => {
                    const uKey = row.getAttribute('data-ukey');
                    const targetUser = this.nodes.get(uKey);
                    if (targetUser) this.focusSingleNode(targetUser);
                });
            });
        } else {
            const usr = node.meta || {};
            const servidoresList = Object.entries(usr.servidores || {}).map(([sId, info]) => {
                return `
                    <div class="usr-srv-row" data-skey="SRV_${DOMPurify.sanitize(sId)}" style="padding: 5px 4px; border-bottom: var(--border-subtle); cursor: pointer; display: flex; justify-content: space-between;">
                        <span><strong style="color:#ef4444;">&#11042;</strong> <strong>${DOMPurify.sanitize(info.name)}</strong></span>
                        <span style="color:var(--text-muted);">${info.count} msgs</span>
                    </div>
                `;
            }).join('');

            const activeHoursSet = new Set(Array.isArray(usr.horasActivas) ? usr.horasActivas : []);
            let clockCells = '';
            for (let h = 0; h < 24; h++) {
                const isActiveHour = activeHoursSet.has(h);
                const cellBg = isActiveHour ? 'var(--accent-green)' : 'rgba(255,255,255,0.06)';
                clockCells += `<div title="${String(h).padStart(2, '0')}:00 UTC - ${isActiveHour ? 'ACTIVO' : 'INACTIVO'}" style="height:12px;background:${cellBg};border-radius:2px;"></div>`;
            }

            const aliasesPrevios = Array.isArray(usr.historialAliases) && usr.historialAliases.length > 0
                ? usr.historialAliases.map(a => DOMPurify.sanitize(a)).join(', ')
                : DOMPurify.sanitize(node.label);

            const snowflakeInfo = usr.fechaCreacionCuenta
                ? `${DOMPurify.sanitize(usr.fechaCreacionCuenta)} (${usr.diasAntiguedad}d) ${usr.esBurner ? '<strong style="color:#ef4444;">[BURNER]</strong>' : ''}`
                : 'Calculando en próximo evento...';

            const altsDeUsuario = this.altMapByUser.get(String(node.rawId)) || [];
            let altsHtml = `<div style="color: var(--text-muted); font-size: 0.72rem; margin-bottom: 0.75rem;">Sin coincidencias espejo por encima del umbral.</div>`;

            if (altsDeUsuario.length > 0) {
                altsHtml = altsDeUsuario.map(alt => {
                    const col = alt.nivelAlerta === 'CRÍTICO' ? '#ff003c' : '#fcee0a';
                    return `
                        <div class="btn-focus-alt" data-mirror="${DOMPurify.sanitize(String(alt.mirrorId))}" style="border-left: 3px solid ${col}; background: rgba(255,255,255,0.03); padding: 6px 8px; margin-bottom: 6px; cursor: pointer;">
                            <div style="color: ${col}; font-weight: 700; font-size: 0.72rem;">[${alt.nivelAlerta}] ${DOMPurify.sanitize(alt.mirrorTag)}</div>
                            <div style="font-size: 0.71rem; color: var(--text-secondary);">
                                Jaccard: <strong>${(alt.jaccard * 100).toFixed(1)}%</strong> | Sueño común: <strong>${alt.sharedSleepHours}h</strong> | Relevos &lt;10m: <strong>${alt.fastHandoffs}</strong>
                            </div>
                        </div>
                    `;
                }).join('');
            }

            panel.innerHTML = `
                <div style="border-left: 3px solid ${node.enWatchlist ? '#fbbf24' : '#10b981'}; padding-left: 0.75rem; margin-bottom: 0.75rem;">
                    <div style="color: ${node.enWatchlist ? '#fbbf24' : '#10b981'}; font-weight: 700;">${node.enWatchlist ? '&#9733; [ OBJETIVO VIP EN SEGUIMIENTO ]' : '[ NODO USUARIO // VERDE ]'}</div>
                    <div style="font-size: 0.98rem; color: var(--text-main); font-weight: 700; margin-top: 3px;">${DOMPurify.sanitize(node.label)}</div>
                    <div class="selectable" style="color: var(--text-muted); font-size: 0.71rem;">UID: ${DOMPurify.sanitize(String(node.rawId))}</div>
                </div>

                <button id="btn-toggle-vip" class="btn-action" type="button" style="width: 100%; margin-bottom: 0.75rem; padding: 0.45rem; border-color: #fbbf24; color: ${node.enWatchlist ? '#09080c' : '#fbbf24'}; background: ${node.enWatchlist ? '#fbbf24' : 'rgba(251, 191, 36, 0.08)'}; font-weight: 700;">
                    &#9733; ${node.enWatchlist ? 'DESACTIVAR SEGUIMIENTO VIP' : 'ACTIVAR SEGUIMIENTO VIP (WATCHLIST)'}
                </button>

                <div style="margin-bottom: 0.35rem;"><strong>Creación Cuenta:</strong> <span style="color: var(--text-secondary);">${snowflakeInfo}</span></div>
                <div style="margin-bottom: 0.35rem;"><strong>Historial Alias:</strong> <span style="color: var(--text-secondary);">${aliasesPrevios}</span></div>
                <div style="margin-bottom: 0.35rem;"><strong>Actividad Total:</strong> <span style="color: var(--accent-green);">${usr.totalMensajes || 0} mensajes</span></div>
                <div style="margin-bottom: 0.35rem;"><strong>Servidores Comunes:</strong> <span style="color: ${node.serverCount > 1 ? '#fbbf24' : 'var(--text-main)'};">${node.serverCount} servidor(es)</span></div>
                <div style="margin-bottom: 0.7rem;"><strong>Infracciones Graves:</strong> <span style="color: ${node.infracciones > 0 ? '#ef4444' : 'var(--text-muted)'};">${node.infracciones}</span></div>

                <div style="color: var(--accent-info); font-weight: 700; font-size: 0.71rem; margin-bottom: 0.3rem;">HUELLA HORARIA 24H (UTC):</div>
                <div style="display:grid;grid-template-columns:repeat(24,1fr);gap:2px;margin-bottom:0.8rem;">${clockCells}</div>

                <div style="color: #fcee0a; font-weight: 700; margin-bottom: 0.3rem;">SOSPECHAS DE CUENTA ESPEJO (ALTS):</div>
                <div style="margin-bottom: 0.8rem;">${altsHtml}</div>

                <div style="color: var(--accent-rz); font-weight: 700; margin-bottom: 0.3rem;">SERVIDORES DETECTADOS:</div>
                <div style="margin-bottom: 0.9rem;">${servidoresList || 'Sin servidores'}</div>
                <button id="btn-open-dossier" class="btn-cyber" type="button" style="padding: 0.55rem; font-size: 0.76rem;">ABRIR EXPEDIENTE OSINT</button>
            `;

            const btnVip = document.getElementById('btn-toggle-vip');
            if (btnVip) {
                btnVip.addEventListener('click', async () => {
                    try {
                        const res = await window.C4ISR_API.toggleWatchlistUsuario(String(node.rawId));
                        node.enWatchlist = Boolean(res.enWatchlist);
                        if (node.enWatchlist) this.watchlistSet.add(String(node.rawId));
                        else this.watchlistSet.delete(String(node.rawId));
                        this.renderInspector(node);
                    } catch (_) {}
                });
            }

            panel.querySelectorAll('.usr-srv-row').forEach(row => {
                row.addEventListener('click', () => {
                    const sKey = row.getAttribute('data-skey');
                    const targetSrv = this.nodes.get(sKey);
                    if (targetSrv) this.focusSingleNode(targetSrv);
                });
            });

            panel.querySelectorAll('.btn-focus-alt').forEach(el => {
                el.addEventListener('click', () => {
                    const mirrorId = el.getAttribute('data-mirror');
                    if (mirrorId) {
                        this.focusOnNodePair(node.key, `USR_${mirrorId}`);
                    }
                });
            });

            const btnDossier = document.getElementById('btn-open-dossier');
            if (btnDossier) {
                btnDossier.addEventListener('click', async () => {
                    if (!node.fichado) {
                        try {
                            await window.C4ISR_API.agregarObjetivoManual(String(node.rawId));
                        } catch (_) {}
                    }
                    window.C4ISR_TARGET_OVERRIDE = String(node.rawId);
                    window.AppController.navigate('expedientes');
                });
            }
        }
    },

    startAnimationLoop() {
        const loop = () => {
            this.stepPhysics();
            this.drawFrame();
            this.animationFrameId = requestAnimationFrame(loop);
        };
        this.animationFrameId = requestAnimationFrame(loop);
    },

    destroy() {
        if (this.animationFrameId) cancelAnimationFrame(this.animationFrameId);
        if (this.pollIntervalId) clearInterval(this.pollIntervalId);
        if (this.dvrPlayTimer) clearInterval(this.dvrPlayTimer);
        if (this.boundResize) window.removeEventListener('resize', this.boundResize);
        if (this.boundMouseUp) window.removeEventListener('mouseup', this.boundMouseUp);
        this.nodes.clear();
        this.edges = [];
        this.altEdges = [];
        this.allianceEdges = [];
        this.adjacency.clear();
        this.serverMembers.clear();
        this.suspectPairs = [];
        this.altMapByUser.clear();
        this.dvrEvents = [];
        this.particles = [];
        this.dvrTraces = [];
        this.seenPulses.clear();
    }
};
