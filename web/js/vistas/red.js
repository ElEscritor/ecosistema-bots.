'use strict';

/* ==========================================================================
   VISTA: MAPA DE RED C4ISR v2.5 (FÍSICAS ADAPTATIVAS // ALIANZAS // ALTS)
   Archivo: js/vistas/red.js
   ========================================================================== */

window.C4ISR_Views = window.C4ISR_Views || {};

window.C4ISR_Views.red = {
    canvas: null,
    ctx: null,
    animationFrameId: null,
    pollIntervalId: null,

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
    particles: [],
    seenPulses: new Set(),

    camera: { x: 0, y: 0, zoom: 0.78 },
    isDraggingCanvas: false,
    draggedNode: null,
    hoveredNode: null,
    selectedNode: null,
    highlightedPair: null,
    lastMousePos: { x: 0, y: 0 },

    rightPanelTab: 'inspector',
    physicsEnabled: true,
    showUserLinks: true,
    showAltLinks: true,
    showAllianceLinks: true,
    onlyBridges: false,
    hideEmptyServers: false,
    searchTerm: '',

    async render(container) {
        container.innerHTML = `
            <div class="panel-header" style="margin-bottom: 0.65rem; padding-bottom: 0.55rem;">
                <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
                    <span class="panel-title" style="font-size: 1.05rem; color: var(--accent-rz);">TOPOLOGÍA EN TIEMPO REAL // SERVIDORES, ALIANZAS Y ALTS</span>
                    <span id="red-stats-badge" class="badge badge-green">SINCRONIZANDO...</span>
                    <span id="red-alts-badge" class="badge badge-amber">0 ALTS DETECTADAS</span>
                </div>
                <div style="display: flex; gap: 0.4rem; flex-wrap: wrap;">
                    <button id="btn-toggle-empty-srv" class="btn-action" type="button">OCULTAR SERVERS VACÍOS: OFF</button>
                    <button id="btn-toggle-bridges" class="btn-action" type="button">SOLO PUENTES: OFF</button>
                    <button id="btn-toggle-alliances" class="btn-action" type="button">ALIANZAS: ON</button>
                    <button id="btn-toggle-chatlinks" class="btn-action" type="button">DIÁLOGO (&lt;30s): ON</button>
                    <button id="btn-toggle-altlinks" class="btn-action" type="button">ENLACES ALTS: ON</button>
                    <button id="btn-toggle-physics" class="btn-action" type="button">FÍSICAS: ON</button>
                    <button id="btn-center-graph" class="btn-action" type="button">CENTRAR</button>
                </div>
            </div>

            <div class="toolbar-tactical" style="margin-bottom: 0.65rem; padding: 0.55rem 0.9rem;">
                <div style="display: flex; align-items: center; gap: 0.5rem; flex: 1; min-width: 260px;">
                    <input type="text" id="red-search" class="search-input" style="width: 100%; max-width: 420px;" placeholder="Buscar servidor, usuario o invitación (Enter para enfocar)..." autocomplete="off">
                </div>
                <div style="display: flex; gap: 0.9rem; align-items: center; font-family: var(--font-mono); font-size: 0.71rem; color: var(--text-secondary); flex-wrap: wrap;">
                    <span><strong style="color: #ef4444;">&#9679; ROJO:</strong> SERVIDORES</span>
                    <span><strong style="color: #10b981;">&#9679; VERDE:</strong> USUARIOS</span>
                    <span><strong style="color: #c084fc;">&rarr; PÚRPURA:</strong> VECTOR ALIANZA</span>
                    <span><strong style="color: #fbbf24;">&#9678; ÁMBAR:</strong> MULTI-SERVER</span>
                    <span><strong style="color: #fcee0a;">&#10697; MIRA NEÓN:</strong> SOSPECHA ALT</span>
                </div>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 360px; gap: 0.85rem; height: calc(100vh - 210px); min-height: 440px;">
                <div id="canvas-wrapper" style="position: relative; background: radial-gradient(circle at 50% 50%, #120e1c 0%, #07060a 100%); border: var(--border-thin); border-radius: var(--radius-md); overflow: hidden;">
                    <canvas id="net-canvas" style="width: 100%; height: 100%; display: block; cursor: grab;"></canvas>

                    <div id="hud-coords" style="position: absolute; top: 10px; left: 12px; font-family: var(--font-mono); font-size: 0.68rem; color: rgba(255, 42, 109, 0.75); background: rgba(9, 8, 12, 0.75); padding: 4px 8px; border-left: 2px solid var(--accent-rz); pointer-events: none;">
                        C4ISR // GRID-LOCK // ZOOM: 78%
                    </div>

                    <div id="canvas-hover-tooltip" class="hidden" style="position: absolute; pointer-events: none; z-index: 30; background: rgba(11, 9, 16, 0.95); border: 1px solid var(--accent-rz); border-left: 3px solid var(--accent-rz); padding: 6px 10px; border-radius: 4px; font-family: var(--font-mono); font-size: 0.72rem; color: var(--text-main); box-shadow: 0 8px 20px rgba(0,0,0,0.85); max-width: 290px;"></div>

                    <div id="live-feed-ticker" style="position: absolute; bottom: 12px; left: 12px; right: 12px; max-width: fit-content; font-family: var(--font-mono); font-size: 0.72rem; color: var(--accent-green); background: rgba(9, 8, 12, 0.92); padding: 5px 12px; border: 1px solid rgba(16, 185, 129, 0.4); border-left: 3px solid var(--accent-green); border-radius: 4px; pointer-events: none; box-shadow: 0 4px 12px rgba(0,0,0,0.6);">
                        [RADAR ACTIVO] Escaneando tráfico de la matriz...
                    </div>
                </div>

                <div class="osint-panel" style="height: 100%;">
                    <div class="panel-header" style="margin: 0; padding: 0.6rem 0.85rem; display: flex; gap: 0.4rem;">
                        <button id="tab-btn-inspector" class="btn-action" type="button" style="flex: 1; background: var(--accent-rz); color: #fff;">INSPECTOR NODO</button>
                        <button id="tab-btn-alts" class="btn-action" type="button" style="flex: 1;">RADAR ALTS (0)</button>
                    </div>
                    <div id="node-inspector-content" class="osint-content" style="font-family: var(--font-mono); font-size: 0.78rem;">
                        <div style="color: var(--text-muted); padding-top: 0.75rem; line-height: 1.5;">
                            Haz clic sobre cualquier <strong style="color: #ef4444;">Servidor (Rojo)</strong> para ver su enlace de invitación cazado, sus alianzas y miembros, o sobre un <strong style="color: #10b981;">Usuario (Verde)</strong> para auditar su huella horaria y cuentas espejo.
                        </div>
                    </div>
                    <div id="alts-radar-content" class="osint-content hidden" style="font-family: var(--font-mono); font-size: 0.78rem;"></div>
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
        this.camera.zoom = 0.78;
        this.updateHudCoords();
    },

    updateHudCoords() {
        const hud = document.getElementById('hud-coords');
        if (hud) {
            hud.textContent = `C4ISR // GRID-LOCK // ZOOM: ${Math.round(this.camera.zoom * 100)}% // NODOS VISIBLES: ${this.countVisibleNodes()}`;
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
        const btnInsp = document.getElementById('tab-btn-inspector');
        const btnAlts = document.getElementById('tab-btn-alts');

        if (!inspectorEl || !altsEl || !btnInsp || !btnAlts) return;

        if (tabName === 'alts') {
            inspectorEl.classList.add('hidden');
            altsEl.classList.remove('hidden');
            btnAlts.style.background = 'var(--accent-rz)';
            btnAlts.style.color = '#ffffff';
            btnInsp.style.background = 'rgba(255, 42, 109, 0.08)';
            btnInsp.style.color = 'var(--text-main)';
            this.renderAltsRadarList();
        } else {
            altsEl.classList.add('hidden');
            inspectorEl.classList.remove('hidden');
            btnInsp.style.background = 'var(--accent-rz)';
            btnInsp.style.color = '#ffffff';
            btnAlts.style.background = 'rgba(255, 42, 109, 0.08)';
            btnAlts.style.color = 'var(--text-main)';
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

        const btnEmptySrv = document.getElementById('btn-toggle-empty-srv');
        const btnAlliances = document.getElementById('btn-toggle-alliances');
        const btnPhysics = document.getElementById('btn-toggle-physics');
        const btnChatLinks = document.getElementById('btn-toggle-chatlinks');
        const btnAltLinks = document.getElementById('btn-toggle-altlinks');
        const btnBridges = document.getElementById('btn-toggle-bridges');
        const btnCenter = document.getElementById('btn-center-graph');
        const searchInput = document.getElementById('red-search');
        const tabInspector = document.getElementById('tab-btn-inspector');
        const tabAlts = document.getElementById('tab-btn-alts');

        if (tabInspector) tabInspector.addEventListener('click', () => this.switchRightTab('inspector'));
        if (tabAlts) tabAlts.addEventListener('click', () => this.switchRightTab('alts'));

        if (btnEmptySrv) {
            btnEmptySrv.addEventListener('click', () => {
                this.hideEmptyServers = !this.hideEmptyServers;
                btnEmptySrv.textContent = `OCULTAR SERVERS VACÍOS: ${this.hideEmptyServers ? 'ON' : 'OFF'}`;
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
                btnChatLinks.textContent = `DIÁLOGO (<30s): ${this.showUserLinks ? 'ON' : 'OFF'}`;
            });
        }

        if (btnAltLinks) {
            btnAltLinks.addEventListener('click', () => {
                this.showAltLinks = !this.showAltLinks;
                btnAltLinks.textContent = `ENLACES ALTS: ${this.showAltLinks ? 'ON' : 'OFF'}`;
            });
        }

        if (btnBridges) {
            btnBridges.addEventListener('click', () => {
                this.onlyBridges = !this.onlyBridges;
                btnBridges.textContent = `SOLO PUENTES: ${this.onlyBridges ? 'ON' : 'OFF'}`;
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
            const inviteTag = node.meta?.inviteUrl
                ? `<div style="color:#34d399;margin-top:2px;">&#128279; ${DOMPurify.sanitize(node.meta.inviteUrl)}</div>`
                : '';
            tooltip.style.borderColor = '#ef4444';
            tooltip.innerHTML = `
                <div style="color:#ef4444;font-weight:700;">[SERVIDOR] ${DOMPurify.sanitize(node.label)}</div>
                <div style="color:var(--text-secondary);">Usuarios Monitoreados: <b>${membersCount}</b> | Msgs: <b>${node.meta?.mensajesSesion || 0}</b></div>
                ${inviteTag}
            `;
        } else {
            const statusColor = node.altRole ? '#fcee0a' : (node.fichado ? '#ff2a6d' : '#10b981');
            tooltip.style.borderColor = statusColor;
            tooltip.innerHTML = `
                <div style="color:${statusColor};font-weight:700;">[USUARIO] ${DOMPurify.sanitize(node.label)}</div>
                <div style="color:var(--text-secondary);">UID: ${DOMPurify.sanitize(String(node.rawId))}</div>
                <div style="color:var(--text-main);">Servers: <b>${node.serverCount}</b> | Msgs: <b>${node.meta?.totalMensajes || 0}</b> | Infracciones: <b>${node.infracciones}</b></div>
            `;
        }

        tooltip.classList.remove('hidden');
        const left = Math.min((this.canvas?.width || 800) - 295, mx + 16);
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
            if (Math.sqrt(dx * dx + dy * dy) <= node.radius + 5) return node;
        }
        return null;
    },

    isNodeVisible(node) {
        if (node.type === 'SERVER' && this.hideEmptyServers) {
            const connected = (this.serverMembers.get(node.key) || []).length;
            if (connected === 0 && (!node.meta?.alianzasSalientes || node.meta.alianzasSalientes.length === 0)) {
                return false;
            }
        }
        if (this.onlyBridges && node.type === 'USER') {
            if (node.serverCount < 2 && !node.fichado && !node.altRole) return false;
        }
        if (this.searchTerm) {
            const matchSelf = node.label.toLowerCase().includes(this.searchTerm) ||
                String(node.rawId).includes(this.searchTerm) ||
                String(node.meta?.inviteUrl || '').toLowerCase().includes(this.searchTerm);
            if (matchSelf) return true;
            const neighbors = this.adjacency.get(node.key);
            if (neighbors) {
                for (const nKey of neighbors) {
                    const nb = this.nodes.get(nKey);
                    if (nb && nb.label.toLowerCase().includes(this.searchTerm)) return true;
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
            badgeAlts.textContent = `${paresDetectados.length} PAR(ES) ALT DETECTADOS`;
            badgeAlts.className = paresDetectados.some(p => p.nivelAlerta === 'CRÍTICO')
                ? 'badge badge-red'
                : (paresDetectados.length > 0 ? 'badge badge-amber' : 'badge badge-green');
        }

        const tabBtnAlts = document.getElementById('tab-btn-alts');
        if (tabBtnAlts) {
            tabBtnAlts.textContent = `RADAR ALTS (${paresDetectados.length})`;
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

            const badge = document.getElementById('red-stats-badge');
            if (badge) {
                badge.textContent = `${servidores.length} SERVIDORES (ROJOS) // ${usuarios.length} USUARIOS (VERDES)`;
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

            const activeServers = servidores.filter(s => (s.usuariosCount || 0) > 0 || (s.alianzasSalientes && s.alianzasSalientes.length > 0));
            const emptyServers = servidores.filter(s => (s.usuariosCount || 0) === 0 && (!s.alianzasSalientes || s.alianzasSalientes.length === 0));

            activeServers.forEach((srv, idx) => {
                const key = `SRV_${srv.id}`;
                this.serverMembers.set(key, []);
                let node = this.nodes.get(key);
                const radius = Math.max(20, Math.min(46, 16 + Math.sqrt(srv.usuariosCount || 1) * 2.4));
                if (!node) {
                    const angle = (idx / Math.max(1, activeServers.length)) * Math.PI * 2;
                    const dist = activeServers.length === 1 ? 0 : 280 + (idx % 2) * 140;
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
                    const ringRadius = 640 + (idx % 3) * 85;
                    node = {
                        key,
                        rawId: srv.id,
                        type: 'SERVER',
                        label: srv.name || 'Servidor',
                        x: Math.cos(angle) * ringRadius,
                        y: Math.sin(angle) * ringRadius,
                        vx: 0,
                        vy: 0,
                        radius: 15,
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

                const radius = Math.max(
                    6.5,
                    Math.min(18, 5.5 + Math.log2((usr.totalMensajes || 1) + 1) * 1.9 + (serverCount > 1 ? 3.5 : 0))
                );

                let node = this.nodes.get(key);
                if (!node) {
                    const firstSrvKey = srvKeys.length > 0 ? `SRV_${srvKeys[0]}` : null;
                    const parentSrv = firstSrvKey ? this.nodes.get(firstSrvKey) : null;
                    const idxInSrv = (serverSpawnIndex.get(firstSrvKey) || 0);
                    serverSpawnIndex.set(firstSrvKey, idxInSrv + 1);

                    const goldenAngle = idxInSrv * 2.3999632;
                    const spiralRadius = 55 + Math.sqrt(idxInSrv + 1) * 22;
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

            // 5. Vectores de Alianzas entre Servidores (Flechas Púrpura)
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
                    this.spawnParticle(`USR_${p.userId}`, `SRV_${p.guildId}`);
                    const ticker = document.getElementById('live-feed-ticker');
                    if (ticker) {
                        ticker.innerHTML = `[IMPULSO EN VIVO] <strong>${DOMPurify.sanitize(String(p.userTag))}</strong> &rarr; ${DOMPurify.sanitize(String(p.guildName))}`;
                    }
                }
            }

            if (this.selectedNode && this.nodes.has(this.selectedNode.key)) {
                this.selectedNode = this.nodes.get(this.selectedNode.key);
                if (this.rightPanelTab === 'inspector') {
                    this.renderInspector(this.selectedNode);
                }
            }
        } catch (err) {
            console.error('[Vista Red] Error sincronizando topología:', err);
        }
    },

    spawnParticle(sourceKey, targetKey) {
        if (!this.nodes.has(sourceKey) || !this.nodes.has(targetKey)) return;
        this.particles.push({
            sourceKey,
            targetKey,
            progress: 0,
            speed: 0.022 + Math.random() * 0.015
        });
    },

    focusSingleNode(node) {
        if (!node || !this.canvas) return;
        this.selectedNode = node;
        this.highlightedPair = null;
        this.camera.zoom = 1.25;
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
        this.camera.zoom = 1.15;
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
                const maxDist = bothServers ? 620 : 280;
                if (distSq > maxDist * maxDist) continue;

                const dist = Math.sqrt(distSq);
                const repulsionForce = bothServers ? 5200 : 980;
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
                targetLen = 95 + Math.min(260, Math.sqrt(srvMembers) * 16);
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
            if (n.type === 'SERVER' && n.connectedUsersCount === 0 && (!n.meta?.alianzasSalientes || n.meta.alianzasSalientes.length === 0)) {
                const distCenter = Math.sqrt(n.x * n.x + n.y * n.y) || 1;
                const targetRing = 680;
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

    drawTacticalGrid(ctx, w, h) {
        ctx.save();
        const gridStep = 80 * this.camera.zoom;
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
                const isBridge = s.serverCount >= 2;
                if (focusNode && edgeActive) {
                    ctx.strokeStyle = isBridge ? 'rgba(251, 191, 36, 0.85)' : 'rgba(16, 185, 129, 0.72)';
                    ctx.lineWidth = 2.0;
                } else {
                    const alpha = edgeActive ? (isBridge ? 0.42 : 0.22) : 0.04;
                    ctx.strokeStyle = isBridge ? `rgba(251, 191, 36, ${alpha})` : `rgba(16, 185, 129, ${alpha})`;
                    ctx.lineWidth = Math.min(3.0, 0.8 + Math.log2(edge.weight + 1) * 0.45);
                }
            } else {
                const alpha = edgeActive ? 0.38 : 0.04;
                ctx.strokeStyle = `rgba(56, 189, 248, ${alpha})`;
                ctx.lineWidth = edgeActive && focusNode ? 1.8 : 1.0;
            }
            ctx.stroke();
        }

        // 2. Dibujar Flechas Púrpura de Alianzas entre Servidores
        if (this.showAllianceLinks) {
            for (const ally of this.allianceEdges) {
                const s = this.nodes.get(ally.source);
                const tNode = this.nodes.get(ally.target);
                if (!s || !tNode || !this.isNodeVisible(s) || !this.isNodeVisible(tNode)) continue;

                const isHighlighted = !focusNode || focusNode.key === s.key || focusNode.key === tNode.key;
                const dx = tNode.x - s.x;
                const dy = tNode.y - s.y;
                const angle = Math.atan2(dy, dx);
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist <= s.radius + tNode.radius) continue;

                const endX = tNode.x - Math.cos(angle) * (tNode.radius + 6);
                const endY = tNode.y - Math.sin(angle) * (tNode.radius + 6);

                ctx.save();
                ctx.globalAlpha = isHighlighted ? 0.9 : 0.12;
                ctx.beginPath();
                ctx.moveTo(s.x, s.y);
                ctx.lineTo(endX, endY);
                ctx.strokeStyle = '#c084fc';
                ctx.lineWidth = 2.2;
                ctx.stroke();

                // Punta de flecha direccional
                ctx.beginPath();
                ctx.moveTo(endX, endY);
                ctx.lineTo(endX - 11 * Math.cos(angle - Math.PI / 6), endY - 11 * Math.sin(angle - Math.PI / 6));
                ctx.lineTo(endX - 11 * Math.cos(angle + Math.PI / 6), endY - 11 * Math.sin(angle + Math.PI / 6));
                ctx.closePath();
                ctx.fillStyle = '#c084fc';
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

        // 4. Dibujar Partículas de Actividad en Vivo
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
            ctx.arc(px, py, 3.5, 0, Math.PI * 2);
            ctx.fillStyle = '#34d399';
            ctx.shadowColor = '#10b981';
            ctx.shadowBlur = 10;
            ctx.fill();
            ctx.shadowBlur = 0;
        }

        // 5. Dibujar Nodos (Rojos = Servidores, Verdes = Usuarios)
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
                const hasInvite = Boolean(node.meta?.inviteUrl);

                if (hasUsers || isSelected || isHovered) {
                    ctx.beginPath();
                    ctx.arc(node.x, node.y, node.radius + 5 + pulse * 8, 0, Math.PI * 2);
                    ctx.strokeStyle = hasInvite
                        ? `rgba(192, 132, 252, ${0.65 - pulse * 0.4})`
                        : `rgba(239, 68, 68, ${0.55 - pulse * 0.4})`;
                    ctx.lineWidth = 2;
                    ctx.stroke();
                }

                ctx.beginPath();
                ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
                ctx.fillStyle = hasUsers ? '#ef4444' : '#7f1d1d';
                ctx.fill();
                ctx.lineWidth = isSelected || isHovered ? 3 : 1.8;
                ctx.strokeStyle = isSelected || isHovered ? '#ffffff' : (hasInvite ? '#e9d5ff' : '#fca5a5');
                ctx.stroke();

                ctx.font = 'bold 11px "JetBrains Mono", monospace';
                ctx.fillStyle = '#ffffff';
                ctx.textAlign = 'center';
                ctx.fillText(node.label.slice(0, 24), node.x, node.y + node.radius + 14);
            } else {
                const isBridge = node.serverCount >= 2;

                if (node.altRole) {
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
                ctx.fillStyle = '#10b981';
                ctx.fill();
                ctx.lineWidth = isSelected || isHovered ? 2.5 : 1.1;
                ctx.strokeStyle = isSelected || isHovered ? '#ffffff' : '#059669';
                ctx.stroke();

                const showLabel = isHovered || isSelected || node.altRole || isBridge || this.camera.zoom > 1.05;
                if (showLabel) {
                    ctx.font = '10px "JetBrains Mono", monospace';
                    ctx.fillStyle = node.altRole
                        ? (node.altRole === 'CRITICO' ? '#ff003c' : '#fcee0a')
                        : (isBridge ? '#fbbf24' : '#e2e8f0');
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

    renderInspector(node) {
        const panel = document.getElementById('node-inspector-content');
        if (!panel || !node) return;

        if (node.type === 'SERVER') {
            const srv = node.meta || {};
            const exploradores = Array.isArray(srv.exploradores) && srv.exploradores.length > 0
                ? srv.exploradores.join(', ')
                : 'Registro Pasivo';

            // Mostrar el Link Oficial del servidor si fue cazado
            let inviteBlockHtml = `
                <div style="margin-bottom: 0.75rem; padding: 0.5rem 0.65rem; background: rgba(255,255,255,0.03); border: var(--border-subtle); border-radius: 4px; color: var(--text-muted); font-size: 0.72rem;">
                    Invite del Servidor: Sin invitación capturada aún.
                </div>
            `;
            if (srv.inviteUrl) {
                const safeUrl = DOMPurify.sanitize(String(srv.inviteUrl));
                inviteBlockHtml = `
                    <div style="margin-bottom: 0.85rem; padding: 0.6rem 0.75rem; background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.45); border-radius: 4px;">
                        <div style="color: var(--accent-green); font-weight: 700; font-size: 0.7rem; margin-bottom: 3px;">[ INVITACIÓN CAZADA DE ESTE SERVIDOR ]</div>
                        <a href="${safeUrl}" target="_blank" rel="noopener noreferrer" style="color: #ffffff; font-weight: 700; font-size: 0.82rem; text-decoration: underline;">${safeUrl}</a>
                    </div>
                `;
            }

            // Mostrar Alianzas promovidas desde este servidor
            const alianzasList = Array.isArray(srv.alianzasSalientes) ? srv.alianzasSalientes : [];
            let alianzasHtml = '';
            if (alianzasList.length > 0) {
                const rows = alianzasList.slice(0, 15).map(a => {
                    const safeUrl = DOMPurify.sanitize(String(a.url));
                    const safeName = DOMPurify.sanitize(String(a.targetName || a.url));
                    return `
                        <div style="display:flex;justify-content:space-between;align-items:center;padding:4px 6px;border-bottom:var(--border-subtle);font-size:0.72rem;">
                            <span style="color:#c084fc;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:170px;">&rarr; ${safeName}</span>
                            <a href="${safeUrl}" target="_blank" rel="noopener noreferrer" style="color:var(--accent-info);text-decoration:none;">${DOMPurify.sanitize(String(a.code))}</a>
                        </div>
                    `;
                }).join('');
                alianzasHtml = `
                    <div style="color: #c084fc; font-weight: 700; margin-bottom: 0.35rem;">VECTORES DE ALIANZA EMITIDOS (${alianzasList.length}):</div>
                    <div style="max-height: 120px; overflow-y: auto; border: var(--border-subtle); border-radius: 4px; background: rgba(0,0,0,0.2); margin-bottom: 0.85rem;">
                        ${rows}
                    </div>
                `;
            }

            const members = (this.serverMembers.get(node.key) || [])
                .slice()
                .sort((a, b) => (b.infracciones - a.infracciones) || ((b.meta?.totalMensajes || 0) - (a.meta?.totalMensajes || 0)));

            const membersHtml = members.slice(0, 60).map(m => {
                const badgeCol = m.altRole ? '#fcee0a' : (m.infracciones > 0 ? '#ef4444' : '#10b981');
                return `
                    <div class="srv-member-row" data-ukey="${DOMPurify.sanitize(m.key)}" style="display:flex;justify-content:space-between;align-items:center;padding:5px 6px;border-bottom:var(--border-subtle);cursor:pointer;">
                        <span style="color:var(--text-main);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:190px;">&#9679; ${DOMPurify.sanitize(m.label)}</span>
                        <span style="color:${badgeCol};font-size:0.7rem;font-weight:700;">${m.infracciones > 0 ? `NIVEL ${m.infracciones}` : `${m.meta?.totalMensajes || 1} MSGS`}</span>
                    </div>
                `;
            }).join('');

            panel.innerHTML = `
                <div style="border-left: 3px solid #ef4444; padding-left: 0.75rem; margin-bottom: 0.85rem;">
                    <div style="color: #ef4444; font-weight: 700;">[ NODO SERVIDOR // ROJO ]</div>
                    <div style="font-size: 1rem; color: var(--text-main); font-weight: 700; margin-top: 4px;">${DOMPurify.sanitize(node.label)}</div>
                    <div class="selectable" style="color: var(--text-muted); font-size: 0.72rem;">ID: ${DOMPurify.sanitize(String(node.rawId))}</div>
                </div>
                ${inviteBlockHtml}
                <div style="margin-bottom: 0.4rem;"><strong>Usuarios Detectados Aquí:</strong> <span style="color: var(--accent-green);">${members.length}</span></div>
                <div style="margin-bottom: 0.4rem;"><strong>Mensajes Captados:</strong> <span style="color: var(--accent-green);">${srv.mensajesSesion || 0}</span></div>
                <div style="margin-bottom: 0.4rem;"><strong>Miembros Totales Discord:</strong> ${srv.memberCount || 'N/A'}</div>
                <div style="margin-bottom: 0.8rem;"><strong>Unidades Infiltradas:</strong> <span style="color: var(--accent-amber);">${DOMPurify.sanitize(exploradores)}</span></div>
                ${alianzasHtml}
                <div style="color: var(--accent-rz); font-weight: 700; margin-bottom: 0.4rem;">SUJETOS ACTIVOS EN ESTE SERVIDOR (${members.length}):</div>
                <div style="max-height: 230px; overflow-y: auto; border: var(--border-subtle); border-radius: 4px; background: rgba(0,0,0,0.2);">
                    ${membersHtml || '<div style="padding:0.75rem;color:var(--text-muted);">Sin usuarios registrados aún.</div>'}
                </div>
            `;

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
                        <span><strong style="color:#ef4444;">&#9679;</strong> <strong>${DOMPurify.sanitize(info.name)}</strong></span>
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

            const altsDeUsuario = this.altMapByUser.get(String(node.rawId)) || [];
            let altsHtml = `<div style="color: var(--text-muted); font-size: 0.72rem; margin-bottom: 0.85rem;">Sin coincidencias espejo por encima del umbral.</div>`;

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
                <div style="border-left: 3px solid #10b981; padding-left: 0.75rem; margin-bottom: 0.85rem;">
                    <div style="color: #10b981; font-weight: 700;">[ NODO USUARIO // VERDE ]</div>
                    <div style="font-size: 1rem; color: var(--text-main); font-weight: 700; margin-top: 3px;">${DOMPurify.sanitize(node.label)}</div>
                    <div class="selectable" style="color: var(--text-muted); font-size: 0.72rem;">UID: ${DOMPurify.sanitize(String(node.rawId))}</div>
                </div>
                <div style="margin-bottom: 0.4rem;"><strong>Actividad Total:</strong> <span style="color: var(--accent-green);">${usr.totalMensajes || 0} mensajes</span></div>
                <div style="margin-bottom: 0.4rem;"><strong>Servidores Comunes:</strong> <span style="color: ${node.serverCount > 1 ? '#fbbf24' : 'var(--text-main)'};">${node.serverCount} servidor(es)</span></div>
                <div style="margin-bottom: 0.75rem;"><strong>Infracciones Fichadas:</strong> <span style="color: ${node.infracciones > 0 ? '#ef4444' : 'var(--text-muted)'};">${node.infracciones}</span></div>

                <div style="color: var(--accent-info); font-weight: 700; font-size: 0.72rem; margin-bottom: 0.3rem;">HUELLA HORARIA 24H (UTC):</div>
                <div style="display:grid;grid-template-columns:repeat(24,1fr);gap:2px;margin-bottom:0.85rem;">${clockCells}</div>

                <div style="color: #fcee0a; font-weight: 700; margin-bottom: 0.35rem;">SOSPECHAS DE CUENTA ESPEJO (ALTS):</div>
                <div style="margin-bottom: 0.85rem;">${altsHtml}</div>

                <div style="color: var(--accent-rz); font-weight: 700; margin-bottom: 0.35rem;">SERVIDORES DETECTADOS:</div>
                <div style="margin-bottom: 1rem;">${servidoresList || 'Sin servidores'}</div>
                <button id="btn-open-dossier" class="btn-cyber" type="button" style="padding: 0.55rem; font-size: 0.78rem;">ABRIR EXPEDIENTE OSINT</button>
            `;

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
        this.particles = [];
        this.seenPulses.clear();
    }
};
