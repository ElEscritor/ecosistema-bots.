'use strict';

/* ==========================================================================
   VISTA: MAPA DE RED EN VIVO (SERVIDORES EN ROJO // USUARIOS EN VERDE)
   Archivo: js/vistas/red.js
   ========================================================================== */

window.C4ISR_Views = window.C4ISR_Views || {};

window.C4ISR_Views.red = {
    canvas: null,
    ctx: null,
    animationFrameId: null,
    pollIntervalId: null,
    resizeObserver: null,

    nodes: new Map(),
    edges: [],
    particles: [],
    seenPulses: new Set(),

    camera: { x: 0, y: 0, zoom: 0.9 },
    isDraggingCanvas: false,
    draggedNode: null,
    hoveredNode: null,
    selectedNode: null,
    lastMousePos: { x: 0, y: 0 },

    physicsEnabled: true,
    showUserLinks: true,
    onlyBridges: false,
    searchTerm: '',

    async render(container) {
        container.innerHTML = `
            <div class="panel-header" style="margin-bottom: 0.85rem;">
                <div>
                    <span class="panel-title" style="font-size: 1.1rem; color: var(--accent-rz);">TOPOLOGÍA EN TIEMPO REAL // SERVIDORES Y ACTIVIDAD</span>
                    <span id="red-stats-badge" class="badge badge-green" style="margin-left: 0.75rem;">SINCRONIZANDO...</span>
                </div>
                <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
                    <button id="btn-toggle-bridges" class="btn-action" type="button">FILTRAR PUENTES MULTI-SERVER: OFF</button>
                    <button id="btn-toggle-chatlinks" class="btn-action" type="button">VÍNCULOS DE DIÁLOGO (&lt;30s): ON</button>
                    <button id="btn-toggle-physics" class="btn-action" type="button">FÍSICAS: ON</button>
                    <button id="btn-center-graph" class="btn-action" type="button">CENTRAR</button>
                </div>
            </div>

            <div class="toolbar-tactical" style="margin-bottom: 0.85rem; padding: 0.65rem 1rem;">
                <input type="text" id="red-search" class="search-input" placeholder="Localizar servidor o usuario en el mapa..." autocomplete="off">
                <div style="display: flex; gap: 1.2rem; align-items: center; font-family: var(--font-mono); font-size: 0.74rem; color: var(--text-secondary);">
                    <span><strong style="color: #ef4444;">● ROJO:</strong> SERVIDORES</span>
                    <span><strong style="color: #10b981;">● VERDE:</strong> USUARIOS ACTIVOS</span>
                    <span><strong style="color: #fbbf24;">◎ ANILLO ÁMBAR:</strong> USUARIO EN VARIOS SERVERS / FICHADO</span>
                </div>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 330px; gap: 1rem; height: calc(100vh - 235px); min-height: 480px;">
                <div id="canvas-wrapper" style="position: relative; background: #07060a; border: var(--border-thin); border-radius: var(--radius-md); overflow: hidden;">
                    <canvas id="net-canvas" style="width: 100%; height: 100%; display: block; cursor: grab;"></canvas>
                    <div id="live-feed-ticker" style="position: absolute; bottom: 10px; left: 12px; font-family: var(--font-mono); font-size: 0.72rem; color: var(--accent-green); background: rgba(9, 8, 12, 0.85); padding: 4px 10px; border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 4px; pointer-events: none;">
                        [RADAR ACTIVO] Esperando impulsos de red...
                    </div>
                </div>

                <div class="osint-panel" style="height: 100%;">
                    <div class="panel-header" style="margin: 0; padding: 0.9rem 1.1rem;">
                        <span class="panel-title" style="color: var(--accent-amber);">INSPECTOR DE NODO</span>
                    </div>
                    <div id="node-inspector-content" class="osint-content" style="font-family: var(--font-mono); font-size: 0.8rem;">
                        <div style="color: var(--text-muted); padding-top: 1rem;">
                            Haz clic sobre cualquier punto rojo (Servidor) o punto verde (Usuario) en el lienzo para inspeccionar su actividad en vivo, servidores en común y conexiones.
                        </div>
                    </div>
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

    bindEvents() {
        window.addEventListener('resize', () => this.resizeCanvas());

        const btnPhysics = document.getElementById('btn-toggle-physics');
        const btnChatLinks = document.getElementById('btn-toggle-chatlinks');
        const btnBridges = document.getElementById('btn-toggle-bridges');
        const btnCenter = document.getElementById('btn-center-graph');
        const searchInput = document.getElementById('red-search');

        if (btnPhysics) {
            btnPhysics.addEventListener('click', () => {
                this.physicsEnabled = !this.physicsEnabled;
                btnPhysics.textContent = `FÍSICAS: ${this.physicsEnabled ? 'ON' : 'OFF'}`;
            });
        }

        if (btnChatLinks) {
            btnChatLinks.addEventListener('click', () => {
                this.showUserLinks = !this.showUserLinks;
                btnChatLinks.textContent = `VÍNCULOS DE DIÁLOGO (<30s): ${this.showUserLinks ? 'ON' : 'OFF'}`;
            });
        }

        if (btnBridges) {
            btnBridges.addEventListener('click', () => {
                this.onlyBridges = !this.onlyBridges;
                btnBridges.textContent = `FILTRAR PUENTES MULTI-SERVER: ${this.onlyBridges ? 'ON' : 'OFF'}`;
            });
        }

        if (btnCenter) {
            btnCenter.addEventListener('click', () => this.centerCamera());
        }

        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                this.searchTerm = e.target.value.toLowerCase().trim();
            });
        }

        // Controles de ratón sobre el Canvas (Zoom, Pan y Drag de Nodos)
        this.canvas.addEventListener('mousedown', (e) => {
            const pos = this.screenToWorld(e.offsetX, e.offsetY);
            const hit = this.findNodeAt(pos.x, pos.y);
            if (hit) {
                this.draggedNode = hit;
                this.selectedNode = hit;
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

        window.addEventListener('mouseup', () => {
            this.draggedNode = null;
            this.isDraggingCanvas = false;
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
            if (Math.sqrt(dx * dx + dy * dy) <= node.radius + 4) {
                return node;
            }
        }
        return null;
    },

    isNodeVisible(node) {
        if (this.onlyBridges && node.type === 'USER') {
            if (node.serverCount < 2 && !node.fichado) return false;
        }
        if (this.searchTerm) {
            return node.label.toLowerCase().includes(this.searchTerm) || String(node.rawId).includes(this.searchTerm);
        }
        return true;
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
                const radius = Math.max(7, Math.min(20, 6 + Math.log2((usr.totalMensajes || 1) + 1) * 2.2 + (serverCount > 1 ? 4 : 0)));

                let node = this.nodes.get(key);
                if (!node) {
                    // Nacer cerca de su primer servidor conocido
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
                        meta: usr
                    };
                    this.nodes.set(key, node);
                } else {
                    node.label = usr.tag || node.label;
                    node.radius = radius;
                    node.serverCount = serverCount;
                    node.fichado = Boolean(usr.fichado);
                    node.infracciones = usr.infracciones || 0;
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

            this.edges = nuevasAristas;

            // 4. Disparar partículas animadas por cada nuevo pulso en tiempo real
            for (const p of pulsos) {
                const pulseKey = `${p.userId}_${p.guildId}_${p.ts}`;
                if (!this.seenPulses.has(pulseKey)) {
                    this.seenPulses.add(pulseKey);
                    this.spawnParticle(`USR_${p.userId}`, `SRV_${p.guildId}`);
                    const ticker = document.getElementById('live-feed-ticker');
                    if (ticker) {
                        ticker.textContent = `[IMPULSO EN VIVO] ${p.userTag} ➔ ${p.guildName}`;
                    }
                }
            }

            if (this.selectedNode && this.nodes.has(this.selectedNode.key)) {
                this.selectedNode = this.nodes.get(this.selectedNode.key);
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

    stepPhysics() {
        if (!this.physicsEnabled) return;
        const visibleNodes = Array.from(this.nodes.values()).filter(n => this.isNodeVisible(n));

        // 1. Repulsión entre nodos
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

        // 2. Atracción de muelles por aristas
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

        // 3. Gravedad central suave y amortiguación
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
        const pulse = (Math.sin(now * 0.005) + 1) * 0.5;

        ctx.clearRect(0, 0, w, h);
        ctx.save();
        ctx.translate(this.camera.x, this.camera.y);
        ctx.scale(this.camera.zoom, this.camera.zoom);

        // 1. Dibujar Aristas
        for (const edge of this.edges) {
            if (edge.kind === 'CHAT' && !this.showUserLinks) continue;
            const s = this.nodes.get(edge.source);
            const t = this.nodes.get(edge.target);
            if (!s || !t || !this.isNodeVisible(s) || !this.isNodeVisible(t)) continue;

            ctx.beginPath();
            ctx.moveTo(s.x, s.y);
            ctx.lineTo(t.x, t.y);
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

        // 2. Dibujar Partículas de Actividad en Vivo (Verde Neón hacia Servidor Rojo)
        for (let i = this.particles.length - 1; i >= 0; i--) {
            const p = this.particles[i];
            p.progress += p.speed;
            if (p.progress >= 1) {
                this.particles.splice(i, 1);
                continue;
            }
            const s = this.nodes.get(p.sourceKey);
            const t = this.nodes.get(p.targetKey);
            if (!s || !t) continue;

            const px = s.x + (t.x - s.x) * p.progress;
            const py = s.y + (t.y - s.y) * p.progress;

            ctx.beginPath();
            ctx.arc(px, py, 3.5, 0, Math.PI * 2);
            ctx.fillStyle = '#34d399';
            ctx.shadowColor = '#10b981';
            ctx.shadowBlur = 10;
            ctx.fill();
            ctx.shadowBlur = 0;
        }

        // 3. Dibujar Nodos (Rojos = Servidores, Verdes = Usuarios)
        for (const node of this.nodes.values()) {
            if (!this.isNodeVisible(node)) continue;

            const isSelected = this.selectedNode && this.selectedNode.key === node.key;
            const isHovered = this.hoveredNode && this.hoveredNode.key === node.key;

            if (node.type === 'SERVER') {
                // Halo pulsante para Servidores (Puntos Rojos)
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
                // Nodo Verde (Usuario)
                const isBridge = node.serverCount >= 2;
                if (isBridge || node.fichado) {
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

                if (this.camera.zoom > 0.65 || isHovered || isSelected || isBridge) {
                    ctx.font = '10px "JetBrains Mono", monospace';
                    ctx.fillStyle = isBridge ? '#fbbf24' : '#cbd5e1';
                    ctx.textAlign = 'center';
                    ctx.fillText(node.label.slice(0, 18), node.x, node.y - node.radius - 5);
                }
            }
        }

        ctx.restore();
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
            const servidoresList = Object.entries(usr.servidores || {}).map(([sId, info]) => {
                return `<div style="padding: 4px 0; border-bottom: var(--border-subtle);">● <strong>${DOMPurify.sanitize(info.name)}</strong> (${info.count} msgs)</div>`;
            }).join('');

            panel.innerHTML = `
                <div style="border-left: 3px solid #10b981; padding-left: 0.75rem; margin-bottom: 1rem;">
                    <div style="color: #10b981; font-weight: 700;">[ NODO USUARIO // VERDE ]</div>
                    <div style="font-size: 1rem; color: var(--text-main); font-weight: 700; margin-top: 4px;">${DOMPurify.sanitize(node.label)}</div>
                    <div style="color: var(--text-muted); font-size: 0.72rem;">UID: ${DOMPurify.sanitize(String(node.rawId))}</div>
                </div>
                <div style="margin-bottom: 0.5rem;"><strong>Actividad Total:</strong> <span style="color: var(--accent-green);">${usr.totalMensajes || 0} mensajes</span></div>
                <div style="margin-bottom: 0.5rem;"><strong>Servidores Comunes:</strong> <span style="color: ${node.serverCount > 1 ? '#fbbf24' : 'var(--text-main)'};">${node.serverCount} servidor(es)</span></div>
                <div style="margin-bottom: 0.8rem;"><strong>Infracciones Fichadas:</strong> <span style="color: ${node.infracciones > 0 ? '#ef4444' : 'var(--text-muted)'};">${node.infracciones}</span></div>
                <div style="color: var(--accent-rz); font-weight: 700; margin-bottom: 0.4rem;">SERVIDORES DETECTADOS:</div>
                <div style="margin-bottom: 1rem;">${servidoresList || 'Sin servidores'}</div>
                <button id="btn-open-dossier" class="btn-cyber" type="button" style="padding: 0.55rem; font-size: 0.78rem;">ABRIR EXPEDIENTE OSINT</button>
            `;

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
        this.nodes.clear();
        this.edges = [];
        this.particles = [];
        this.seenPulses.clear();
    }
};
