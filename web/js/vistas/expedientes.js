'use strict';

/* ==========================================================================
   VISTA: EXPEDIENTES OSINT + ESCÁNER APIS EXTERNAS + EXPORTADOR DOSSIER HTML
   Archivo: js/vistas/expedientes.js
   ========================================================================== */

window.C4ISR_Views = window.C4ISR_Views || {};

const DISCORD_EPOCH_BI = 1420070400000n;

function formatearFechaCorta(dateString) {
    if (!dateString) return 'Sin fecha';
    const d = new Date(dateString);
    if (Number.isNaN(d.getTime())) return String(dateString);
    return `${d.toLocaleDateString('es-ES')} ${d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`;
}

function decodificarSnowflake(userId) {
    try {
        const clean = String(userId || '').replace(/\D/g, '');
        if (clean.length < 17) return null;
        const ms = Number((BigInt(clean) >> 22n) + DISCORD_EPOCH_BI);
        const dias = Math.floor((Date.now() - ms) / 86400000);
        const fecha = new Date(ms).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
        return { fecha, dias, esBurner: dias <= 21 };
    } catch (_) {
        return null;
    }
}

window.C4ISR_Views.expedientes = {
    saveTimeout: null,
    currentTargetId: null,
    lastExternalIntel: null,
    globalData: null,
    outsideClickListener: null,

    async render(container) {
        container.innerHTML = `
            <div class="panel-header" style="margin-bottom: 1rem;">
                <span class="panel-title" style="font-size: 1.08rem; color: var(--accent-rz);">ARCHIVO DE EXPEDIENTES // INTELIGENCIA FEDERADA (XN / VPS / LC)</span>
                <div style="display: flex; gap: 0.55rem; align-items: center; flex-wrap: wrap;">
                    <button id="btn-toggle-arsenal" class="btn-action" type="button">+ AÑADIR REGLA / COMANDO EN VIVO</button>
                    <button id="btn-add-target" class="btn-action" type="button">+ INYECTAR UID MANUAL</button>
                    <button id="btn-import-targets" class="btn-export" type="button">IMPORTAR MATRIZ JSON</button>
                    <input type="file" id="file-import-input" accept=".json,application/json" class="hidden">
                </div>
            </div>

            <!-- Barra para añadir Comandos Squad o Palabras Clave en caliente sin tocar GitHub/Render -->
            <div id="arsenal-live-bar" class="toolbar-tactical hidden" style="border-color: #00f0ff; margin-bottom: 0.9rem;">
                <div style="display: flex; align-items: center; gap: 0.6rem; flex-grow: 1; flex-wrap: wrap;">
                    <span style="font-family: var(--font-mono); font-size: 0.76rem; color: #00f0ff;">[ ARSENAL EN VIVO ]</span>
                    <select id="select-arsenal-type" style="background: var(--bg-input); color: #00f0ff; border: 1px solid rgba(0,240,255,0.35); border-radius: 4px; padding: 0.45rem; font-family: var(--font-mono); font-size: 0.75rem;">
                        <option value="COMANDO_SQUAD">NUEVO COMANDO SQUAD (Ej: .cbot)</option>
                        <option value="PALABRA_RAID">NUEVA PALABRA CLAVE RAID</option>
                    </select>
                    <input type="text" id="input-arsenal-val" class="search-input" style="width: 210px;" placeholder="Ej: .cbot o nombre de squad">
                    <input type="text" id="input-arsenal-desc" class="search-input" style="flex: 1; min-width: 180px;" placeholder="Descripción del comando o amenaza...">
                    <button id="btn-save-arsenal" class="btn-export" type="button">ACTIVAR EN ENJAMBRE</button>
                </div>
            </div>

            <div id="manual-inject-bar" class="toolbar-tactical hidden" style="border-color: var(--accent-rz);">
                <div style="display: flex; align-items: center; gap: 0.75rem; flex-grow: 1; flex-wrap: wrap;">
                    <span style="font-family: var(--font-mono); font-size: 0.78rem; color: var(--accent-rz);">[ NUEVO OBJETIVO ]</span>
                    <input type="text" id="input-manual-uid" class="search-input" placeholder="Pegar Discord UID (17 a 20 dígitos)..." maxlength="20">
                    <button id="btn-confirm-uid" class="btn-action" type="button">REGISTRAR Y ESCANEAR APIS</button>
                    <button id="btn-cancel-uid" class="btn-action btn-purge" type="button">CANCELAR</button>
                </div>
            </div>

            <div id="osint-search-wrapper" style="position: relative; margin-bottom: 1rem; z-index: 40;">
                <div class="toolbar-tactical" style="margin-bottom: 0;">
                    <span style="color: var(--accent-rz); font-family: var(--font-mono); font-size: 0.8rem; font-weight: 700;">[ LOCALIZADOR ]</span>
                    <input type="text" id="osint-search" class="search-input" style="flex-grow: 1; width: auto;" placeholder="Buscar sujeto por UID, Alias actual o Alias histórico..." autocomplete="off">
                </div>
                <div id="osint-search-results" class="hidden" style="position: absolute; top: 100%; left: 0; width: 100%; max-height: 320px; overflow-y: auto; background: var(--bg-dark); border: var(--border-thin); border-radius: 0 0 var(--radius-md) var(--radius-md); box-shadow: var(--shadow-elevated);"></div>
            </div>

            <!-- Barra de Metadatos Forenses + Botones de Consulta API Externa y Exportación de Dossier -->
            <div id="osint-meta-strip" class="toolbar-tactical hidden" style="margin-bottom: 0.85rem; padding: 0.75rem 1.1rem; font-family: var(--font-mono); font-size: 0.75rem;"></div>

            <!-- Contenedor de Resultados en Vivo de XN Protect / VPS 5604 / LC Guard -->
            <div id="external-intel-box" class="toolbar-tactical hidden" style="margin-bottom: 0.9rem; border-color: #fcee0a; background: rgba(15, 13, 22, 0.95); font-family: var(--font-mono); font-size: 0.76rem;"></div>

            <div class="osint-layout hidden" id="osint-workspace">
                <div class="osint-panel">
                    <div class="panel-header" style="margin: 0; padding: 1rem 1.25rem;">
                        <span class="panel-title" style="color: var(--accent-amber);">HISTORIAL DE INTERCEPCIONES</span>
                        <span id="osint-target-badge" class="badge badge-red">SIN OBJETIVO</span>
                    </div>
                    <div class="osint-content" id="osint-raw-logs"></div>
                </div>
                <div class="osint-panel">
                    <div class="panel-header" style="margin: 0; padding: 1rem 1.25rem;">
                        <span class="panel-title">DOSSIER DEL ANALISTA (AUTOGUARDADO)</span>
                        <span id="osint-save-status" class="badge badge-green">SINCRONIZADO</span>
                    </div>
                    <div style="flex-grow: 1; padding: 0.85rem; display: flex;">
                        <textarea id="osint-notes-editor" class="editor-textarea" placeholder="Escriba aquí las conclusiones de inteligencia, cuentas secundarias (alts), redes vinculadas o notas operativas sobre el sujeto..."></textarea>
                    </div>
                </div>
            </div>
        `;

        try {
            this.globalData = await window.C4ISR_API.getDatosGlobales();
            this.bindEvents();

            if (window.C4ISR_TARGET_OVERRIDE) {
                const targetId = window.C4ISR_TARGET_OVERRIDE;
                window.C4ISR_TARGET_OVERRIDE = null;
                this.loadTargetWorkspace(targetId);
            } else {
                const lista = this.obtenerListaUnificada();
                if (lista.length > 0) {
                    this.loadTargetWorkspace(lista[0].id);
                }
            }
        } catch (error) {
            console.error('[Expedientes] Error cargando vista:', error);
            container.innerHTML = `
                <div class="login-error" style="display: block;">
                    [!] ERROR CRÍTICO AL CONECTAR CON EL ARCHIVO DE EXPEDIENTES.
                </div>`;
        }
    },

    obtenerListaUnificada() {
        if (!this.globalData) return [];
        const baseBlacklist = Array.isArray(this.globalData.blacklist) ? this.globalData.blacklist : [];
        return [...baseBlacklist].sort((a, b) => new Date(b.fecha || 0) - new Date(a.fecha || 0));
    },

    renderDropdownResults(usuarios) {
        const searchResults = document.getElementById('osint-search-results');
        if (!searchResults) return;

        if (usuarios.length === 0) {
            searchResults.innerHTML = `
                <div style="padding: 1rem; color: var(--text-muted); font-family: var(--font-mono); font-size: 0.8rem;">
                    Sin coincidencias en la base de datos.
                </div>`;
            searchResults.classList.remove('hidden');
            return;
        }

        searchResults.innerHTML = usuarios.slice(0, 25).map(u => {
            const id = DOMPurify.sanitize(String(u.id || ''));
            const username = DOMPurify.sanitize(String(u.username || 'Identidad Desconocida'));
            const numEventos = Array.isArray(u.historial) ? u.historial.length : (u.reincidencia || 0);
            const sf = decodificarSnowflake(id);
            const burnerTag = sf?.esBurner ? `<span class="badge badge-red" style="margin-left:6px;">BURNER ${sf.dias}d</span>` : '';

            return `
                <div class="search-item" data-id="${id}" style="padding: 0.75rem 1.15rem; border-bottom: var(--border-subtle); cursor: pointer; display: flex; justify-content: space-between; align-items: center;">
                    <div>
                        <div style="font-weight: 600; color: var(--text-main); font-size: 0.88rem;">${username}${burnerTag}</div>
                        <div style="font-family: var(--font-mono); font-size: 0.72rem; color: var(--text-muted);">UID: ${id}</div>
                    </div>
                    <span class="badge ${numEventos > 0 ? 'badge-red' : 'badge-amber'}">${numEventos} REGISTRO(S)</span>
                </div>
            `;
        }).join('');

        searchResults.classList.remove('hidden');

        searchResults.querySelectorAll('.search-item').forEach(item => {
            item.addEventListener('click', () => {
                const targetId = item.getAttribute('data-id');
                const searchInput = document.getElementById('osint-search');
                if (searchInput) searchInput.value = '';
                searchResults.classList.add('hidden');
                this.loadTargetWorkspace(targetId);
            });
        });
    },

    bindEvents() {
        const searchInput = document.getElementById('osint-search');
        const searchWrapper = document.getElementById('osint-search-wrapper');
        const searchResults = document.getElementById('osint-search-results');
        const editor = document.getElementById('osint-notes-editor');
        const btnAdd = document.getElementById('btn-add-target');
        const manualBar = document.getElementById('manual-inject-bar');
        const inputManualUid = document.getElementById('input-manual-uid');
        const btnConfirmUid = document.getElementById('btn-confirm-uid');
        const btnCancelUid = document.getElementById('btn-cancel-uid');
        const btnImport = document.getElementById('btn-import-targets');
        const fileInput = document.getElementById('file-import-input');

        const btnArsenal = document.getElementById('btn-toggle-arsenal');
        const arsenalBar = document.getElementById('arsenal-live-bar');
        const btnSaveArsenal = document.getElementById('btn-save-arsenal');

        if (btnArsenal && arsenalBar) {
            btnArsenal.addEventListener('click', () => arsenalBar.classList.toggle('hidden'));
        }

        if (btnSaveArsenal) {
            btnSaveArsenal.addEventListener('click', async () => {
                const tipo = document.getElementById('select-arsenal-type')?.value;
                const valor = document.getElementById('input-arsenal-val')?.value.trim();
                const desc = document.getElementById('input-arsenal-desc')?.value.trim();
                if (!valor) {
                    alert('[!] Introduce el comando o palabra clave.');
                    return;
                }
                btnSaveArsenal.disabled = true;
                btnSaveArsenal.textContent = 'ACTIVANDO...';
                try {
                    await window.C4ISR_API.agregarReglaArsenal(tipo, valor, desc);
                    alert(`[+] Regla "${valor}" activa en tiempo real para todos los exploradores.`);
                    document.getElementById('input-arsenal-val').value = '';
                    document.getElementById('input-arsenal-desc').value = '';
                    arsenalBar.classList.add('hidden');
                } catch (err) {
                    alert(`[!] Error al activar regla: ${err.message}`);
                } finally {
                    btnSaveArsenal.disabled = false;
                    btnSaveArsenal.textContent = 'ACTIVAR EN ENJAMBRE';
                }
            });
        }

        const filterUsers = (term) => {
            const todos = this.obtenerListaUnificada();
            if (!term) return todos;
            return todos.filter(u => {
                const matchName = String(u.username || '').toLowerCase().includes(term);
                const matchId = String(u.id || '').includes(term);
                const matchAliases = Array.isArray(u.historialAliases) &&
                    u.historialAliases.some(a => String(a).toLowerCase().includes(term));
                return matchName || matchId || matchAliases;
            });
        };

        if (searchInput) {
            searchInput.addEventListener('focus', () => {
                this.renderDropdownResults(filterUsers(searchInput.value.toLowerCase().trim()));
            });
            searchInput.addEventListener('input', (e) => {
                this.renderDropdownResults(filterUsers(e.target.value.toLowerCase().trim()));
            });
        }

        this.outsideClickListener = (e) => {
            if (searchWrapper && searchResults && !searchWrapper.contains(e.target)) {
                searchResults.classList.add('hidden');
            }
        };
        document.addEventListener('click', this.outsideClickListener);

        if (editor) {
            editor.addEventListener('input', () => {
                if (!this.currentTargetId) return;
                this.updateSaveStatus('saving');
                if (this.saveTimeout) clearTimeout(this.saveTimeout);
                this.saveTimeout = setTimeout(() => {
                    this.saveNotes(this.currentTargetId, editor.value);
                }, 850);
            });
        }

        if (btnAdd && manualBar) {
            btnAdd.addEventListener('click', () => {
                manualBar.classList.toggle('hidden');
                if (!manualBar.classList.contains('hidden') && inputManualUid) {
                    inputManualUid.focus();
                }
            });
        }

        if (btnCancelUid && manualBar) {
            btnCancelUid.addEventListener('click', () => {
                manualBar.classList.add('hidden');
                if (inputManualUid) inputManualUid.value = '';
            });
        }

        if (btnConfirmUid && inputManualUid) {
            btnConfirmUid.addEventListener('click', async () => {
                const uid = inputManualUid.value.trim();
                if (!/^\d{17,20}$/.test(uid)) {
                    alert('[!] Formato de UID inválido. Debe contener entre 17 y 20 dígitos numéricos.');
                    return;
                }
                btnConfirmUid.disabled = true;
                btnConfirmUid.textContent = 'INYECTANDO...';
                try {
                    await window.C4ISR_API.agregarObjetivoManual(uid);
                    window.C4ISR_TARGET_OVERRIDE = uid;
                    await window.AppController.navigate('expedientes');
                } catch (error) {
                    alert('[!] Error al registrar el UID en la base de datos.');
                    btnConfirmUid.disabled = false;
                    btnConfirmUid.textContent = 'REGISTRAR Y ESCANEAR APIS';
                }
            });
        }

        if (btnImport && fileInput) {
            btnImport.addEventListener('click', () => fileInput.click());
            fileInput.addEventListener('change', async (e) => {
                const archivo = e.target.files?.[0];
                if (!archivo) return;

                const originalText = btnImport.innerHTML;
                btnImport.innerHTML = 'IMPORTANDO...';
                btnImport.disabled = true;

                try {
                    const texto = await archivo.text();
                    const jsonParsed = JSON.parse(texto);
                    const matriz = Array.isArray(jsonParsed) ? jsonParsed : (jsonParsed.blacklist || jsonParsed.datos || []);
                    if (!Array.isArray(matriz) || matriz.length === 0) {
                        throw new Error('El archivo JSON no contiene un array de expedientes válido.');
                    }
                    await window.C4ISR_API.importarMatriz(matriz);
                    await window.AppController.navigate('expedientes');
                } catch (error) {
                    alert(`[!] Fallo al importar matriz: ${error.message}`);
                    btnImport.innerHTML = originalText;
                    btnImport.disabled = false;
                } finally {
                    fileInput.value = '';
                }
            });
        }
    },

    async ejecutarEscaneoExterno(userId) {
        const box = document.getElementById('external-intel-box');
        if (!box) return;
        box.classList.remove('hidden');
        box.innerHTML = `<div style="color:#00f0ff;">[ ESCANEANDO REDES EXTERNAS ] Consultando XN Protect, VPS 5604 (Squads & Keywords) y LC Guard para UID ${DOMPurify.sanitize(userId)}...</div>`;

        try {
            const intel = await window.C4ISR_API.consultarIntelExterna(userId);
            this.lastExternalIntel = intel;

            const xn = intel.xnProtect || {};
            const sq = intel.vpsSquads || {};
            const kw = intel.vpsKeywords || {};
            const lc = intel.lcGuard || {};

            let html = `<div style="width:100%;">`;
            html += `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem;border-bottom:var(--border-subtle);padding-bottom:0.4rem;">`;
            html += `<span style="color:#fcee0a;font-weight:700;">[ REPORTE DE INTELIGENCIA EXTERNA EN VIVO ]</span>`;
            html += `<button id="btn-inject-intel-notes" class="btn-action" type="button" style="font-size:0.7rem;padding:3px 8px;">VOLCAR AL DOSSIER DEL ANALISTA</button>`;
            html += `</div>`;

            // 1. XN Protect
            if (xn.baneado) {
                html += `<div style="color:#ff003c;margin-bottom:6px;">&#9679; <strong>XN PROTECT GLOBALBAN:</strong> POSITIVO &mdash; ${DOMPurify.sanitize(xn.razon)} ${xn.pruebaUrl ? `<a href="${DOMPurify.sanitize(xn.pruebaUrl)}" target="_blank" rel="noopener noreferrer" style="color:#00f0ff;margin-left:6px;">[ABRIR PRUEBA VISUAL]</a>` : ''}</div>`;
            } else {
                html += `<div style="color:#10b981;margin-bottom:4px;">&#9679; <strong>XN PROTECT GLOBALBAN:</strong> Limpio</div>`;
            }

            // 2. VPS 5604 Squad Banned Users
            if (sq.detectado && Array.isArray(sq.registros)) {
                html += `<div style="color:#ff003c;margin-bottom:4px;">&#9679; <strong>VPS 5604 SQUAD BANS (${sq.registros.length}):</strong></div>`;
                for (const r of sq.registros) {
                    html += `<div style="margin-left:14px;padding:4px 8px;border-left:2px solid #ff003c;background:rgba(255,0,60,0.08);margin-bottom:4px;font-size:0.72rem;">`;
                    html += `Servicio: <b>${DOMPurify.sanitize(r.servicio)}</b> | Fecha: ${DOMPurify.sanitize(r.fecha)} | Acción: <code>${DOMPurify.sanitize(r.actionId)}</code><br>`;
                    html += `Evidencia: ${DOMPurify.sanitize(r.razon)}`;
                    if (r.servidorExtraidoNombre) {
                        html += `<br><span style="color:#fcee0a;">&rarr; Servidor extraído e inyectado al Mapa Estelar: <b>${DOMPurify.sanitize(r.servidorExtraidoNombre)}</b> (${DOMPurify.sanitize(r.servidorExtraidoId)})</span>`;
                    }
                    html += `</div>`;
                }
            } else {
                html += `<div style="color:#10b981;margin-bottom:4px;">&#9679; <strong>VPS 5604 SQUAD BANS:</strong> Sin registros de comandos</div>`;
            }

            // 3. VPS 5604 Keywords
            if (kw.detectado) {
                html += `<div style="color:#fbbf24;margin-bottom:4px;">&#9679; <strong>VPS 5604 KEYWORDS:</strong> ${kw.registros.length} alerta(s) registrada(s)</div>`;
            }

            // 4. LC Guard
            if (lc.sancionado) {
                html += `<div style="color:#ff003c;">&#9679; <strong>LC GUARD SANCTIONS:</strong> SANCIONADO ACTIVO (${lc.detalles.length} registro(s))</div>`;
            } else {
                html += `<div style="color:#10b981;">&#9679; <strong>LC GUARD SANCTIONS:</strong> Sin sanciones activas</div>`;
            }

            html += `</div>`;
            box.innerHTML = html;

            const btnVolcar = document.getElementById('btn-inject-intel-notes');
            const editor = document.getElementById('osint-notes-editor');
            if (btnVolcar && editor) {
                btnVolcar.addEventListener('click', () => {
                    const bloqueTexto = `\n--- [INTEL EXTERNA ${new Date().toLocaleDateString('es-ES')}] ---\n` +
                        `XN Protect: ${xn.baneado ? `BANEADO (${xn.razon}) ${xn.pruebaUrl || ''}` : 'Limpio'}\n` +
                        `VPS 5604 Squads: ${sq.detectado ? sq.registros.map(r => `[${r.servicio}] ${r.razon}`).join(' | ') : 'Limpio'}\n` +
                        `LC Guard: ${lc.sancionado ? 'SANCIONADO' : 'Limpio'}\n`;
                    editor.value = (editor.value + bloqueTexto).trim();
                    this.saveNotes(this.currentTargetId, editor.value);
                    btnVolcar.textContent = '¡GUARDADO EN DOSSIER!';
                });
            }
        } catch (err) {
            box.innerHTML = `<div style="color:var(--accent-red);">[!] Error al consultar APIs externas: ${DOMPurify.sanitize(err.message)}</div>`;
        }
    },

    exportarDossierClasificadoHTML(user) {
        if (!user) return;
        const sf = decodificarSnowflake(user.id);
        const aliases = Array.isArray(user.historialAliases) && user.historialAliases.length > 0
            ? user.historialAliases.join(', ')
            : user.username;
        const historial = Array.isArray(user.historial) ? user.historial : [];

        const filasEventos = historial.map(h => `
            <div style="border-left:3px solid #ff2a6d;padding:10px 14px;margin-bottom:12px;background:#171420;border-radius:4px;">
                <div style="color:#ff2a6d;font-weight:bold;font-size:12px;">[${escaparSimple(h.casoId || 'CASO')}] ${escaparSimple(h.accion || 'Evento')} &bull; Servidor: ${escaparSimple(h.servidor || 'N/A')} &bull; ${escaparSimple(h.fecha || '')}</div>
                <pre style="white-space:pre-wrap;word-break:break-word;color:#e2e8f0;font-family:monospace;font-size:13px;margin-top:6px;">${escaparSimple(h.mensajeOriginal || '')}</pre>
            </div>
        `).join('');

        function escaparSimple(str) {
            return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        }

        const docHTML = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>DOSSIER CLASIFICADO C4ISR // UID ${escaparSimple(user.id)}</title>
<style>
    body { background:#09080c; color:#f1f5f9; font-family:'JetBrains Mono',Consolas,monospace; padding:30px; max-width:960px; margin:0 auto; }
    .header { border:1px solid #ff2a6d; border-left:6px solid #ff2a6d; padding:20px; background:#110f17; margin-bottom:24px; }
    .title { color:#ff2a6d; font-size:22px; font-weight:bold; letter-spacing:2px; }
    .grid { display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-top:14px; font-size:13px; }
    .section { background:#110f17; border:1px solid rgba(255,255,255,0.08); padding:18px; margin-bottom:20px; border-radius:6px; }
    .sec-title { color:#fcee0a; font-weight:bold; margin-bottom:10px; font-size:14px; }
</style>
</head>
<body>
    <div class="header">
        <div class="title">LA BIBLIOTECA // DOSSIER FORENSE CLASIFICADO</div>
        <div class="grid">
            <div><strong>OBJETIVO ACTUAL:</strong> ${escaparSimple(user.username)}</div>
            <div><strong>DISCORD UID:</strong> ${escaparSimple(user.id)}</div>
            <div><strong>CREACIÓN CUENTA:</strong> ${sf ? `${sf.fecha} (${sf.dias} días)` : 'N/A'}</div>
            <div><strong>HISTORIAL DE ALIAS:</strong> ${escaparSimple(aliases)}</div>
            <div><strong>NIVEL REINCIDENCIA:</strong> ${user.reincidencia || 0} infracciones</div>
            <div><strong>EMITIDO EL:</strong> ${new Date().toISOString()}</div>
        </div>
    </div>
    <div class="section">
        <div class="sec-title">[ NOTAS Y CONCLUSIONES DEL ANALISTA ]</div>
        <pre style="white-space:pre-wrap;color:#34d399;font-family:monospace;">${escaparSimple(user.notas || 'Sin notas manuales registradas.')}</pre>
    </div>
    <div class="section">
        <div class="sec-title">[ HISTORIAL INMUTABLE DE EVIDENCIAS INTERCEPTADAS (${historial.length}) ]</div>
        ${filasEventos || 'Sin eventos registrados.'}
    </div>
</body>
</html>`;

        const blob = new Blob([docHTML], { type: 'text/html;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `DOSSIER_C4ISR_${user.id}.html`;
        document.body.appendChild(a);
        a.click();
        URL.revokeObjectURL(url);
        a.remove();
    },

    loadTargetWorkspace(targetId) {
        this.currentTargetId = String(targetId);
        this.lastExternalIntel = null;
        const workspace = document.getElementById('osint-workspace');
        const metaStrip = document.getElementById('osint-meta-strip');
        const intelBox = document.getElementById('external-intel-box');
        const rawLogsContainer = document.getElementById('osint-raw-logs');
        const editor = document.getElementById('osint-notes-editor');
        const badge = document.getElementById('osint-target-badge');

        if (intelBox) intelBox.classList.add('hidden');
        if (!workspace || !rawLogsContainer || !editor || !badge) return;

        const lista = this.obtenerListaUnificada();
        const user = lista.find(u => String(u.id) === this.currentTargetId);

        if (!user) {
            workspace.classList.add('hidden');
            if (metaStrip) metaStrip.classList.add('hidden');
            return;
        }

        workspace.classList.remove('hidden');
        this.updateSaveStatus('loaded');
        editor.value = user.notas || '';

        const usernameSeguro = DOMPurify.sanitize(String(user.username || 'Identidad Desconocida'));
        const idSeguro = DOMPurify.sanitize(String(user.id));
        badge.textContent = `${usernameSeguro} (${idSeguro})`;

        if (metaStrip) {
            const sf = decodificarSnowflake(user.id);
            const sfHtml = sf
                ? `<span style="color:${sf.esBurner ? 'var(--accent-red)' : 'var(--accent-green)'};font-weight:700;">${sf.fecha} (${sf.dias}d) ${sf.esBurner ? '[BURNER]' : ''}</span>`
                : 'Desconocida';

            const aliasesList = Array.isArray(user.historialAliases) && user.historialAliases.length > 0
                ? user.historialAliases.map(a => DOMPurify.sanitize(String(a))).join(' &rarr; ')
                : usernameSeguro;

            metaStrip.innerHTML = `
                <div style="display:flex;flex-wrap:wrap;gap:0.8rem;align-items:center;width:100%;justify-content:space-between;">
                    <div>
                        <span style="color:var(--text-muted);">CUENTA:</span> ${sfHtml} &nbsp;|&nbsp;
                        <span style="color:var(--text-muted);">ALIAS:</span> <strong style="color:var(--accent-amber);">${aliasesList}</strong>
                    </div>
                    <div style="display:flex;gap:0.45rem;flex-wrap:wrap;">
                        <button id="btn-scan-ext-apis" class="btn-action" type="button" style="border-color:#00f0ff;color:#00f0ff;">&#128269; CONSULTAR APIS (XN / VPS / LC)</button>
                        <button id="btn-export-dossier-html" class="btn-export" type="button">&#128190; DESCARGAR DOSSIER (.HTML)</button>
                        <button id="btn-exp-watchlist" class="btn-action" type="button" style="border-color:#fbbf24;color:#fbbf24;">&#9733; VIP</button>
                    </div>
                </div>
            `;
            metaStrip.classList.remove('hidden');

            const btnScan = document.getElementById('btn-scan-ext-apis');
            if (btnScan) {
                btnScan.addEventListener('click', () => this.ejecutarEscaneoExterno(user.id));
            }

            const btnDossierHtml = document.getElementById('btn-export-dossier-html');
            if (btnDossierHtml) {
                btnDossierHtml.addEventListener('click', () => this.exportarDossierClasificadoHTML(user));
            }

            const btnVip = document.getElementById('btn-exp-watchlist');
            if (btnVip) {
                btnVip.addEventListener('click', async () => {
                    try {
                        const res = await window.C4ISR_API.toggleWatchlistUsuario(String(user.id));
                        btnVip.textContent = res.enWatchlist ? '★ VIP ACTIVO' : '☆ VIP OFF';
                    } catch (_) {}
                });
            }
        }

        const historial = Array.isArray(user.historial) && user.historial.length > 0
            ? [...user.historial].reverse()
            : [{
                fecha: user.fecha,
                accion: 'Registro Base',
                casoId: 'N/A',
                servidor: user.servidor || 'N/A',
                mensajeOriginal: user.evidencia || '[ SIN REGISTROS ACTIVOS ]'
            }];

        rawLogsContainer.innerHTML = historial.map((evento) => {
            const accion = DOMPurify.sanitize(String(evento.accion || 'Evento'));
            const casoId = DOMPurify.sanitize(String(evento.casoId || 'N/A'));
            const servidor = DOMPurify.sanitize(String(evento.servidor || 'Sector Desconocido'));
            const fecha = formatearFechaCorta(evento.fecha);
            const evidencia = DOMPurify.sanitize(String(evento.mensajeOriginal || ''));

            return `
                <div style="margin-bottom: 1rem; padding-bottom: 1rem; border-bottom: var(--border-subtle);">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.4rem; flex-wrap: wrap; gap: 0.4rem; font-family: var(--font-mono); font-size: 0.73rem;">
                        <span style="color: var(--accent-rz); font-weight: 700;">[${casoId}] ${accion}</span>
                        <span style="color: var(--text-muted);">&#11042; ${servidor} &bull; ${fecha}</span>
                    </div>
                    <div class="discord-mock">
                        <div class="discord-mock-content">
                            <div class="discord-mock-body">${evidencia}</div>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    },

    async saveNotes(targetId, notesContent) {
        try {
            await window.C4ISR_API.guardarNota(targetId, notesContent);
            this.updateSaveStatus('saved');
            const lista = this.obtenerListaUnificada();
            const user = lista.find(u => String(u.id) === String(targetId));
            if (user) user.notas = notesContent;
        } catch (error) {
            this.updateSaveStatus('error');
        }
    },

    updateSaveStatus(state) {
        const statusEl = document.getElementById('osint-save-status');
        if (!statusEl) return;

        switch (state) {
            case 'saving':
                statusEl.textContent = 'GUARDANDO...';
                statusEl.className = 'badge badge-amber';
                break;
            case 'saved':
                statusEl.textContent = 'SINCRONIZADO';
                statusEl.className = 'badge badge-green';
                break;
            case 'error':
                statusEl.textContent = 'ERROR DE RED';
                statusEl.className = 'badge badge-red';
                break;
            case 'loaded':
                statusEl.textContent = 'LISTO';
                statusEl.className = 'badge badge-green';
                break;
        }
    },

    destroy() {
        if (this.saveTimeout) clearTimeout(this.saveTimeout);
        if (this.outsideClickListener) {
            document.removeEventListener('click', this.outsideClickListener);
            this.outsideClickListener = null;
        }
        this.currentTargetId = null;
        this.globalData = null;
    }
};
