'use strict';

/* ==========================================================================
   VISTA: MAPA DE RED EN VIVO + MOTOR FORENSE CAZA DE ALTS (JACCARD + HORARIO)
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
    suspectPairs: [],
    altMapByUser: new Map(),
    particles: [],
    seenPulses: new Set(),

    camera: { x: 0, y: 0, zoom: 0.9 },
    isDraggingCanvas: false,
    draggedNode: null,
    hoveredNode: null,
    selectedNode: null,
    highlightedPair: null,
    lastMousePos: { x: 0, y: 0 },

    rightPanelTab: 'inspector', // 'inspector' | 'alts'
    physicsEnabled: true,
    showUserLinks: true,
    showAltLinks: true,
    onlyBridges: false,
    searchTerm: '',

    async render(container) {
        container.innerHTML = `
            <div class="panel-header" style="margin-bottom: 0.85rem;">
                <div>
                    <span class="panel-title" style="font-size: 1.1rem; color: var(--accent-rz);">TOPOLOGÍA EN TIEMPO REAL // SERVIDORES, ACTIVIDAD Y ALTS</span>
                    <span id="red-stats-badge" class="badge badge-green" style="margin-left: 0.75rem;">SINCRONIZANDO...</span>
                    <span id="red-alts-badge" class="badge badge-amber" style="margin-left: 0.4rem;">0 ALTS DETECTADAS</span>
                </div>
                <div style="display: flex; gap: 0.45rem; flex-wrap: wrap;">
                    <button id="btn-toggle-bridges" class="btn-action" type="button">PUENTES MULTI-SERVER: OFF</button>
                    <button id="btn-toggle-chatlinks" class="btn-action" type="button">DIÁLOGO (&lt;30s): ON</button>
                    <button id="btn-toggle-altlinks" class="btn-action" type="button">ENLACES ALTS: ON</button>
                    <button id="btn-toggle-physics" class="btn-action" type="button">FÍSICAS: ON</button>
                    <button id="btn-center-graph" class="btn-action" type="button">CENTRAR</button>
                </div>
            </div>

            <div class="toolbar-tactical" style="margin-bottom: 0.85rem; padding: 0.65rem 1rem;">
                <input type="text" id="red-search" class="search-input" placeholder="Localizar servidor o usuario por nombre o UID..." autocomplete="off">
                <div style="display: flex; gap: 1rem; align-items: center; font-family: var(--font-mono); font-size: 0.73rem; color: var(--text-secondary); flex-wrap: wrap;">
                    <span><strong style="color: #ef4444;">&#9679; ROJO:</strong> SERVIDORES</span>
                    <span><strong style="color: #10b981;">&#9679; VERDE:</strong> USUARIOS</span>
                    <span><strong style="color: #fbbf24;">&#9678; ÁMBAR:</strong> MULTI-SERVER</span>
                    <span><strong style="color: #fcee0a;">&#10697; MIRA NEÓN:</strong> SOSPECHA ALT</span>
                </div>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 350px; gap: 1rem; height: calc(100vh - 235px); min-height: 480px;">
                <div id="canvas-wrapper" style="position: relative; background: #07060a; border: var(--border-thin); border-radius: var(--radius-md); overflow: hidden;">
                    <canvas id="net-canvas" style="width: 100%; height: 100%; display: block; cursor: grab;"></canvas>
                    <div id="live-feed-ticker" style="position: absolute; bottom: 10px; left: 12px; font-family: var(--font-mono); font-size: 0.72rem; color: var(--accent-green); background: rgba(9, 8, 12, 0.88); padding: 4px 10px; border: 1px solid rgba(16, 185, 129, 0.35); border-radius: 4px; pointer-events: none;">
                        [RADAR ACTIVO] Esperando impulsos de red...
                    </div>
                </div>

                <div class="osint-panel" style="height: 100%;">
                    <div class="panel-header" style="margin: 0; padding: 0.65rem 0.9rem; display: flex; gap: 0.4rem;">
                        <button id="tab-btn-inspector" class="btn-action" type="button" style="flex: 1; background: var(--accent-rz); color: #fff;">INSPECTOR NODO</button>
                        <button id="tab-btn-alts" class="btn-action" type="button" style="flex: 1;">RADAR ALTS (0)</button>
                    </div>
                    <div id="node-inspector-content" class="osint-content" style="font-family: var(--font-mono); font-size: 0.79rem;">
                        <div style="color: var(--text-muted); padding-top: 1rem;">
                            Haz clic sobre cualquier punto rojo (Servidor) o punto verde (Usuario) en el lienzo para inspeccionar su actividad en vivo, servidores en común y análisis de cuentas espejo (Alts).
                        </div>
                    </div>
                    <div id="alts-radar-content" class="osint-content hidden" style="font-family: var(--font-mono); font-size: 0.79rem;"></div>
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
        this.camera.zoom = 0.85;
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

        const btnPhysics = document.getElementById('btn-toggle-physics');
        const btnChatLinks = document.getElementById('btn-toggle-chatlinks');
        const btnAltLinks = document.getElementById('btn-toggle-altlinks');
        const btnBridges = document.getElementById('btn-toggle-bridges');
        const btnCenter = document.getElementById('btn-center-graph');
        const searchInput = document.getElementById('red-search');
        const tabInspector = document.getElementById('tab-btn-inspector');
        const tabAlts = document.getElementById('tab-btn-alts');

        if (tabInspector) {
            tabInspector.addEventListener('click', () => this.switchRightTab('inspector'));
        }
        if (tabAlts) {
            tabAlts.addEventListener('click', () => this.switchRightTab('alts'));
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
                btnBridges.textContent = `PUENTES MULTI-SERVER: ${this.onlyBridges ? 'ON' : 'OFF'}`;
            });
        }

        if (btnCenter) {
            btnCenter.addEventListener('click', () => {
                this.highlightedPair = null;
                this.centerCamera();
            });
        }

        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                this.searchTerm = e.target.value.toLowerCase().trim();
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
                this.hoveredNode = this.findNodeAt(pos.x, pos.y);
                this.canvas.style.cursor = this.hoveredNode ? 'pointer' : 'grab';
            }
        });

        this.canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            const factor = e.deltaY < 0 ? 1.12 : 0.89;
            this.camera.zoom = Math.max(0.18, Math.min(3.5, this.camera.zoom * factor));
        }, { passive: false });
    },

    screenToWorld(sx, sy) {
        return {
            x: (sx - this.camera.x) / this.camera.zoom,
            y: (sy - this.camera.y) / this.camera.zoom
        };
    },

    findNodeAt(wx, wy) {
        for (const node of this.nodes.values()) {
            if (!this.isNodeVisible(node)) continue;
            const dx = wx - node.x;
            const dy = wy - node.y;
            if (Math.sqrt(dx * dx + dy * dy) <= node.radius + 5) {
                return node;
            }
        }
        return null;
    },

    isNodeVisible(node) {
        if (this.onlyBridges && node.type === 'USER') {
            if (node.serverCount < 2 && !node.fichado && !node.altRole) return false;
        }
        if (this.searchTerm) {
            return node.label.toLowerCase().includes(this.searchTerm) || String(node.rawId).includes(this.searchTerm);
        }
        return true;
    },

    /**
     * Motor Forense Multi-Heurístico en JS:
     * 1. Similitud de Jaccard sobre vecinos de conversación (<30s) + servidores compartidos (sin hablar entre sí o peso <= 1).
     * 2. Exclusión Horaria por bloques (Madrugada, Mañana, Tarde, Noche), Conmutación (<10 min) y Sueño Común (>= 6h).
     */
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

                // Regla Efecto Espejo: Nunca o casi nunca hablan directamente entre ellos (peso <= 1)
                if (pesoDirecto > 1) continue;

                const vChatSet = chatNeighbors.get(v.id) || new Set();
                const vSrvKeys = Object.keys(v.servidores || {});

                // Construir conjunto de huella relacional (vecinos de chat + servidores)
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

                // Exigir al menos 2 vectores compartidos y al menos 1 servidor en común
                const sharedServers = uSrvKeys.filter(s => vSrvKeys.includes(s));
                if (interseccion.length < 2 || sharedServers.length === 0) continue;

                // Exigir que o bien compartan >= 2 vecinos de diálogo o bien >= 2 servidores exactos
                const sharedChatPartners = [...uChatSet].filter(id => id !== v.id && vChatSet.has(id));
                if (sharedChatPartners.length < 2 && sharedServers.length < 2) continue;

                const unionSize = featuresU.size + featuresV.size - interseccion.length;
                const jaccard = unionSize > 0 ? (interseccion.length / unionSize) : 0;

                if (jaccard < 0.65) continue;

                // Evaluación Cronobiológica: Ciclos de sueño (horas inactivas 0..23)
                const horasU = new Set(Array.isArray(u.horasActivas) ? u.horasActivas : []);
                const horasV = new Set(Array.isArray(v.horasActivas) ? v.horasActivas : []);
                let horasSuenoComunes = 0;
                for (let h = 0; h < 24; h++) {
                    if (!horasU.has(h) && !horasV.has(h)) horasSuenoComunes++;
                }

                // Bloques dominantes
                const blocksU = new Set([...horasU].map(getBlockName));
                const blocksV = new Set([...horasV].map(getBlockName));
                let sharedBlocks = 0;
                blocksU.forEach(b => { if (blocksV.has(b)) sharedBlocks++; });
                const exclusionHoraria = (blocksU.size > 0 && blocksV.size > 0 && sharedBlocks === 0);

                // Conmutación rápida (< 10 minutos = 600.000 ms) en servidores compartidos
                let relevosRapidos = 0;
                for (const sId of sharedServers) {
                    const lastU = u.servidores[sId]?.lastSeen || 0;
                    const lastV = v.servidores[sId]?.lastSeen || 0;
                    const gapMs = Math.abs(lastU - lastV);
                    if (gapMs >= 8000 && gapMs <= 600000) {
                        relevosRapidos++;
                    }
                }

                const esCritico = (relevosRapidos >= 1 || exclusionHoraria) && horasSuenoComunes >= 6;
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

        // Actualizar contadores en UI
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
            const pulsos = Array.isArray(data.pulsos) ? data.pulsos : [];

            const badge = document.getElementById('red-stats-badge');
            if (badge) {
                badge.textContent = `${servidores.length} SERVIDORES (ROJOS) // ${usuarios.length} USUARIOS (VERDES)`;
            }

            // Ejecutar motor de detección de cuentas espejo (Alts)
            this.analyzeMirrorAccounts(usuarios, interacciones);

            // 1. Sincronizar Nodos Rojos (Servidores)
            servidores.forEach((srv, idx) => {
                const key = `SRV_${srv.id}`;
                let node = this.nodes.get(key);
                const radius = Math.max(18, Math.min(42, 16 + Math.sqrt(srv.mensajesSesion || 1) * 2.5));
                if (!node) {
                    const angle = (idx / Math.max(1, servidores.length)) * Math.PI * 2;
                    const dist = 220 + (idx % 3) * 90;
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
                        meta: srv
                    };
                    this.nodes.set(key, node);
                } else {
                    node.label = srv.name || node.label;
                    node.radius = radius;
                    node.meta = srv;
                }
            });

            // 2. Sincronizar Nodos Verdes (Usuarios) y Aristas Usuario -> Servidor
            const nuevasAristas = [];
            usuarios.forEach((usr) => {
                const key = `USR_${usr.id}`;
                const srvKeys = Object.keys(usr.servidores || {});
                const serverCount = srvKeys.length;
                const altsDeUsuario = this.altMapByUser.get(usr.id) || [];
                const altRole = altsDeUsuario.some(a => a.nivelAlerta === 'CRÍTICO')
                    ? 'CRITICO'
                    : (altsDeUsuario.length > 0 ? 'ADVERTENCIA' : null);

                const radius = Math.max(
                    7,
                    Math.min(20, 6 + Math.log2((usr.totalMensajes || 1) + 1) * 2.2 + (serverCount > 1 ? 4 : 0))
                );

                let node = this.nodes.get(key);
                if (!node) {
                    const parentSrv = srvKeys.length > 0 ? this.nodes.get(`SRV_${srvKeys[0]}`) : null;
                    const baseX = parentSrv ? parentSrv.x : 0;
                    const baseY = parentSrv ? parentSrv.y : 0;
                    node = {
                        key,
                        rawId: usr.id,
                        type: 'USER',
                        label: usr.tag || 'Usuario',
                        x: baseX + (Math.random() - 0.5) * 140,
                        y: baseY + (Math.random() - 0.5) * 140,
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
                    }
                }
            });

            // 3. Aristas de conversación rápida (< 30s) entre Usuarios
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
                }
            }

            // 4. Aristas espejo entre pares de Alts sospechosas
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
                }
            }

            this.edges = nuevasAristas;

            // 5. Disparar partículas animadas por cada nuevo pulso en tiempo real
            if (this.seenPulses.size > 500) {
                this.seenPulses.clear();
            }
            for (const p of pulsos) {
                const pulseKey = `${p.userId}_${p.guildId}_${p.ts}`;
                if (!this.seenPulses.has(pulseKey)) {
                    this.seenPulses.add(pulseKey);
                    this.spawnParticle(`USR_${p.userId}`, `SRV_${p.guildId}`);
                    const ticker = document.getElementById('live-feed-ticker');
                    if (ticker) {
                        ticker.innerHTML = `[IMPULSO EN VIVO] ${DOMPurify.sanitize(String(p.userTag))} &rarr; ${DOMPurify.sanitize(String(p.guildName))}`;
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

    focusOnNodePair(key1, key2) {
        const n1 = this.nodes.get(key1);
        const n2 = this.nodes.get(key2);
        if (!n1 || !n2 || !this.canvas) return;

        this.highlightedPair = [key1, key2];
        const midX = (n1.x + n2.x) / 2;
        const midY = (n1.y + n2.y) / 2;
        this.camera.zoom = 1.15;
        this.camera.x = (this.canvas.width / 2) - (midX * this.camera.zoom);
        this.camera.y = (this.canvas.height / 2) - (midY * this.camera.zoom);
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
                const maxDist = (n1.type === 'SERVER' && n2.type === 'SERVER') ? 520 : 240;
                if (distSq > maxDist * maxDist) continue;

                const dist = Math.sqrt(distSq);
                const repulsionForce = (n1.type === 'SERVER' && n2.type === 'SERVER') ? 3800 : 650;
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
            const targetLen = edge.kind === 'MEMBERSHIP' ? 115 : 75;
            const strength = edge.kind === 'MEMBERSHIP' ? 0.035 : 0.015;
            const force = (dist - targetLen) * strength;
            const fx = (dx / dist) * force;
            const fy = (dy / dist) * force;

            if (s !== this.draggedNode) { s.vx += fx; s.vy += fy; }
            if (t !== this.draggedNode) { t.vx -= fx * 0.25; t.vy -= fy * 0.25; }
        }

        for (const n of visibleNodes) {
            if (n === this.draggedNode) continue;
            n.vx -= n.x * 0.0012;
            n.vy -= n.y * 0.0012;
            n.vx *= 0.82;
            n.vy *= 0.82;
            n.x += n.vx;
            n.y += n.vy;
        }
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
        ctx.save();
        ctx.translate(this.camera.x, this.camera.y);
        ctx.scale(this.camera.zoom, this.camera.zoom);

        // 1. Dibujar Aristas Normales
        for (const edge of this.edges) {
            if (edge.kind === 'CHAT' && !this.showUserLinks) continue;
            const s = this.nodes.get(edge.source);
            const tNode = this.nodes.get(edge.target);
            if (!s || !tNode || !this.isNodeVisible(s) || !this.isNodeVisible(tNode)) continue;

            ctx.beginPath();
            ctx.moveTo(s.x, s.y);
            ctx.lineTo(tNode.x, tNode.y);
            if (edge.kind === 'MEMBERSHIP') {
                const isBridge = s.serverCount >= 2;
                ctx.strokeStyle = isBridge ? 'rgba(251, 191, 36, 0.38)' : 'rgba(16, 185, 129, 0.22)';
                ctx.lineWidth = Math.min(3.5, 0.8 + Math.log2(edge.weight + 1) * 0.5);
            } else {
                ctx.strokeStyle = 'rgba(56, 189, 248, 0.28)';
                ctx.lineWidth = 1.1;
            }
            ctx.stroke();
        }

        // 2. Dibujar Enlaces Espejo Punteados entre Cuentas Alt Detectadas
        if (this.showAltLinks) {
            for (const altEdge of this.altEdges) {
                const s = this.nodes.get(altEdge.source);
                const tNode = this.nodes.get(altEdge.target);
                if (!s || !tNode || !this.isNodeVisible(s) || !this.isNodeVisible(tNode)) continue;

                const isHighlighted = this.highlightedPair &&
                    this.highlightedPair.includes(s.key) &&
                    this.highlightedPair.includes(tNode.key);

                ctx.save();
                ctx.beginPath();
                ctx.setLineDash([6, 6]);
                ctx.moveTo(s.x, s.y);
                ctx.lineTo(tNode.x, tNode.y);
                ctx.strokeStyle = altEdge.critical ? '#ff003c' : '#fcee0a';
                ctx.lineWidth = isHighlighted ? 2.8 : 1.6;
                ctx.stroke();

                if (this.camera.zoom > 0.7 || isHighlighted) {
                    const mx = (s.x + tNode.x) / 2;
                    const my = (s.y + tNode.y) / 2;
                    ctx.font = 'bold 9px "JetBrains Mono", monospace';
                    ctx.fillStyle = altEdge.critical ? '#ff003c' : '#fcee0a';
                    ctx.textAlign = 'center';
                    ctx.fillText(`ALT ${Math.round(altEdge.jaccard * 100)}%`, mx, my - 4);
                }
                ctx.restore();
            }
        }

        // 3. Dibujar Partículas de Actividad en Vivo (Verde Neón hacia Servidor Rojo)
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

        // 4. Dibujar Nodos (Rojos = Servidores, Verdes = Usuarios)
        for (const node of this.nodes.values()) {
            if (!this.isNodeVisible(node)) continue;

            const isSelected = (this.selectedNode && this.selectedNode.key === node.key) ||
                (this.highlightedPair && this.highlightedPair.includes(node.key));
            const isHovered = this.hoveredNode && this.hoveredNode.key === node.key;

            if (node.type === 'SERVER') {
                ctx.beginPath();
                ctx.arc(node.x, node.y, node.radius + 5 + pulse * 8, 0, Math.PI * 2);
                ctx.strokeStyle = `rgba(239, 68, 68, ${0.55 - pulse * 0.4})`;
                ctx.lineWidth = 2;
                ctx.stroke();

                ctx.beginPath();
                ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
                ctx.fillStyle = '#ef4444';
                ctx.fill();
                ctx.lineWidth = isSelected || isHovered ? 3 : 1.8;
                ctx.strokeStyle = isSelected || isHovered ? '#ffffff' : '#fca5a5';
                ctx.stroke();

                ctx.font = 'bold 11px "JetBrains Mono", monospace';
                ctx.fillStyle = '#ffffff';
                ctx.textAlign = 'center';
                ctx.fillText(node.label.slice(0, 24), node.x, node.y + node.radius + 14);
            } else {
                const isBridge = node.serverCount >= 2;

                // Retícula táctica giratoria si es sospechoso de Cuenta Espejo (Alt)
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
                    ctx.arc(node.x, node.y, node.radius + 4 + pulse * 4, 0, Math.PI * 2);
                    ctx.strokeStyle = node.fichado ? '#ff2a6d' : '#fbbf24';
                    ctx.lineWidth = 1.5;
                    ctx.stroke();
                }

                ctx.beginPath();
                ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
                ctx.fillStyle = '#10b981';
                ctx.fill();
                ctx.lineWidth = isSelected || isHovered ? 2.5 : 1.2;
                ctx.strokeStyle = isSelected || isHovered ? '#ffffff' : '#059669';
                ctx.stroke();

                if (this.camera.zoom > 0.65 || isHovered || isSelected || isBridge || node.altRole) {
                    ctx.font = '10px "JetBrains Mono", monospace';
                    ctx.fillStyle = node.altRole
                        ? (node.altRole === 'CRITICO' ? '#ff003c' : '#fcee0a')
                        : (isBridge ? '#fbbf24' : '#cbd5e1');
                    ctx.textAlign = 'center';
                    ctx.fillText(node.label.slice(0, 18), node.x, node.y - node.radius - 5);
                }
            }
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
                    Aún no se detectan pares de usuarios con índice de Jaccard &ge; 65% y ausencia de diálogo directo. A medida que los exploradores capten más conversaciones en vivo, las cuentas espejo aparecerán aquí automáticamente.
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

            panel.innerHTML = `
                <div style="border-left: 3px solid #ef4444; padding-left: 0.75rem; margin-bottom: 1rem;">
                    <div style="color: #ef4444; font-weight: 700;">[ NODO SERVIDOR // ROJO ]</div>
                    <div style="font-size: 1rem; color: var(--text-main); font-weight: 700; margin-top: 4px;">${DOMPurify.sanitize(node.label)}</div>
                    <div style="color: var(--text-muted); font-size: 0.72rem;">ID: ${DOMPurify.sanitize(String(node.rawId))}</div>
                </div>
                <div style="margin-bottom: 0.6rem;"><strong>Mensajes Captados:</strong> <span style="color: var(--accent-green);">${srv.mensajesSesion || 0}</span></div>
                <div style="margin-bottom: 0.6rem;"><strong>Miembros Totales:</strong> ${srv.memberCount || 'N/A'}</div>
                <div style="margin-bottom: 0.6rem;"><strong>Unidades Infiltradas:</strong> <span style="color: var(--accent-amber);">${DOMPurify.sanitize(exploradores)}</span></div>
            `;
        } else {
            const usr = node.meta || {};
            const servidoresList = Object.entries(usr.servidores || {}).map(([, info]) => {
                return `<div style="padding: 4px 0; border-bottom: var(--border-subtle);">&#9679; <strong>${DOMPurify.sanitize(info.name)}</strong> (${info.count} msgs)</div>`;
            }).join('');

            const altsDeUsuario = this.altMapByUser.get(String(node.rawId)) || [];
            let altsHtml = `<div style="color: var(--text-muted); font-size: 0.73rem; margin-bottom: 1rem;">Sin coincidencias espejo por encima del umbral.</div>`;

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
                <div style="border-left: 3px solid #10b981; padding-left: 0.75rem; margin-bottom: 1rem;">
                    <div style="color: #10b981; font-weight: 700;">[ NODO USUARIO // VERDE ]</div>
                    <div style="font-size: 1rem; color: var(--text-main); font-weight: 700; margin-top: 4px;">${DOMPurify.sanitize(node.label)}</div>
                    <div style="color: var(--text-muted); font-size: 0.72rem;">UID: ${DOMPurify.sanitize(String(node.rawId))}</div>
                </div>
                <div style="margin-bottom: 0.45rem;"><strong>Actividad Total:</strong> <span style="color: var(--accent-green);">${usr.totalMensajes || 0} mensajes</span></div>
                <div style="margin-bottom: 0.45rem;"><strong>Servidores Comunes:</strong> <span style="color: ${node.serverCount > 1 ? '#fbbf24' : 'var(--text-main)'};">${node.serverCount} servidor(es)</span></div>
                <div style="margin-bottom: 0.75rem;"><strong>Infracciones Fichadas:</strong> <span style="color: ${node.infracciones > 0 ? '#ef4444' : 'var(--text-muted)'};">${node.infracciones}</span></div>
                <div style="color: #fcee0a; font-weight: 700; margin-bottom: 0.35rem;">SOSPECHAS DE CUENTA ESPEJO (ALTS):</div>
                <div style="margin-bottom: 0.85rem;">${altsHtml}</div>
                <div style="color: var(--accent-rz); font-weight: 700; margin-bottom: 0.35rem;">SERVIDORES DETECTADOS:</div>
                <div style="margin-bottom: 1rem;">${servidoresList || 'Sin servidores'}</div>
                <button id="btn-open-dossier" class="btn-cyber" type="button" style="padding: 0.55rem; font-size: 0.78rem;">ABRIR EXPEDIENTE OSINT</button>
            `;

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
        this.suspectPairs = [];
        this.altMapByUser.clear();
        this.particles = [];
        this.seenPulses.clear();
    }
};
