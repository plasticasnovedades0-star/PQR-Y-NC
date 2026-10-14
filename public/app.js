/* Gestión NC - Producto No Conforme */
'use strict';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const app = $('#app');

let MODULE = 'nc';
const tokenKey = (m) => (m === 'pqr' ? 'pqr_token' : 'nc_token');
let TOKEN = localStorage.getItem('nc_token') || '';
let USER = null;
let META = { tipos: [], areas: [], turnos: [], estados: ['ABIERTO', 'EN PROCESO', 'CERRADO'], max_photos: 10 };
let charts = [];

function setToken(t, m = MODULE) {
  TOKEN = t;
  if (t) localStorage.setItem(tokenKey(m), t);
  else localStorage.removeItem(tokenKey(m));
}
function loadToken(m = MODULE) {
  TOKEN = localStorage.getItem(tokenKey(m)) || '';
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function toast(msg, type = 'ok') {
  const d = document.createElement('div');
  d.className = 'toast ' + type;
  d.textContent = msg;
  $('#toasts').appendChild(d);
  setTimeout(() => d.remove(), 4200);
}
function fmtFecha(iso) {
  if (!iso) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}
function hoyISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function badgeEstado(e) {
  const cls = e === 'CERRADO' ? 'CERRADO' : e === 'EN PROCESO' ? 'PROCESO' : 'ABIERTO';
  return `<span class="badge ${cls}">${esc(e)}</span>`;
}
function collapse(s, n = 90) {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? esc(t.slice(0, n)) + '…' : esc(t || '—');
}

async function api(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (TOKEN) headers.Authorization = 'Bearer ' + TOKEN;
  if (opts.body && !(opts.body instanceof FormData) && typeof opts.body !== 'string') {
    headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(opts.body);
  }
  const res = await fetch(path, { ...opts, headers, credentials: 'same-origin' });
  if (res.status === 401) {
    setToken(''); USER = null;
    location.hash = MODULE === 'pqr' ? '#/pqr' : '#/login';
    throw new Error('Sesión expirada. Inicie sesión de nuevo.');
  }
  if (opts.raw) {
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Error ' + res.status);
    return res.blob();
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Error ' + res.status);
  return data;
}

/* ============ PORTADA (elegir módulo) ============ */
function renderHome() {
  app.innerHTML = `
  <div class="home-wrap">
    <div class="home-box">
      <div class="logo-lg">NC</div>
      <h1>Seleccione un módulo</h1>
      <p class="sub">Gestión de planta · Elemental</p>
      <div class="home-btns">
        <a class="home-btn pqr" href="#/pqr">
          <span class="hb-ico">📋</span>
          <span class="hb-t">PQR</span>
          <span class="hb-s">Peticiones, quejas y reclamos de clientes</span>
        </a>
        <a class="home-btn nc" href="#/login">
          <span class="hb-ico">⚠️</span>
          <span class="hb-t">NC</span>
          <span class="hb-s">Producto no conforme · Novedades</span>
        </a>
      </div>
    </div>
  </div>`;
}

function renderPqrApp() {
  const esG = USER && USER.role === 'gestion';
  app.innerHTML = `
  <div class="home-wrap">
    <div class="home-box">
      <div class="logo-lg pqr">PQR</div>
      <h1>Gestión de PQR</h1>
      <p class="sub">Peticiones, quejas y reclamos de clientes</p>
      <div class="warn" style="text-align:left">
        Módulo en construcción. Aquí se registrarán y darán seguimiento a las quejas y reclamos
        de los clientes finales.
      </div>
      <div class="card" style="text-align:left;margin-top:12px">
        <div class="muted small">Sesión iniciada</div>
        <div><b>${esc(USER.name || USER.username)}</b> · @${esc(USER.username)} · ${esG ? 'Gestión' : 'Reporte'}</div>
        ${USER.operator ? `<div class="muted small">👤 ${esc(USER.operator)}</div>` : ''}
      </div>
      <a class="btn block secondary" href="#/">← Volver a módulos</a>
      <button class="btn ghost block" id="pqr-out" type="button">Cerrar sesión</button>
    </div>
  </div>`;
  $('#pqr-out').onclick = async () => {
    try { await api('/api/auth/logout', { method: 'POST' }); } catch {}
    setToken(''); USER = null;
    location.hash = '#/'; route();
  };
}

/* ============ LOGIN ============ */
async function renderLogin(opts = {}) {
  const appMod = opts.app === 'pqr' ? 'pqr' : 'nc';
  MODULE = appMod;
  const dest = appMod === 'pqr' ? '#/pqr' : '#/novedades';
  const esPqr = appMod === 'pqr';
  const logo = esPqr ? 'PQR' : 'NC';
  const titulo = esPqr ? 'Gestión de PQR' : 'Gestión de Producto No Conforme';
  const subtitulo = esPqr ? 'Peticiones, quejas y reclamos de clientes' : 'Novedades · Trazabilidad · Indicadores';
  app.innerHTML = `
  <div class="login-wrap"><div class="login-box"><div class="muted">Cargando usuarios…</div></div></div>`;
  let acc = { login_mode: 'password', users: [] };
  try { acc = await api('/api/auth/access?app=' + appMod); } catch { /* sin conexión */ }

  const roleTag = (u) => (u.role === 'gestion' ? 'Gestión' : 'Reporte');

  const finishLogin = async (r) => {
    setToken(r.token);
    USER = r.user;
    if (r.user && r.user.operator) localStorage.setItem('nc_operator', r.user.operator);
    if (appMod === 'nc') META = await api('/api/reports/meta');
    toast('Bienvenido, ' + (r.user.operator || r.user.name || r.user.username));
    location.hash = dest;
    route();
  };

  const TIPOS = [
    { key: 'reporte', label: 'Reporte', desc: 'Registra novedades' },
    { key: 'gestion', label: 'Gestión', desc: 'Aprueba, administra y ve indicadores' },
  ];
  const etiqueta = (t) => (t === 'gestion' ? 'Gestión' : 'Reporte');

  const showTypes = () => {
    app.innerHTML = `
    <div class="login-wrap">
      <div class="login-box">
        <div class="logo-lg${esPqr ? ' pqr' : ''}">${logo}</div>
        <h1>${titulo}</h1>
        <p class="sub">${subtitulo}</p>
        <p class="pick-label">Seleccione el tipo de usuario</p>
        <div class="user-pick">
          ${TIPOS.map((t) => {
            const n = acc.users.filter((u) => u.role === t.key).length;
            return `
            <button type="button" class="user-card" data-tipo="${t.key}">
              <span class="uc-av">${t.key === 'gestion' ? 'G' : 'R'}</span>
              <span class="uc-n">${t.label}</span>
              <span class="uc-r">${n} usuario${n === 1 ? '' : 's'} · ${t.desc}</span>
            </button>`;
          }).join('')}
        </div>
        <a class="btn ghost block" href="#/">← Volver a módulos</a>
      </div>
    </div>`;
    $$('.user-card[data-tipo]').forEach((b) => b.onclick = () => showUsers(b.dataset.tipo));
  };

  const showUsers = (tipo) => {
    const label = etiqueta(tipo);
    const lista = acc.users.filter((u) => u.role === tipo);
    app.innerHTML = `
    <div class="login-wrap">
      <div class="login-box">
        <div class="logo-lg${esPqr ? ' pqr' : ''}">${tipo === 'gestion' ? 'G' : 'R'}</div>
        <h1>Usuarios de ${label}</h1>
        <p class="sub">${lista.length} registrado${lista.length === 1 ? '' : 's'} con este tipo</p>
        <div class="user-pick">
          ${lista.map((u) => `
            <button type="button" class="user-card" data-user="${esc(u.username)}">
              <span class="uc-av">${esc((u.full_name || u.username).trim().charAt(0).toUpperCase())}</span>
              <span class="uc-n">${esc(u.full_name || u.username)}</span>
              <span class="uc-r">@${esc(u.username)}</span>
            </button>`).join('')}
          <button type="button" class="user-card" data-reg="${tipo}">
            <span class="uc-av">＋</span>
            <span class="uc-n">Crear usuario de ${label}</span>
            <span class="uc-r">Registrarse</span>
          </button>
        </div>
        ${lista.length ? '' : `<div class="warn" style="margin-bottom:12px">Todavía no hay usuarios de tipo ${label}. Cree el primero con «Crear usuario de ${label}».</div>`}
        <button class="btn ghost block" id="uc-back" type="button">← Cambiar de tipo</button>
        <a class="btn ghost block" href="#/">← Volver a módulos</a>
      </div>
    </div>`;

    $('#uc-back').onclick = showTypes;
    $$('.user-card[data-reg]').forEach((b) => b.onclick = () => showRegister(b.dataset.reg));
    $$('.user-card[data-user]').forEach((b) => b.onclick = async () => {
      const u = acc.users.find((x) => x.username === b.dataset.user);
      if (acc.login_mode === 'usuarios') {
        b.disabled = true;
        try { finishLogin(await api('/api/auth/login', { method: 'POST', body: { username: b.dataset.user } })); }
        catch (err) { toast(err.message, 'err'); b.disabled = false; }
        return;
      }
      showCredentials(u);
    });
  };

  const showCredentials = (u) => {
    app.innerHTML = `
    <div class="login-wrap">
      <div class="login-box">
        <div class="logo-lg${esPqr ? ' pqr' : ''}">${logo}</div>
        <h1>${esc(u.full_name || u.username)}</h1>
        <p class="sub">${roleTag(u)} · @${esc(u.username)}</p>
        <form id="login-form">
          <label class="field"><span>Su nombre (quien opera) <b class="req">*</b></span>
            <input type="text" id="lg-name" autocomplete="name" autocapitalize="words"
              value="${esc(localStorage.getItem('nc_operator') || '')}"
              placeholder="Nombre y apellido" required autofocus />
          </label>
          <label class="field"><span>Contraseña <b class="req">*</b></span>
            <input type="password" id="lg-pass" autocomplete="current-password" required />
          </label>
          <button class="btn block" type="submit">Ingresar</button>
        </form>
        <button class="btn ghost block" id="lg-back" type="button">← Cambiar de usuario</button>
        <a class="btn ghost block" href="#/">← Volver a módulos</a>
      </div>
    </div>`;

    $('#lg-back').onclick = () => showUsers(u.role);
    $('#login-form').onsubmit = async (e) => {
      e.preventDefault();
      const name = $('#lg-name').value.trim();
      if (!name) { toast('Escriba su nombre', 'err'); $('#lg-name').focus(); return; }
      try {
        const r = await api('/api/auth/login', {
          method: 'POST',
          body: { username: u.username, password: $('#lg-pass').value, operator: name, app: appMod },
        });
        await finishLogin(r);
      } catch (err) { toast(err.message, 'err'); }
    };
  };

  const showRegister = (tipo) => {
    const esG = tipo === 'gestion';
    const etiqueta = esG ? 'Gestión' : 'Reporte';
    app.innerHTML = `
    <div class="login-wrap">
      <div class="login-box">
        <div class="logo-lg">＋</div>
        <h1>Registro de usuario</h1>
        <p class="sub">Tipo de usuario: <b>${etiqueta}</b></p>
        <div class="badge ${esG ? 'CERRADO' : 'PROCESO'}" style="margin-bottom:12px">${etiqueta.toUpperCase()}</div>
        <form id="reg-form">
          <label class="field"><span>Nombre completo <b class="req">*</b></span>
            <input type="text" id="rg-name" autocomplete="name" autocapitalize="words"
              value="${esc(localStorage.getItem('nc_operator') || '')}"
              placeholder="Nombre y apellido" required autofocus /></label>
          <label class="field"><span>Usuario (para ingresar) <b class="req">*</b></span>
            <input type="text" id="rg-user" autocomplete="username" autocapitalize="off"
              spellcheck="false" placeholder="ej. jperez" required /></label>
          <label class="field"><span>Contraseña <b class="req">*</b></span>
            <input type="password" id="rg-pass" autocomplete="new-password" minlength="6" required /></label>
          <label class="field"><span>Confirmar contraseña <b class="req">*</b></span>
            <input type="password" id="rg-pass2" autocomplete="new-password" minlength="6" required /></label>
          <div class="warn" style="margin:4px 0 12px">
            La cuenta quedará <b>pendiente</b>: un usuario de Gestión activo debe aprobarla antes de poder ingresar.
          </div>
          <button class="btn block" type="submit">Crear cuenta de ${etiqueta}</button>
        </form>
        <button class="btn ghost block" id="rg-back" type="button">← Volver</button>
      </div>
    </div>`;

    $('#rg-back').onclick = () => showUsers(tipo);
    $('#reg-form').onsubmit = async (e) => {
      e.preventDefault();
      const name = $('#rg-name').value.trim();
      const user = $('#rg-user').value.trim();
      const pass = $('#rg-pass').value;
      const pass2 = $('#rg-pass2').value;
      if (name.length < 3) { toast('Escriba su nombre completo', 'err'); $('#rg-name').focus(); return; }
      if (!/^[a-zA-Z0-9._-]{3,20}$/.test(user)) {
        toast('Usuario: 3-20 caracteres (letras, números, . _ -)', 'err'); $('#rg-user').focus(); return;
      }
      if (pass.length < 6) { toast('La contraseña debe tener al menos 6 caracteres', 'err'); $('#rg-pass').focus(); return; }
      if (pass !== pass2) { toast('Las contraseñas no coinciden', 'err'); $('#rg-pass2').focus(); return; }
      try {
        const r = await api('/api/auth/register', {
          method: 'POST',
          body: { username: user, password: pass, confirm: pass2, full_name: name, role: tipo, app: appMod },
        });
        localStorage.setItem('nc_operator', name);
        toast(r.mensaje || 'Cuenta creada. Pendiente de aprobación.', 'info');
        try { acc = await api('/api/auth/access?app=' + appMod); } catch { /* sin conexión */ }
        showUsers(tipo);
      } catch (err) { toast(err.message, 'err'); }
    };
  };

  showTypes();
}

/* ============ SHELL ============ */
function shell(content, active) {
  const isG = USER && USER.role === 'gestion';
  const nav = [
    ['#/dashboard', 'dashboard', '', 'Indicadores'],
    ['#/novedades', 'novedades', '', 'Novedades'],
    isG ? ['#/gestion', 'gestion', '', 'Gestión'] : ['#/usuarios', 'usuarios', '', 'Usuarios'],
  ].filter(Boolean);
  app.innerHTML = `
  <div class="layout">
    <aside class="sidebar">
      <a class="brand" href="#/" title="Elegir módulo"><div class="logo">NC</div><div>Gestión NC</div></a>
      <nav>
        ${nav.map(([h, k, i, t]) => `<a href="${h}" class="${active === k ? 'active' : ''}"><span>${i}</span> ${t}</a>`).join('')}
      </nav>
      <div class="userbox">
        <div class="name">${esc(USER.name || USER.username)}</div>
        <div class="role">${USER.role === 'gestion' ? 'Gestión' : 'Reporte'} · @${esc(USER.username)}</div>
        ${USER.operator ? `<div class="op">👤 ${esc(USER.operator)}</div>` : ''}
        <button class="btn sm secondary" id="btn-pass">Cambiar contraseña</button>
        <button class="btn sm ghost" id="btn-logout" style="color:#cfe0ef;border-color:rgba(255,255,255,.3);margin-top:6px">Salir</button>
      </div>
    </aside>
    <main class="main">${content}</main>
  </div>`;
  $('#btn-logout').onclick = async () => {
    try { await api('/api/auth/logout', { method: 'POST' }); } catch {}
    setToken(''); USER = null;
    location.hash = '#/'; route();
  };
  $('#btn-pass').onclick = modalChangePassword;
}

/* ============ DASHBOARD ============ */
async function renderDashboard() {
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const desde = params.get('desde') || '';
  const hasta = params.get('hasta') || '';
  let html = `
  <div class="page-title">
    <div><h1>Indicadores</h1><div class="sub">Toda la información de novedades de producto no conforme</div></div>
    <div class="row-flex">
      <label class="field"><span>Desde</span><input type="date" id="f-desde" value="${esc(desde)}" /></label>
      <label class="field"><span>Hasta</span><input type="date" id="f-hasta" value="${esc(hasta)}" /></label>
      <button class="btn" id="f-aplicar" style="margin-bottom:2px">Aplicar</button>
      <button class="btn success" id="btn-export-dash" style="margin-bottom:2px">⬇ Excel con fotos</button>
    </div>
  </div>
  <div class="kpis" id="kpis"></div>
  <div class="charts">
    <div class="card chart-card"><h3>Estado de las salidas no conformes</h3><div class="chart-box"><canvas id="ch-estado"></canvas></div></div>
    <div class="card chart-card"><h3>Novedades por tipo de hallazgo</h3><div class="chart-box"><canvas id="ch-tipo"></canvas></div></div>
    <div class="card chart-card"><h3>Novedades por área</h3><div class="chart-box"><canvas id="ch-area"></canvas></div></div>
    <div class="card chart-card"><h3>Evolución mensual</h3><div class="chart-box"><canvas id="ch-mes"></canvas></div></div>
    <div class="card chart-card"><h3>Top operarios con más hallazgos</h3><div class="chart-box"><canvas id="ch-operarios"></canvas></div></div>
    <div class="card chart-card"><h3>Novedades por turno</h3><div class="chart-box"><canvas id="ch-turno"></canvas></div></div>
  </div>
  <div class="card" id="card-unidades">
    <h3 class="section" style="margin-top:0">Unidades implicadas vs unidades terminadas (órdenes padre de Elemental)</h3>
    <p class="muted small">Compara las unidades de las novedades con las unidades terminadas de las órdenes de fabricación padre, mes por mes. Fuente: solo consulta a Elemental Web.</p>
    <div class="row-flex">
      <label class="field"><span>Producto / referencia</span>
        <select id="u-ref">
          <option value="">Todos los productos</option>
        </select></label>
      <button class="btn secondary" id="u-aplicar" style="margin-bottom:2px">Ver</button>
    </div>
    <div id="u-nota" class="muted small"></div>
    <div id="u-tabla" class="mt"></div>
    <div class="chart-box" style="height:260px;margin-top:14px"><canvas id="ch-unidades"></canvas></div>
  </div>`;
  shell(html, 'dashboard');
  charts.forEach((c) => c.destroy()); charts = [];
  $('#u-aplicar').onclick = () => loadUnidades(desde || '2026-01-01', hasta, $('#u-ref').value);
  loadUnidades(desde || '2026-01-01', hasta).catch(() => {});
  $('#f-aplicar').onclick = () => {
    const q = new URLSearchParams();
    if ($('#f-desde').value) q.set('desde', $('#f-desde').value);
    if ($('#f-hasta').value) q.set('hasta', $('#f-hasta').value);
    location.hash = '#/dashboard' + (q.toString() ? '?' + q.toString() : '');
    route();
  };
  $('#btn-export-dash').onclick = () => exportExcel(qsFromHash());

  const ind = await api('/api/indicators?' + qsFromHash());
  const r = ind.resumen;
  $('#kpis').innerHTML = `
    <div class="kpi"><div class="v">${r.total}</div><div class="l">Total novedades</div></div>
    <div class="kpi red"><div class="v">${r.abiertas}</div><div class="l">Abiertas</div></div>
    <div class="kpi amber"><div class="v">${r.en_proceso}</div><div class="l">En proceso</div></div>
    <div class="kpi green"><div class="v">${r.cerradas}</div><div class="l">Cerradas</div></div>
    <div class="kpi green"><div class="v">${r.pct_cierre}%</div><div class="l">% de cierre</div></div>
    <div class="kpi"><div class="v">${r.unidades}</div><div class="l">Unidades implicadas</div></div>
    <div class="kpi"><div class="v">${r.prom_dias_cierre ?? '—'}</div><div class="l">Prom. días a cierre</div></div>
    <div class="kpi"><div class="v">${r.total_fotos}</div><div class="l">Evidencias (fotos)</div></div>`;

  const COLORS = ['#d64545', '#e8a13a', '#2e9e5b', '#2e75b6', '#8e5bbf', '#5a9bb5', '#c97b4a', '#6b8e23'];
  const mk = (id, type, labels, data, opts = {}) => {
    const c = $('#' + id); if (!c) return;
    charts.push(new Chart(c, {
      type,
      data: {
        labels,
        datasets: [{ label: opts.label || 'Novedades', data, backgroundColor: opts.bg || COLORS.slice(0, labels.length), borderColor: opts.border, borderWidth: opts.borderWidth || 0 }],
      },
      options: {
        responsive: true, maintainAspectRatio: false, indexAxis: opts.indexAxis,
        plugins: { legend: { display: !!opts.legend, position: 'bottom' } },
        scales: opts.noScales ? {} : { y: { beginAtZero: true, ticks: { precision: 0 } } },
      },
    }));
  };
  mk('ch-estado', 'doughnut', ind.por_estado.map((x) => x.estado), ind.por_estado.map((x) => x.total), {
    legend: true, noScales: true,
    bg: ['#d64545', '#2e9e5b', '#e8a13a'],
  });
  mk('ch-tipo', 'bar', ind.por_tipo.map((x) => x.label), ind.por_tipo.map((x) => x.total), { indexAxis: 'y', border: '#1f4e79', bg: '#2e75b6' });
  mk('ch-area', 'bar', ind.por_area.map((x) => x.label), ind.por_area.map((x) => x.total), { border: '#1f4e79', bg: '#2e75b6' });
  mk('ch-mes', 'line', ind.por_mes.map((x) => x.label), ind.por_mes.map((x) => x.total), { border: '#1f4e79', bg: 'rgba(46,117,182,.25)', borderWidth: 2 });
  mk('ch-operarios', 'bar',
    ind.top_operarios.map((x) => `${x.codigo} ${x.nombre || ''}`.trim()),
    ind.top_operarios.map((x) => x.total), { indexAxis: 'y', border: '#b42318', bg: '#d64545' });
  mk('ch-turno', 'bar', ind.por_turno.map((x) => x.label), ind.por_turno.map((x) => x.total), { border: '#1f4e79', bg: '#8e5bbf' });
}

function qsFromHash() {
  return location.hash.split('?')[1] || '';
}

async function loadUnidades(desde, hasta, ref) {
  const tabla = $('#u-tabla');
  const nota = $('#u-nota');
  if (!tabla) return;
  if (!$('#u-ref').options.length || $('#u-ref').options.length === 1) {
    try {
      const rr = await api('/api/indicators/unidades/referencias');
      const sel = $('#u-ref');
      rr.items.forEach((x) => {
        const o = document.createElement('option');
        o.value = x.referencia;
        o.textContent = `${x.referencia} (${x.unidades} u. en novedades)`;
        sel.appendChild(o);
      });
      if (ref) sel.value = ref;
    } catch { /* sin catálogo */ }
  }
  tabla.innerHTML = '<div class="muted small">Consultando Elemental…</div>';
  try {
    const q = new URLSearchParams();
    if (desde) q.set('desde', desde);
    if (hasta) q.set('hasta', hasta);
    if (ref) q.set('referencia', ref);
    const u = await api('/api/indicators/unidades' + (q.toString() ? '?' + q.toString() : ''));

    const t = u.totales;
    nota.innerHTML = `
      <div class="kpi" style="margin:6px 0">
        <div class="v">${t.pct == null ? '—' : t.pct + '%'}</div>
        <div class="l">Unidades implicadas sobre unidades terminadas (${ref ? 'ref ' + esc(ref) : 'total'})</div>
      </div>
      <div>Implicadas: <b>${t.unidades_implicadas}</b> · Terminadas (órdenes padre): <b>${Math.round(t.unidades_terminadas)}</b></div>
      ${u.nota ? `<div class="mt">Cobertura: ${u.nota.ordenes_padres} órdenes padre · ${u.nota.catalogo_productos} productos en catálogo · ${u.nota.ofs_sin_producto_identificado} órdenes sin producto identificado · ${u.nota.ofs_terminadas_sin_fecha_inicio} sin fecha de inicio.</div>` : ''}`;

    if (!u.filas.length) {
      tabla.innerHTML = '<div class="warn">No hay datos para ese rango.</div>';
      return;
    }
    tabla.innerHTML = `
      <div class="table-wrap"><table class="data card-rows">
        <thead><tr><th>Mes</th><th>Novedades</th><th>Unidades implicadas</th><th>Unidades terminadas (padre)</th><th>% implicadas / terminadas</th></tr></thead>
        <tbody>${u.filas.map((f) => `
          <tr>
            <td data-label="Mes" class="nowrap">${esc(f.mes)}</td>
            <td data-label="Novedades">${f.reportes}</td>
            <td data-label="Unidades implicadas">${f.unidades_implicadas}</td>
            <td data-label="Unidades terminadas">${Math.round(f.unidades_terminadas)}</td>
            <td data-label="% implicadas / terminadas">${f.pct == null ? '—' : f.pct + '%'}</td>
          </tr>`).join('')}</tbody>
      </table></div>`;

    const canvasU = $('#ch-unidades');
    if (canvasU._chart) { canvasU._chart.destroy(); canvasU._chart = null; }
    const chartU = new Chart(canvasU, {
      type: 'bar',
      data: {
        labels: u.filas.map((f) => f.mes).reverse(),
        datasets: [
          { label: 'Unidades implicadas (novedades)', data: u.filas.map((f) => f.unidades_implicadas).reverse(), backgroundColor: '#d64545' },
          { label: 'Unidades terminadas (órdenes padre)', data: u.filas.map((f) => Math.round(f.unidades_terminadas)).reverse(), backgroundColor: '#2e75b6' },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom' } },
        scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
      },
    });
    canvasU._chart = chartU;
    charts.push(chartU);
  } catch (e) {
    tabla.innerHTML = `<div class="warn">${esc(e.message)}</div>`;
  }
}

/* ============ EXPORT ============ */
async function exportExcel(qs) {
  try {
    toast('Generando Excel con evidencias…', 'info');
    const blob = await api('/api/export/excel' + (qs ? '?' + qs : ''), { raw: true });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'Novedades_NC_' + hoyISO() + '.xlsx';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast('Excel descargado. Guárdalo en tu PC o OneDrive.');
  } catch (e) { toast(e.message, 'err'); }
}

/* ============ LISTA ============ */
let listState = { offset: 0, limit: 100, filters: {} };

async function renderList() {
  const p = new URLSearchParams(location.hash.split('?')[1] || '');
  listState.filters = {
    estado: p.get('estado') || '', tipo: p.get('tipo') || '', area: p.get('area') || '',
    desde: p.get('desde') || '', hasta: p.get('hasta') || '', q: p.get('q') || '',
    orden: p.get('orden') || '',
  };
  const f = listState.filters;
  const html = `
  <div class="page-title">
    <div><h1>Novedades</h1><div class="sub">Registro y trazabilidad de producto no conforme</div></div>
    <div class="row-flex">
      <button class="btn success" id="btn-export">⬇ Exportar Excel (con fotos)</button>
      <a class="btn" href="#/novedades/nueva">+ Nueva novedad</a>
    </div>
  </div>
  <div class="card">
    <div class="filters">
      <label class="field"><span>Estado</span><select id="fl-estado">
        <option value="">Todos</option>
        ${META.estados.map((e) => `<option ${f.estado === e ? 'selected' : ''}>${e}</option>`).join('')}
      </select></label>
      <label class="field"><span>Tipo</span><select id="fl-tipo">
        <option value="">Todos</option>
        ${META.tipos.map((t) => `<option ${f.tipo === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}
      </select></label>
      <label class="field"><span>Área</span><select id="fl-area">
        <option value="">Todas</option>
        ${META.areas.map((a) => `<option ${f.area === a ? 'selected' : ''}>${esc(a)}</option>`).join('')}
      </select></label>
      <label class="field"><span>Desde</span><input type="date" id="fl-desde" value="${esc(f.desde)}" /></label>
      <label class="field"><span>Hasta</span><input type="date" id="fl-hasta" value="${esc(f.hasta)}" /></label>
      <label class="field search"><span>Buscar (desc., referencia, operario…)</span><input type="search" id="fl-q" value="${esc(f.q)}" placeholder="texto libre" /></label>
      <label class="field"><span>N.° OF</span><input type="text" id="fl-orden" value="${esc(f.orden)}" placeholder="orden fabricación" /></label>
      <button class="btn secondary" id="fl-go">Filtrar</button>
      <button class="btn ghost" id="fl-clear">Limpiar</button>
    </div>
    <div class="table-wrap">
      <table class="data card-rows">
        <thead><tr>
          <th>ID</th><th>Fecha</th><th>Área</th><th>Tipo</th><th>Descripción</th><th>Ref. (Producto)</th>
          <th>N.° OF</th><th>Operario(s)</th><th>Und.</th><th>Estado</th><th>Fotos</th><th></th>
        </tr></thead>
        <tbody id="lst-body"><tr><td colspan="12" class="center muted">Cargando…</td></tr></tbody>
      </table>
    </div>
    <div class="pagination" id="lst-pagination"></div>
  </div>`;
  shell(html, 'novedades');

  const buildQs = () => {
    const q = new URLSearchParams();
    [['estado', 'fl-estado'], ['tipo', 'fl-tipo'], ['area', 'fl-area'], ['desde', 'fl-desde'], ['hasta', 'fl-hasta'], ['q', 'fl-q'], ['orden', 'fl-orden']]
      .forEach(([k, id]) => { const v = $('#' + id).value.trim(); if (v) q.set(k, v); });
    return q.toString();
  };
  $('#fl-go').onclick = () => { location.hash = '#/novedades' + (buildQs() ? '?' + buildQs() : ''); route(); };
  $('#fl-clear').onclick = () => { location.hash = '#/novedades'; route(); };
  $('#fl-q').onkeydown = (e) => { if (e.key === 'Enter') $('#fl-go').click(); };
  $('#btn-export').onclick = () => exportExcel(buildQs());

  const qs = buildQs();
  const data = await api(`/api/reports?limit=${listState.limit}&offset=${listState.offset}` + (qs ? '&' + qs : ''));
  const body = $('#lst-body');
  if (!data.items.length) {
    body.innerHTML = `<tr><td colspan="12" class="center muted" style="padding:30px">Sin novedades con los filtros aplicados.</td></tr>`;
  } else {
    body.innerHTML = data.items.map((r) => `
      <tr>
        <td data-label="ID"><b>${r.id}</b></td>
        <td data-label="Fecha" class="nowrap">${fmtFecha(r.fecha_deteccion)}</td>
        <td data-label="Área">${esc(r.area_reporta) || '—'}</td>
        <td data-label="Tipo">${esc(r.tipo_hallazgo) || '—'}</td>
        <td data-label="Descripción" class="desc" title="${esc(r.descripcion)}">${collapse(r.descripcion)}</td>
        <td data-label="Ref. (Producto)" class="nowrap">${esc(r.referencia) || '—'}</td>
        <td data-label="N.° OF" class="nowrap">${esc(r.orden_fabricacion) || '—'}</td>
        <td data-label="Operario(s)" class="desc" title="${esc(r.operario_nombre)}">${collapse(r.operario_nombre || r.operario_codigo, 60)}</td>
        <td data-label="Und." class="center">${r.cantidad ?? '—'}</td>
        <td data-label="Estado">${badgeEstado(r.estado)}</td>
        <td data-label="Fotos" class="center">${r.photo_count ? `<span class="photo-chip">Fotos: ${r.photo_count}</span>` : '<span class="muted">0</span>'}</td>
        <td class="nowrap row-actions"><a class="btn sm secondary" href="#/novedades/${r.id}">Ver</a></td>
      </tr>`).join('');
  }
  const pages = Math.ceil(data.total / listState.limit);
  const page = Math.floor(listState.offset / listState.limit) + 1;
  $('#lst-pagination').innerHTML = pages > 1 ? `
    <span class="muted small">${data.total} registros · pág. ${page}/${pages}</span>
    <button class="btn sm secondary" id="pg-prev" ${page <= 1 ? 'disabled' : ''}>← Anterior</button>
    <button class="btn sm secondary" id="pg-next" ${page >= pages ? 'disabled' : ''}>Siguiente →</button>` :
    `<span class="muted small">${data.total} registros</span>`;
  if (pages > 1) {
    $('#pg-prev').onclick = () => { listState.offset = Math.max(0, listState.offset - listState.limit); renderList(); };
    $('#pg-next').onclick = () => { listState.offset += listState.limit; renderList(); };
  }
}

/* ============ FOTOS (resize cliente) ============ */
function resizeToJpeg(file, maxDim = 1600, quality = 0.85) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) return reject(new Error(`"${file.name}" no es una imagen`));
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      let w = img.naturalWidth, h = img.naturalHeight;
      if (w > maxDim || h > maxDim) {
        const r = Math.min(maxDim / w, maxDim / h);
        w = Math.round(w * r); h = Math.round(h * r);
      }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      canvas.toBlob(
        (b) => (b ? resolve(new File([b], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' })) : resolve(file)),
        'image/jpeg', quality
      );
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(`No se pudo leer "${file.name}"`)); };
    img.src = url;
  });
}

/* ============ FORMULARIO (crear / editar) ============ */
let formPhotos = [];      // Files nuevos (evidencia)
let formPhotosTrat = [];  // Files nuevos (tratamiento / cierre)
let existingPhotos = [];  // fotos ya guardadas (edición)
let existingPhotosTrat = [];
let editReportId = null;
let SUG = null;

function loadSuggestions() {
  if (!SUG) {
    SUG = api('/api/reports/suggestions').catch(() => ({
      colores: [], responsables_area: [], responsables_trat: [], responsables_cierre: [],
      referencias: [], ordenes: [], otra_ref: [], quines: [], operario_cod: [], operario_nom: [],
    }));
  }
  return SUG;
}

const datalist = (id, arr) => `<datalist id="${id}">${
  (arr || []).map((x) => `<option value="${esc(x)}"></option>`).join('')
}</datalist>`;

async function renderForm(id) {
  editReportId = id ? Number(id) : null;
  formPhotos = []; formPhotosTrat = []; existingPhotos = []; existingPhotosTrat = [];
  const sug = await loadSuggestions();
  let r = null;
  if (editReportId) {
    r = await api('/api/reports/' + editReportId);
    const ph = r.photos || [];
    existingPhotos = ph.filter((p) => p.tipo !== 'TRATAMIENTO');
    existingPhotosTrat = ph.filter((p) => p.tipo === 'TRATAMIENTO');
  }
  const v = (k, d = '') => esc(r ? (r[k] ?? d) : d);
  const html = `
  <div class="page-title">
    <div><h1>${editReportId ? 'Editar novedad #' + editReportId : 'Nueva novedad'}</h1>
    <div class="sub">Todos los campos alimentan la trazabilidad y el archivo Excel</div></div>
    <a class="btn secondary" href="${editReportId ? '#/novedades/' + editReportId : '#/novedades'}">← Volver</a>
  </div>
  <form id="nc-form">
    <div class="card step step-detect">
      <h3 class="section step-title" style="margin-top:0"><span class="step-num">1</span> Detección del hallazgo</h3>
      <div class="form-grid">
        <label class="field"><span>Fecha de detección <b class="req">*</b></span>
          <input type="date" id="f-fecha" value="${r ? esc(r.fecha_deteccion) : hoyISO()}" required /></label>
        <label class="field"><span>Área que reporta <b class="req">*</b></span>
          <select id="f-area" required>
            <option value="">Seleccione…</option>
            ${(() => {
              const cur = v('area_reporta');
              const opts = META.areas.slice();
              if (cur && !opts.includes(cur)) opts.unshift(cur);
              return opts.map((a) => `<option ${cur === a ? 'selected' : ''}>${esc(a)}</option>`).join('');
            })()}
          </select></label>
        <label class="field"><span>Quien registra</span>
          <input type="text" id="f-registra" list="dl-registra" autocomplete="name" autocapitalize="words" value="${r ? v('quien_registra') : esc(USER.operator || USER.name || USER.username)}" /></label>
        <label class="field"><span>Responsable del área <b class="req">*</b></span>
          <input type="text" id="f-resp-area" list="dl-resp-area" autocomplete="off" autocapitalize="words" value="${v('responsable_area')}" required /></label>
        <label class="field"><span>Tipo de hallazgo <b class="req">*</b></span>
          <select id="f-tipo" required>
            <option value="">Seleccione…</option>
            ${META.tipos.map((t) => `<option ${r && r.tipo_hallazgo === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}
          </select></label>
        <label class="field"><span>Color o parte con el error <b class="req">*</b></span>
          <input type="text" id="f-color" list="dl-color" autocomplete="off" autocapitalize="words" value="${v('color_parte_error')}" required placeholder="Ej. Amarillo, tapa inferior, etiqueta frontal…" /></label>
        <label class="field"><span>Turno <b class="req">*</b></span>
          <select id="f-turno" required>
            <option value="" ${r && !r.turno ? 'selected' : ''}>Seleccione…</option>
            <option ${r && r.turno === 'Sin turno' ? 'selected' : ''}>Sin turno</option>
            ${META.turnos.map((t) => `<option ${r && r.turno === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}
          </select></label>
        <label class="field full"><span>Descripción del hallazgo <b class="req">*</b></span>
          <textarea id="f-desc" required placeholder="Describa lo observado…">${v('descripcion')}</textarea></label>
        <label class="field"><span>Cantidad total implicada (unidades)</span>
          <input type="number" id="f-cant" min="0" step="1" value="${r && r.cantidad != null ? esc(r.cantidad) : ''}" /></label>
        <label class="field"><span>Referencia / Producto <b class="req">*</b></span>
          <input type="text" id="f-ref" list="dl-ref" autocomplete="off" autocapitalize="characters" value="${v('referencia')}" required placeholder="Código interno del producto" /></label>
        <label class="field full"><span>Otra referencia física (serial, lote, ubicación, proveedor…)</span>
          <input type="text" id="f-ref-fisica" list="dl-otra" autocomplete="off" autocapitalize="off" value="${v('otra_referencia')}" placeholder="Opcional: cualquier dato que identifique la pieza" /></label>
      </div>
    </div>

    <div class="card step step-evid">
      <h3 class="section step-title" style="margin-top:0"><span class="step-num">2</span> Evidencias de la detección — mínimo 3, máximo ${META.max_photos} fotos <b class="req">*</b></h3>
      <div class="form-grid">
        <label class="field"><span>Abrir cámara (celular)</span>
          <button type="button" class="btn secondary" id="btn-cam">📷 Tomar foto con la cámara</button>
          <input type="file" id="f-cam" accept="image/*" capture="environment" style="display:none" /></label>
        <label class="field"><span>Seleccionar imágenes (JPG/PNG, se reducen automáticamente)</span>
          <input type="file" id="f-fotos" accept="image/jpeg,image/png,image/gif,image/bmp" multiple /></label>
      </div>
      <div class="photo-strip" id="photo-strip"></div>
      <div class="photo-count-warn" id="photo-warn"></div>
    </div>

    <div class="card step step-trace">
      <h3 class="section step-title" style="margin-top:0"><span class="step-num">3</span> Trazabilidad — Orden de fabricación y operarios</h3>
      <div class="form-grid">
        <label class="field"><span>N.° Orden de fabricación <b class="req">*</b></span>
          <input type="text" id="f-of" list="dl-of" autocomplete="off" autocapitalize="characters" value="${v('orden_fabricacion')}" required placeholder="Ej. OF-12345" /></label>
        <label class="field"><span>Fecha OF / consulta</span>
          <input type="date" id="f-of-fecha" value="${r ? esc(r.fecha_deteccion) : hoyISO()}" /></label>
        <div class="field" style="display:flex;align-items:flex-end">
          <button type="button" class="btn" id="btn-lookup">Consultar operarios implicados</button>
        </div>
      </div>
      <div id="lookup-result"></div>
      <div class="mt">
        <span style="display:block;font-size:12px;font-weight:600;color:var(--muted);margin-bottom:5px">Operarios implicados (cada código se busca por separado)</span>
        <div id="ops-rows" class="ops-rows"></div>
        <div class="row-flex mt">
          <button type="button" class="btn secondary" id="btn-add-op">+ Agregar operario</button>
          <span class="muted small">Al salir del código se busca el nombre automáticamente en Elemental.</span>
        </div>
      </div>
      <input type="hidden" id="f-origen" value="${v('origen_operarios', 'MANUAL')}" />
      ${r && r.lookups && r.lookups.length ? `
        <div class="warn">Consultas previas de esta OF: ${r.lookups.map((l) =>
          `${l.fuente} (${l.total_operarios} operarios, ${fmtFecha(l.created_at)} )`).join(' · ')}</div>` : ''}
    </div>

    <div class="card step step-close">
      <h3 class="section step-title" style="margin-top:0"><span class="step-num">4</span> Tratamiento y cierre</h3>
      <div class="form-grid">
        <label class="field"><span>Responsable del tratamiento</span>
          <input type="text" id="f-resp-trat" list="dl-resp-trat" autocomplete="off" autocapitalize="words" value="${v('responsable_tratamiento')}" /></label>
        <label class="field"><span>Verificación de eficacia</span>
          <select id="f-verif">
            <option value="" ${r && !r.verificacion_eficacia ? 'selected' : ''}>Sin verificar</option>
            <option value="Verdadero" ${r && r.verificacion_eficacia === 'Verdadero' ? 'selected' : ''}>Verdadero</option>
            <option value="False" ${r && r.verificacion_eficacia === 'False' ? 'selected' : ''}>False</option>
          </select></label>
        <label class="field"><span>Estado de la salida no conforme</span>
          <select id="f-estado">
            ${META.estados.map((e) => `<option ${r && r.estado === e ? 'selected' : (!r && e === 'ABIERTO' ? 'selected' : '')}>${e}</option>`).join('')}
          </select></label>
        <label class="field full"><span>Acción o tratamiento implementado</span>
          <textarea id="f-accion">${v('accion_tratamiento')}</textarea></label>
        <label class="field"><span>Responsable del cierre</span>
          <input type="text" id="f-resp-cierre" list="dl-resp-cierre" autocomplete="off" autocapitalize="words" value="${v('responsable_cierre')}" /></label>
        <label class="field"><span>Fecha de cierre (solo si está CERRADO)</span>
          <input type="date" id="f-fec-cierre" value="${r && r.fecha_cierre ? esc(r.fecha_cierre) : ''}" /></label>
      </div>
      <div class="mt">
        <h4 class="sub-title">Fotos del tratamiento / cierre <span class="muted small">(opcional, máx. ${META.max_photos})</span></h4>
        <div class="form-grid">
          <label class="field"><span>Abrir cámara (celular)</span>
            <button type="button" class="btn secondary" id="btn-cam-trat">📷 Tomar foto con la cámara</button>
            <input type="file" id="f-cam-trat" accept="image/*" capture="environment" style="display:none" /></label>
          <label class="field"><span>Seleccionar imágenes (JPG/PNG)</span>
            <input type="file" id="f-fotos-trat" accept="image/jpeg,image/png,image/gif,image/bmp" multiple /></label>
        </div>
        <div class="photo-strip" id="photo-strip-trat"></div>
        <div class="photo-count-warn" id="photo-warn-trat"></div>
      </div>
    </div>

    <div class="quick-bar">
      <button class="btn ghost" type="button" id="btn-repeat" title="Copia los datos de la última novedad registrada">🔁 Repetir última novedad</button>
      <span class="muted small">Tip: con <b>Tab</b> o <b>Enter</b> se salta al siguiente campo</span>
    </div>

    ${datalist('dl-color', sug.colores)}
    ${datalist('dl-resp-area', sug.responsables_area)}
    ${datalist('dl-resp-trat', sug.responsables_trat)}
    ${datalist('dl-resp-cierre', sug.responsables_cierre)}
    ${datalist('dl-ref', sug.referencias)}
    ${datalist('dl-of', sug.ordenes)}
    ${datalist('dl-otra', sug.otra_ref)}
    ${datalist('dl-registra', sug.quines)}
    ${datalist('dl-op-cod', sug.operario_cod)}
    ${datalist('dl-op-nom', sug.operario_nom)}

    <div class="actions">
      <button class="btn" type="submit">Guardar novedad</button>
      <a class="btn secondary" href="${editReportId ? '#/novedades/' + editReportId : '#/novedades'}">Cancelar</a>
    </div>
  </form>`;
  shell(html, 'novedades');
  renderPhotoStrip();
  renderPhotoStrip('trat');

  const cods = String(r && r.operario_codigo ? r.operario_codigo : '').split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
  const noms = String(r && r.operario_nombre ? r.operario_nombre : '').split(/[,;]|\s+-\s+/).map((s) => s.trim()).filter(Boolean);
  const opRows = [];
  const maxRows = Math.max(cods.length, noms.length, 1);
  for (let i = 0; i < maxRows; i++) opRows.push({ cod: cods[i] || '', nom: noms[i] || '' });

  const renderOpRows = () => {
    $('#ops-rows').innerHTML = opRows.map((row, i) => `
      <div class="op-row" data-i="${i}">
        <input type="text" class="op-row-cod" list="dl-op-cod" value="${esc(row.cod)}" placeholder="Código Ej. 479" inputmode="numeric" autocapitalize="off" />
        <input type="text" class="op-row-nom" list="dl-op-nom" value="${esc(row.nom)}" placeholder="Nombre (según Elemental)" autocapitalize="words" />
        <span class="op-row-st muted small"></span>
        <button type="button" class="op-row-del" title="Quitar operario">✕</button>
      </div>`).join('');
    $$('#ops-rows .op-row').forEach((el) => {
      const i = Number(el.dataset.i);
      const cod = el.querySelector('.op-row-cod');
      const nom = el.querySelector('.op-row-nom');
      const st = el.querySelector('.op-row-st');
      cod.onchange = () => { opRows[i].cod = cod.value.trim(); lookupRowName(i, opRows, renderOpRows); };
      nom.onchange = () => { opRows[i].nom = nom.value.trim(); };
      el.querySelector('.op-row-del').onclick = () => { opRows.splice(i, 1); if (!opRows.length) opRows.push({ cod: '', nom: '' }); renderOpRows(); };
    });
  };
  window.__renderOpRows = renderOpRows;
  window.__opRows = opRows;
  renderOpRows();

  async function lookupRowName(i, rows, rerender) {
    const cod = (rows[i].cod || '').trim();
    if (!cod || /[^0-9]/.test(cod)) return;
    try {
      const r2 = await api('/api/manage/elemental-operario?codigo=' + encodeURIComponent(cod));
      if (r2.nombre) {
        rows[i].nom = r2.nombre;
        const el = $(`#ops-rows .op-row[data-i="${i}"] .op-row-nom`);
        const st = el && el.parentElement.querySelector('.op-row-st');
        if (el) el.value = r2.nombre;
        if (st) st.textContent = '✓ Elemental';
        if (rows[i].cod && rows[i].nom) $('#f-origen').value = 'ELEMENTAL';
      } else if (r2.warning && rows[i].cod) {
        const el = $(`#ops-rows .op-row[data-i="${i}"]`);
        const st = el && el.querySelector('.op-row-st');
        if (st) st.textContent = '✗ ' + r2.warning;
      }
    } catch { /* silencioso */ }
  }

  $('#btn-cam').onclick = () => $('#f-cam').click();

  /* --- Relleno rápido: repetir la última novedad --- */
  const btnRepeat = $('#btn-repeat');
  if (btnRepeat) btnRepeat.onclick = async () => {
    try {
      const d = await api('/api/reports?limit=1');
      const last = d.items && d.items[0];
      if (!last) { toast('No hay novedades anteriores', 'err'); return; }
      const set = (sel, val) => { const el = $(sel); if (el && val != null && String(val).trim()) el.value = val; };
      set('#f-area', last.area_reporta);
      set('#f-resp-area', last.responsable_area);
      set('#f-registra', last.quien_registra);
      set('#f-tipo', last.tipo_hallazgo);
      set('#f-color', last.color_parte_error);
      set('#f-turno', last.turno);
      set('#f-ref', last.referencia);
      set('#f-ref-fisica', last.otra_referencia);
      set('#f-of', last.orden_fabricacion);
      set('#f-resp-trat', last.responsable_tratamiento);
      const cods = String(last.operario_codigo || '').split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
      const noms = String(last.operario_nombre || '').split(/[,;]|\s+-\s+/).map((s) => s.trim()).filter(Boolean);
      if (cods.length || noms.length) {
        opRows.length = 0;
        const n = Math.max(cods.length, noms.length);
        for (let i = 0; i < n; i++) opRows.push({ cod: cods[i] || '', nom: noms[i] || '' });
        renderOpRows();
      }
      toast('Copiados los datos de la novedad #' + last.id);
      const first = $('#f-color');
      if (first) first.focus();
    } catch (e) { toast(e.message, 'err'); }
  };

  /* --- Enter / Tab: saltar al siguiente campo --- */
  const formEl = $('#nc-form');
  formEl.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.shiftKey) return;
    const t = e.target;
    if (t.tagName === 'BUTTON' || t.tagName === 'TEXTAREA' || t.type === 'file') return;
    if (t.tagName !== 'INPUT' && t.tagName !== 'SELECT') return;
    e.preventDefault();
    const fields = [...formEl.querySelectorAll('input, select, textarea, button')]
      .filter((el) => !el.disabled && el.type !== 'hidden' && el.offsetParent !== null);
    const i = fields.indexOf(t);
    const next = fields[i + 1];
    if (next) next.focus();
  });
  const btnCamTrat = $('#btn-cam-trat');
  if (btnCamTrat) btnCamTrat.onclick = () => $('#f-cam-trat').click();

  const addFiles = async (files, tipo = 'evid') => {
    const trat = tipo === 'trat';
    for (const file of files) {
      const cur = trat ? formPhotosTrat.length + existingPhotosTrat.length
        : formPhotos.length + existingPhotos.length;
      if (cur >= META.max_photos) {
        toast(`Máximo ${META.max_photos} fotos en esta sección`, 'err');
        break;
      }
      try {
        const j = await resizeToJpeg(file);
        if (trat) formPhotosTrat.push(j); else formPhotos.push(j);
      } catch (err) { toast(err.message, 'err'); }
    }
    renderPhotoStrip(tipo);
  };
  $('#f-cam').onchange = (e) => { const f = [...e.target.files]; e.target.value = ''; addFiles(f, 'evid'); };
  $('#f-fotos').onchange = (e) => { const f = [...e.target.files]; e.target.value = ''; addFiles(f, 'evid'); };
  if ($('#f-cam-trat')) $('#f-cam-trat').onchange = (e) => { const f = [...e.target.files]; e.target.value = ''; addFiles(f, 'trat'); };
  if ($('#f-fotos-trat')) $('#f-fotos-trat').onchange = (e) => { const f = [...e.target.files]; e.target.value = ''; addFiles(f, 'trat'); };

  $('#btn-lookup').onclick = doLookup;
  $('#btn-add-op').onclick = () => modalPickOperator(renderOpRows);

  $('#nc-form').onsubmit = async (e) => {
    e.preventDefault();
    const obj = {
      fecha_deteccion: $('#f-fecha').value,
      area_reporta: $('#f-area').value.trim(),
      quien_registra: $('#f-registra').value.trim(),
      responsable_area: $('#f-resp-area').value.trim(),
      tipo_hallazgo: $('#f-tipo').value,
      color_parte_error: $('#f-color').value.trim(),
      descripcion: $('#f-desc').value.trim(),
      cantidad: $('#f-cant').value,
      referencia: $('#f-ref').value.trim(),
      otra_referencia: $('#f-ref-fisica').value.trim(),
      orden_fabricacion: $('#f-of').value.trim(),
      operario_codigo: opRows.map((o) => o.cod.trim()).filter(Boolean).join(', '),
      operario_nombre: opRows.map((o) => o.nom.trim()).filter(Boolean).join(', '),
      turno: $('#f-turno').value,
      responsable_tratamiento: $('#f-resp-trat').value.trim(),
      accion_tratamiento: $('#f-accion').value.trim(),
      verificacion_eficacia: $('#f-verif').value,
      responsable_cierre: $('#f-resp-cierre').value.trim(),
      fecha_cierre: $('#f-fec-cierre').value || null,
      estado: $('#f-estado').value,
      origen_operarios: $('#f-origen').value || 'MANUAL',
    };
    if (!obj.area_reporta) { toast('El área que reporta es obligatoria', 'err'); $('#f-area').focus(); return; }
    if (!obj.responsable_area) { toast('El responsable del área es obligatorio', 'err'); $('#f-resp-area').focus(); return; }
    if (!obj.tipo_hallazgo) { toast('Seleccione el tipo de hallazgo', 'err'); $('#f-tipo').focus(); return; }
    if (!obj.color_parte_error) { toast('El color o parte con el error es obligatorio', 'err'); $('#f-color').focus(); return; }
    if (!obj.turno) { toast('Seleccione el turno (o "Sin turno")', 'err'); $('#f-turno').focus(); return; }
    if (!obj.descripcion) { toast('La descripción es obligatoria', 'err'); $('#f-desc').focus(); return; }
    if (!obj.referencia) { toast('La referencia / producto es obligatoria', 'err'); $('#f-ref').focus(); return; }
    if (!obj.orden_fabricacion) { toast('El N.° de orden de fabricación es obligatorio', 'err'); $('#f-of').focus(); return; }
    if (!obj.operario_codigo && !obj.operario_nombre) {
      toast('Debe registrar al menos un operario (código y nombre)', 'err');
      $('#ops-rows').scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    const totalFotos = existingPhotos.length + formPhotos.length;
    if (totalFotos < 3) {
      toast(`Debe adjuntar mínimo 3 fotos de evidencia (tiene ${totalFotos})`, 'err');
      $('#f-fotos').scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    const fd = new FormData();
    fd.append('data', JSON.stringify(obj));
    formPhotos.forEach((f) => fd.append('fotos', f, f.name));
    formPhotosTrat.forEach((f) => fd.append('fotos_trat', f, f.name));
    try {
      const saved = editReportId
        ? await api('/api/reports/' + editReportId, { method: 'PUT', body: fd })
        : await api('/api/reports', { method: 'POST', body: fd });
      toast(editReportId ? 'Novedad actualizada' : `Novedad #${saved.id} creada`);
      location.hash = '#/novedades/' + saved.id;
    } catch (err) { toast(err.message, 'err'); }
  };
}

function renderPhotoStrip(tipo = 'evid') {
  const trat = tipo === 'trat';
  const strip = $(trat ? '#photo-strip-trat' : '#photo-strip');
  if (!strip) return;
  const warn = $(trat ? '#photo-warn-trat' : '#photo-warn');
  const existArr = trat ? existingPhotosTrat : existingPhotos;
  const newarr = trat ? formPhotosTrat : formPhotos;
  const items = [
    ...existArr.map((p) => ({ kind: 'exist', id: p.id, url: p.url, name: p.original_name })),
    ...newarr.map((f, i) => ({ kind: 'new', i, url: URL.createObjectURL(f), name: f.name })),
  ];
  strip.innerHTML = items.map((it) => `
    <div class="photo-thumb">
      <img src="${it.url}" alt="${esc(it.name)}" data-full="${it.url}" onclick="window.__openLightbox(this.dataset.full)" />
      <button type="button" class="del" data-kind="${it.kind}" data-id="${it.id ?? it.i}" title="Quitar">✕</button>
    </div>`).join('') || `<span class="muted small">Sin fotos ${trat ? 'de tratamiento' : 'adjuntas'}.</span>`;
  const total = items.length;
  if (warn) {
    warn.textContent = total >= META.max_photos
      ? `Límite alcanzado: ${total}/${META.max_photos} fotos.`
      : !trat && total < 3
        ? `Faltan fotos: mínimo 3 (tiene ${total}/${META.max_photos}).`
        : `${total}/${META.max_photos} fotos.`;
    if (!trat) warn.style.color = total < 3 ? 'var(--danger, #c00)' : '';
  }
  $$(trat ? '#photo-strip-trat .del' : '#photo-strip .del').forEach((b) => b.onclick = async () => {
    if (b.dataset.kind === 'exist') {
      if (!confirm('¿Quitar esta foto guardada?')) return;
      try { await api(`/api/reports/${editReportId}/photos/${b.dataset.id}`, { method: 'DELETE' }); }
      catch (e) { toast(e.message, 'err'); return; }
      if (trat) existingPhotosTrat = existingPhotosTrat.filter((p) => String(p.id) !== b.dataset.id);
      else existingPhotos = existingPhotos.filter((p) => String(p.id) !== b.dataset.id);
    } else if (trat) formPhotosTrat.splice(Number(b.dataset.i), 1);
    else formPhotos.splice(Number(b.dataset.i), 1);
    renderPhotoStrip(tipo);
  });
}

window.__openLightbox = (url) => {
  $('#lightbox-img').src = url;
  $('#lightbox').classList.remove('hidden');
};
$('#lightbox-close').onclick = () => $('#lightbox').classList.add('hidden');
$('#lightbox').onclick = (e) => { if (e.target.id === 'lightbox') $('#lightbox').classList.add('hidden'); };

function addOpRow(cod = '', nom = '') {
  const rows = window.__opRows;
  if (!rows) return;
  rows.push({ cod: String(cod).trim(), nom: String(nom).trim() });
  window.__renderOpRows && window.__renderOpRows();
}

async function doLookup() {
  const orden = $('#f-of').value.trim();
  if (!orden) { toast('Digite la orden de fabricación', 'err'); return; }
  const box = $('#lookup-result');
  box.innerHTML = '<div class="lookup-box muted">Consultando Elemental (OF y operarios)…</div>';
  try {
    const r = await api(`/api/manage/elemental-of?orden=${encodeURIComponent(orden)}`);
    if (!r.encontrado) {
      box.innerHTML = `<div class="lookup-box"><div class="warn">${esc(r.warning || 'OF no encontrada en Elemental.')}</div></div>`;
      return;
    }
    $('#f-origen').value = 'ELEMENTAL';
    const partes = [];
    if (r.padre) partes.push(r.padre);
    r.hijos.forEach((h) => partes.push(h));
    const fmtFechaCorta = (f) => f ? esc(f) : '<span class="muted">—</span>';
    box.innerHTML = `
      <div class="lookup-box">
        <b>OF ${esc(r.base)} — ${partes.length} orden(es): padre y partes (hijas)</b>
        <span class="muted small"> — origen: Elemental · fechas de fabricación</span>
        <div class="table-wrap mt" style="max-height:240px;overflow-y:auto">
          <table class="data">
            <thead><tr><th>Orden</th><th>Tipo</th><th>Parte / Producto</th><th>F. inicio (fabricación)</th><th>F. fin</th><th>Estado</th></tr></thead>
            <tbody>${partes.map((p) => `
              <tr>
                <td class="nowrap"><b>${esc(p.orden)}</b></td>
                <td>${p.tipo === 'HIJA' ? '<span class="badge PROCESO">HIJA</span>' : '<span class="badge CERRADO">PADRE</span>'}</td>
                <td class="desc" title="${esc(p.producto)}">${esc(p.producto)}</td>
                <td class="nowrap">${fmtFechaCorta(p.fecha_inicio)}</td>
                <td class="nowrap">${fmtFechaCorta(p.fecha_fin)}</td>
                <td class="center">${esc(p.estado ?? '—')}</td>
              </tr>`).join('')}</tbody>
          </table>
        </div>
        ${r.operariosWarning ? `<div class="warn">${esc(r.operariosWarning)}</div>` : ''}
        ${r.operarios.length ? `
          <b class="mt" style="display:block">${r.operarios.length} operario(s) que registraron producción en la OF</b>
          <div class="op-list">
            ${r.operarios.map((o) => `
              <label class="op-item">
                <input type="checkbox" checked data-cod="${esc(o.codigo)}" data-nom="${esc(o.nombre)}" />
                <span class="cod">${esc(o.codigo)}</span> <span>${esc(o.nombre)}</span>
              </label>`).join('')}
          </div>
          <div class="row-flex mt">
            <button type="button" class="btn sm" id="btn-aplicar-ops">✓ Aplicar seleccionados a la novedad</button>
          </div>` : `<div class="warn mt">${esc(r.operariosWarning || 'Sin operarios registrados para esta OF en Elemental.')}</div>`}
      </div>`;
    const btn = $('#btn-aplicar-ops');
    if (btn) btn.onclick = () => {
      const sel = $$('#lookup-result input:checked');
      if (!sel.length) { toast('Seleccione al menos un operario', 'err'); return; }
      sel.forEach((s) => addOpRow(s.dataset.cod, s.dataset.nom));
      toast('Operarios agregados como filas');
    };
  } catch (e) {
    box.innerHTML = `<div class="lookup-box"><div class="warn">${esc(e.message)}</div></div>`;
  }
}

function modalPickOperator(rerender) {
  const m = $('#modal');
  m.innerHTML = `
  <div class="modal-box">
    <h3>Agregar operario (busca en Elemental)</h3>
    <label class="field"><span>Buscar por código o nombre</span>
      <input type="search" id="op-search" placeholder="Ej. 479 o QUINTERO" autofocus /></label>
    <div class="op-list" id="op-results" style="max-height:280px"></div>
    <div class="actions"><button class="btn secondary" id="op-cancel">Cancelar</button></div>
  </div>`;
  const close = () => (m.innerHTML = '');
  $('#op-cancel').onclick = close;
  m.onclick = (e) => { if (e.target === m) close(); };
  const search = async () => {
    const q = $('#op-search').value.trim();
    let items = [];
    let vacio = 'Sin resultados en Elemental.';
    try {
      const r = await api('/api/manage/elemental-operarios' + (q ? '?q=' + encodeURIComponent(q) : ''));
      items = (r.items || []).map((o) => ({ codigo: o.codigo, nombre: o.nombre }));
      if (r.warning) vacio = r.warning;
    } catch (e) { vacio = e.message; }
    if (!items.length) {
      try {
        const rl = await api('/api/manage/operators' + (q ? '?q=' + encodeURIComponent(q) : ''));
        items = (rl.items || []).map((o) => ({ codigo: o.codigo, nombre: o.nombre }));
        if (items.length) vacio = 'Resultados del padrón local.';
      } catch { /* seguimos con vacío */ }
    }
    $('#op-results').innerHTML = items.length
      ? items.map((o) => `<label class="op-item"><input type="radio" name="oppick" value="${esc(o.codigo)}" data-nom="${esc(o.nombre)}" /><span class="cod">${esc(o.codigo)}</span> <span>${esc(o.nombre)}</span></label>`).join('')
      : `<div class="muted small" style="padding:10px">${esc(vacio)}</div>`;
    $$('#op-results input').forEach((i) => i.onchange = () => {
      addOpRow(i.value, i.dataset.nom);
      close();
      toast('Operario agregado');
    });
  };
  search();
  $('#op-search').oninput = search;
}

/* ============ DETALLE ============ */
async function renderDetail(id) {
  const r = await api('/api/reports/' + id);
  const isG = USER.role === 'gestion';
  const canEdit = isG || (r.estado !== 'CERRADO' && (r.created_by || '').toLowerCase() === USER.username.toLowerCase());
  const dk = (k, label, extra = '') => `
    <div class="detail-item"><div class="k">${label}</div><div class="v ${extra}">${r[k] === null || r[k] === '' || r[k] === undefined ? '—' : (k.includes('fecha') ? fmtFecha(r[k]) : esc(r[k]))}</div></div>`;
  const html = `
  <div class="page-title">
    <div><h1>Novedad #${r.id} ${badgeEstado(r.estado)}</h1>
      <div class="sub">Registrada por ${esc(r.created_by)} · ${fmtFecha(r.created_at)} ${r.origen_operarios ? '· Operarios origen: ' + esc(r.origen_operarios) : ''}</div></div>
    <div class="row-flex">
      ${canEdit ? `<a class="btn" href="#/novedades/${r.id}/editar">Editar</a>` : ''}
      ${isG && r.estado !== 'CERRADO' ? `<button class="btn success" id="btn-cerrar">Cerrar novedad</button>` : ''}
      ${isG ? `<button class="btn danger" id="btn-del">Eliminar</button>` : ''}
      ${!isG && r.puede_eliminar
        ? `<button class="btn danger" id="btn-del" title="Solo durante los primeros 20 minutos">Eliminar${r.minutos_restantes != null ? ` (${r.minutos_restantes} min)` : ''}</button>`
        : ''}
      ${!isG && !r.puede_eliminar ? `<span class="muted small" title="${esc(r.motivo_eliminar || '')}">🔒 Sin permiso para eliminar</span>` : ''}
      <a class="btn secondary" href="#/novedades">← Lista</a>
    </div>
  </div>
  <div class="card step step-detect">
    <h3 class="section step-title" style="margin-top:0"><span class="step-num">1</span> Detección del hallazgo</h3>
    <div class="detail-grid">
      ${dk('fecha_deteccion', 'Fecha de detección', 'big')}
      ${dk('area_reporta', 'Área que reporta', 'big')}
      ${dk('tipo_hallazgo', 'Tipo de hallazgo', 'big')}
      ${dk('color_parte_error', 'Color o parte con el error', 'big')}
      ${dk('turno', 'Turno')}
      ${dk('quien_registra', 'Quien registra')}
      ${dk('responsable_area', 'Responsable del área')}
      ${dk('referencia', 'Referencia / Producto', 'big')}
      ${dk('otra_referencia', 'Otra referencia física', 'big')}
      ${dk('cantidad', 'Unidades implicadas', 'big')}
    </div>
    <h3 class="section step-sub">Descripción del hallazgo</h3>
    <div style="white-space:pre-wrap">${esc(r.descripcion) || '—'}</div>
  </div>

  <div class="card step step-evid">
    <h3 class="section step-title" style="margin-top:0"><span class="step-num">2</span> Evidencias (${r.photo_count_evid}/${META.max_photos})</h3>
    <div class="photo-strip">
      ${(r.photos_evidencia || []).length ? r.photos_evidencia.map((p) => `
        <div class="photo-thumb">
          <img src="${p.url}" alt="${esc(p.original_name)}" onclick="window.__openLightbox('${p.url}')" />
          ${canEdit ? `<button class="del" data-photo="${p.id}">✕</button>` : ''}
        </div>`).join('') : '<span class="muted">Sin fotos. El archivo original referenciado es: ' + (esc(r.evidencia_original) || 'ninguno') + '</span>'}
    </div>
    <h4 class="sub-title">Fotos del tratamiento / cierre <span class="muted small">(${r.photo_count_trat}/${META.max_photos})</span></h4>
    <div class="photo-strip">
      ${(r.photos_tratamiento || []).length ? r.photos_tratamiento.map((p) => `
        <div class="photo-thumb">
          <img src="${p.url}" alt="${esc(p.original_name)}" onclick="window.__openLightbox('${p.url}')" />
          ${canEdit ? `<button class="del" data-photo="${p.id}">✕</button>` : ''}
        </div>`).join('') : '<span class="muted small">Sin fotos de tratamiento/cierre.</span>'}
    </div>
  </div>

  <div class="card step step-trace">
    <h3 class="section step-title" style="margin-top:0"><span class="step-num">3</span> Trazabilidad — Orden de fabricación y operarios</h3>
    <div class="detail-grid">
      ${dk('orden_fabricacion', 'N.° Orden de fabricación', 'big')}
      ${r.orden_fabricacion ? `<div class="detail-item"><div class="k">Partes y fechas de la OF</div><div class="v"><button type="button" class="btn sm" id="btn-of-detail">Ver en Elemental</button></div></div>` : ''}
      ${dk('operario_nombre', 'Operario(s) implicado(s)', 'big')}
      ${dk('operario_codigo', 'Código(s) operario')}
      ${dk('evidencia_original', 'Evidencia original (archivo)')}
    </div>
  </div>

  <div class="card step step-close">
    <div class="row-flex" style="justify-content:space-between;align-items:center;margin-bottom:6px">
      <h3 class="section step-title" style="margin:0"><span class="step-num">4</span> Tratamiento y cierre</h3>
      <button class="btn sm secondary" id="btn-memorando" type="button">📄 Memorando (Word)</button>
    </div>
    <div class="detail-grid">
      ${dk('responsable_tratamiento', 'Responsable tratamiento')}
      ${dk('verificacion_eficacia', 'Verificación eficacia')}
      ${dk('responsable_cierre', 'Responsable cierre')}
      ${dk('fecha_cierre', 'Fecha de cierre')}
    </div>
    <h3 class="section step-sub">Acción o tratamiento implementado</h3>
    <div style="white-space:pre-wrap">${esc(r.accion_tratamiento) || '—'}</div>
  </div>`;
  shell(html, 'novedades');

  const btnDel = $('#btn-del');
  if (btnDel) btnDel.onclick = async () => {
    if (!confirm('¿Eliminar definitivamente la novedad #' + r.id + ' y sus fotos?')) return;
    try { await api('/api/reports/' + r.id, { method: 'DELETE' }); toast('Novedad eliminada'); location.hash = '#/novedades'; }
    catch (e) { toast(e.message, 'err'); }
  };
  const btnClose = $('#btn-cerrar');
  const btnMemo = $('#btn-memorando');
  if (btnMemo) btnMemo.onclick = () => modalMemorando(r);
  const btnOf = $('#btn-of-detail');
  if (btnOf) btnOf.onclick = async () => {
    const m = $('#modal');
    m.innerHTML = `<div class="modal-box"><h3>OF ${esc(r.orden_fabricacion)} — partes y fechas</h3>
      <div class="muted">Consultando Elemental…</div>
      <div class="actions"><button class="btn secondary" id="ofd-close">Cerrar</button></div></div>`;
    $('#ofd-close').onclick = () => (m.innerHTML = '');
    m.onclick = (e) => { if (e.target === m) m.innerHTML = ''; };
    try {
      const d = await api('/api/manage/elemental-of?orden=' + encodeURIComponent(r.orden_fabricacion));
      const partes = d.encontrado ? [...(d.padre ? [d.padre] : []), ...d.hijos] : [];
      $('#modal .modal-box').innerHTML = `
        <h3>OF ${esc(d.base || r.orden_fabricacion)} — ${partes.length} orden(es)</h3>
        ${!d.encontrado ? `<div class="warn">${esc(d.warning || 'No encontrada.')}</div>` : `
        <div class="table-wrap"><table class="data">
          <thead><tr><th>Orden</th><th>Tipo</th><th>Parte / Producto</th><th>F. inicio</th><th>F. fin</th></tr></thead>
          <tbody>${partes.map((p) => `<tr>
            <td class="nowrap"><b>${esc(p.orden)}</b></td>
            <td>${p.tipo}</td>
            <td class="desc">${esc(p.producto)}</td>
            <td class="nowrap">${p.fecha_inicio ? esc(p.fecha_inicio) : '—'}</td>
            <td class="nowrap">${p.fecha_fin ? esc(p.fecha_fin) : '—'}</td>
          </tr>`).join('')}</tbody>
        </table></div>`}
        <div class="actions"><button class="btn secondary" id="ofd-close">Cerrar</button></div>`;
      $('#ofd-close').onclick = () => (m.innerHTML = '');
    } catch (e) {
      const box = $('#modal .modal-box');
      if (box) box.innerHTML = `<h3>OF ${esc(r.orden_fabricacion)}</h3><div class="warn">${esc(e.message)}</div>
        <div class="actions"><button class="btn secondary" id="ofd-close">Cerrar</button></div>`;
      if ($('#ofd-close')) $('#ofd-close').onclick = () => (m.innerHTML = '');
    }
  };
  if (btnClose) btnClose.onclick = async () => {
    try {
      await api('/api/reports/' + r.id, {
        method: 'PUT',
        body: JSON.stringify({ ...r, estado: 'CERRADO', fecha_cierre: hoyISO() }),
      });
      toast('Novedad cerrada');
      renderDetail(id);
    } catch (e) { toast(e.message, 'err'); }
  };
  $$('#app [data-photo]').forEach((b) => b.onclick = async () => {
    if (!confirm('¿Quitar esta foto?')) return;
    try { await api(`/api/reports/${r.id}/photos/${b.dataset.photo}`, { method: 'DELETE' }); renderDetail(id); }
    catch (e) { toast(e.message, 'err'); }
  });
}

/* ============ GESTIÓN ============ */
async function renderGestion(tab = 'usuarios') {
  const html = `
  <div class="page-title"><div><h1>Gestión</h1>
    <div class="sub">Usuarios, padrón de operarios, catálogos y conexión con la REST API</div></div></div>
  <div class="tabs" id="gestabs">
    <button data-t="usuarios" class="${tab === 'usuarios' ? 'active' : ''}">Usuarios</button>
    <button data-t="operarios" class="${tab === 'operarios' ? 'active' : ''}">Operarios</button>
    <button data-t="catalogos" class="${tab === 'catalogos' ? 'active' : ''}">Catálogos</button>
    <button data-t="api" class="${tab === 'api' ? 'active' : ''}">API de operarios</button>
    <button data-t="accesos" class="${tab === 'accesos' ? 'active' : ''}">Accesos</button>
  </div>
  <div id="gestion-body"><div class="card muted">Cargando…</div></div>`;
  shell(html, 'gestion');
  $$('#gestabs button').forEach((b) => b.onclick = () => { location.hash = '#/gestion/' + b.dataset.t; });
  if (tab === 'usuarios') return gUsuarios();
  if (tab === 'operarios') return gOperarios();
  if (tab === 'catalogos') return gCatalogos();
  if (tab === 'accesos') return gAccesos();
  return gApi();
}

/* ============ AREA REPORTE: USUARIOS ============ */
async function renderUsuarios() {
  const html = `
  <div class="page-title">
    <div><h1>Usuarios de Reporte</h1>
      <div class="sub">Cree cuentas con rol Reporte. Quedan pendientes hasta que un usuario de Gestión las apruebe.</div></div>
    <div class="row-flex"><button class="btn" id="ru-new">+ Nuevo usuario</button></div>
  </div>
  <div id="rep-body"><div class="card muted">Cargando…</div></div>`;
  shell(html, 'usuarios');
  $('#ru-new').onclick = () => userModal(null, 'reporte');
  return rUsuarios();
}

async function rUsuarios() {
  const r = await api('/api/manage/users');
  const pend = r.items.filter((u) => u.pending);
  const body = $('#rep-body');
  if (!body) return;
  body.innerHTML = `
  ${pend.length ? `<div class="warn" style="margin-bottom:14px">
    <b>${pend.length} cuenta(s) esperando aprobación.</b> Aún no pueden ingresar: un usuario de Gestión activo debe aprobarlas en Gestión → Usuarios.
  </div>` : ''}
  <div class="card">
    <div class="row-flex" style="justify-content:space-between;margin-bottom:12px">
      <h3 style="margin:0;color:var(--primary)">Cuentas con rol Reporte <span class="muted small">(${r.items.length})</span></h3>
      <button class="btn" id="ru-new2">+ Nuevo usuario</button>
    </div>
    ${r.items.length ? `
    <div class="table-wrap"><table class="data card-rows">
      <thead><tr><th>Usuario</th><th>Nombre</th><th>Estado</th><th>Creado</th></tr></thead>
      <tbody>${r.items.map((u) => `
        <tr>
          <td data-label="Usuario"><b>${esc(u.username)}</b></td>
          <td data-label="Nombre">${esc(u.full_name) || '—'}</td>
          <td data-label="Estado">${u.pending
            ? '<span class="badge ABIERTO">Pendiente de aprobación</span>'
            : (u.active ? '<span class="badge CERRADO">Activo</span>' : '<span class="badge ABIERTO">Inactivo</span>')}</td>
          <td data-label="Creado" class="nowrap small">${fmtFecha(u.created_at)}</td>
        </tr>`).join('')}</tbody>
    </table></div>` : '<div class="muted">Todavía no hay cuentas de Reporte. Cree la primera con «+ Nuevo usuario».</div>'}
  </div>`;
  $('#ru-new2').onclick = () => userModal(null, 'reporte');
}

async function gAccesos() {
  const d = await api('/api/manage/access-log');
  $('#gestion-body').innerHTML = `
  <div class="card">
    <h3 class="section" style="margin-top:0">Quién ingresó y desde cuándo (trazabilidad de accesos)</h3>
    ${d.resumen.length ? `
      <div class="table-wrap"><table class="data card-rows">
        <thead><tr><th>Usuario</th><th>Nombre de quien opera</th><th>Accesos</th><th>Último ingreso</th></tr></thead>
        <tbody>${d.resumen.map((x) => `<tr>
          <td data-label="Usuario"><b>${esc(x.username)}</b></td>
          <td data-label="Nombre de quien opera">${esc(x.operator || '—')}</td>
          <td data-label="Accesos">${x.accesos}</td>
          <td data-label="Último ingreso" class="nowrap">${esc(x.ultimo || '—')}</td>
        </tr>`).join('')}</tbody>
      </table></div>` : '<div class="muted">Todavía no hay accesos registrados.</div>'}

    <h3 class="section">Últimos ingresos</h3>
    ${d.items.length ? `
      <div class="table-wrap"><table class="data card-rows">
        <thead><tr><th>Fecha y hora</th><th>Usuario</th><th>Quien opera</th><th>Rol</th><th>IP</th></tr></thead>
        <tbody>${d.items.map((x) => `<tr>
          <td data-label="Fecha y hora" class="nowrap">${esc(x.created_at)}</td>
          <td data-label="Usuario">${esc(x.username)}</td>
          <td data-label="Quien opera">${esc(x.operator || '—')}</td>
          <td data-label="Rol">${esc(x.role)}</td>
          <td data-label="IP">${esc(x.ip || '—')}</td>
        </tr>`).join('')}</tbody>
      </table></div>` : '<div class="muted">Sin registros.</div>'}
  </div>`;
}

async function gUsuarios() {
  const r = await api('/api/manage/users');
  const pend = r.items.filter((u) => u.pending);
  $('#gestion-body').innerHTML = `
  ${pend.length ? `<div class="warn" style="margin-bottom:14px">
    <b>${pend.length} usuario(s) pendiente(s) de aprobación.</b> Un usuario de Gestión activo debe aprobarlos para que puedan ingresar.
  </div>` : ''}
  <div class="card">
    <div class="row-flex" style="justify-content:space-between;margin-bottom:6px">
      <h3 style="margin:0;color:var(--primary)">Usuarios del sistema</h3>
      <button class="btn" id="u-new">+ Nuevo usuario de Gestión</button>
    </div>
    <div class="muted small" style="margin-bottom:12px">
      Aquí se crean y aprueban las cuentas de <b>Gestión</b>. Las cuentas de <b>Reporte</b> se crean en el área de Reporte
      (menú Usuarios) y aparecen aquí para que usted las apruebe.
    </div>
    <div class="table-wrap"><table class="data card-rows">
      <thead><tr><th>Usuario</th><th>Nombre</th><th>Rol</th><th>Estado</th><th>Creado</th><th></th></tr></thead>
      <tbody>${r.items.map((u) => `
        <tr>
          <td data-label="Usuario"><b>${esc(u.username)}</b></td>
          <td data-label="Nombre">${esc(u.full_name) || '—'}</td>
          <td data-label="Rol">${u.role === 'gestion' ? '<span class="badge CERRADO">GESTIÓN</span>' : '<span class="badge PROCESO">REPORTE</span>'}</td>
          <td data-label="Estado">${u.pending
            ? '<span class="badge ABIERTO">Pendiente de aprobación</span>'
            : (u.active ? '<span class="badge CERRADO">Activo</span>' : '<span class="badge ABIERTO">Inactivo</span>')}</td>
          <td data-label="Creado" class="nowrap small">${fmtFecha(u.created_at)}</td>
          <td class="nowrap row-actions">
            ${u.pending ? `<button class="btn sm success" data-approve="${u.id}">✔ Aprobar</button>` : ''}
            <button class="btn sm secondary" data-edit="${u.id}">Editar</button>
            <button class="btn sm ghost" data-reset="${u.id}">Clave</button>
            <button class="btn sm danger" data-del="${u.id}">Eliminar</button>
          </td>
        </tr>`).join('')}</tbody>
    </table></div>
  </div>`;
  $('#u-new').onclick = () => userModal(null);
  $$('#gestion-body [data-approve]').forEach((b) => b.onclick = async () => {
    const u = r.items.find((x) => x.id === Number(b.dataset.approve));
    if (!u) return;
    if (!confirm(`¿Aprobar al usuario "${u.username}"? Podrá ingresar de inmediato.`)) return;
    try {
      await api('/api/manage/users/' + u.id, { method: 'PUT', body: { pending: 0 } });
      toast('Usuario aprobado');
      gUsuarios();
    } catch (e) { toast(e.message, 'err'); }
  });
  $$('#gestion-body [data-edit]').forEach((b) => b.onclick = () => userModal(r.items.find((u) => u.id === Number(b.dataset.edit))));
  $$('#gestion-body [data-reset]').forEach((b) => b.onclick = () => resetPassModal(r.items.find((u) => u.id === Number(b.dataset.reset))));
  $$('#gestion-body [data-del]').forEach((b) => b.onclick = async () => {
    const u = r.items.find((x) => x.id === Number(b.dataset.del));
    if (!u) return;
    if (!confirm(`¿Eliminar el usuario "${u.username}"? Esta acción no se puede deshacer.`)) return;
    try {
      await api('/api/manage/users/' + u.id, { method: 'DELETE' });
      toast('Usuario eliminado');
      gUsuarios();
    } catch (e) { toast(e.message, 'err'); }
  });
}

function userModal(u, ctx = 'gestion') {
  const enReporte = ctx === 'reporte';
  const volver = enReporte ? rUsuarios : gUsuarios;
  const rolCampo = enReporte
    ? '<input type="hidden" id="u-role" value="reporte" />'
    : (u
      ? `<select id="u-role">
          <option value="reporte" ${u.role === 'reporte' ? 'selected' : ''}>Reporte</option>
          <option value="gestion" ${u.role === 'gestion' ? 'selected' : ''}>Gestión</option>
        </select>`
      : '<select id="u-role"><option value="gestion">Gestión</option></select>');
  const aviso = u ? '' : (enReporte
    ? '<div class="warn" style="margin:10px 0">La cuenta quedará <b>pendiente</b>: un usuario de Gestión activo debe aprobarla para que pueda ingresar.</div>'
    : '<div class="warn" style="margin:10px 0">Se creará <b>aprobada</b>, porque la crea un usuario de Gestión activo.</div>');
  const m = $('#modal');
  m.innerHTML = `
  <div class="modal-box">
    <h3>${u ? 'Editar usuario' : (enReporte ? 'Nuevo usuario de Reporte' : 'Nuevo usuario de Gestión')}</h3>
    <div class="form-grid">
      <label class="field"><span>Usuario</span><input type="text" id="u-username" value="${esc(u?.username || '')}" ${u ? 'disabled' : ''} /></label>
      <label class="field"><span>Nombre completo</span><input type="text" id="u-name" value="${esc(u?.full_name || '')}" /></label>
      <label class="field"><span>Rol</span>${rolCampo}</label>
      <label class="field"><span>Estado</span><select id="u-active" ${u ? '' : 'disabled'}>
        <option value="1" ${u?.active ? 'selected' : ''}>Activo</option>
        <option value="0" ${u && !u.active ? 'selected' : ''}>Inactivo</option>
      </select></label>
      ${!u ? `<label class="field full"><span>Contraseña inicial (mín. 6)</span><input type="text" id="u-pass" /></label>` : ''}
    </div>
    ${aviso}
    <div class="actions">
      <button class="btn" id="u-save">Guardar</button>
      <button class="btn secondary" id="u-cancel">Cancelar</button>
    </div>
  </div>`;
  const close = () => (m.innerHTML = '');
  $('#u-cancel').onclick = close;
  m.onclick = (e) => { if (e.target === m) close(); };
  $('#u-save').onclick = async () => {
    try {
      if (u) {
        await api('/api/manage/users/' + u.id, {
          method: 'PUT',
          body: { full_name: $('#u-name').value, role: $('#u-role').value, active: $('#u-active').value === '1' },
        });
      } else {
        const r = await api('/api/manage/users', {
          method: 'POST',
          body: { username: $('#u-username').value.trim(), password: $('#u-pass').value, full_name: $('#u-name').value, role: $('#u-role').value },
        });
        close();
        toast(r.mensaje || 'Usuario creado');
        return volver();
      }
      close(); toast('Usuario guardado'); volver();
    } catch (e) { toast(e.message, 'err'); }
  };
}

function resetPassModal(u) {
  const m = $('#modal');
  m.innerHTML = `
  <div class="modal-box">
    <h3>Nueva contraseña para ${esc(u.username)}</h3>
    <label class="field"><span>Nueva contraseña (mín. 6)</span><input type="text" id="rp-pass" autofocus /></label>
    <div class="actions"><button class="btn" id="rp-save">Guardar</button><button class="btn secondary" id="rp-cancel">Cancelar</button></div>
  </div>`;
  const close = () => (m.innerHTML = '');
  $('#rp-cancel').onclick = close;
  $('#rp-save').onclick = async () => {
    try {
      await api('/api/manage/users/' + u.id, { method: 'PUT', body: { password: $('#rp-pass').value } });
      close(); toast('Contraseña actualizada');
    } catch (e) { toast(e.message, 'err'); }
  };
}

async function gOperarios() {
  $('#gestion-body').innerHTML = `
  <div class="card">
    <div class="row-flex" style="justify-content:space-between;margin-bottom:12px">
      <h3 style="margin:0;color:var(--primary)">Padrón de operarios</h3>
      <input type="search" id="ops-q" placeholder="Buscar código o nombre…" style="max-width:260px" />
    </div>
    <div class="form-grid" style="margin-bottom:14px">
      <label class="field"><span>Código</span><input type="text" id="ops-cod" placeholder="Ej. 479" /></label>
      <label class="field"><span>Nombre completo</span><input type="text" id="ops-nom" placeholder="Apellido Nombre…" /></label>
      <div class="field" style="display:flex;align-items:flex-end"><button class="btn" id="ops-add">+ Agregar / actualizar</button></div>
    </div>
    <div class="table-wrap"><table class="data">
      <thead><tr><th>Código</th><th>Nombre</th><th>Actualizado</th><th></th></tr></thead>
      <tbody id="ops-body"><tr><td colspan="4" class="muted center">Cargando…</td></tr></tbody>
    </table></div>
    <p class="muted small mt">Los operarios que devuelve la REST API por orden de fabricación se guardan aquí automáticamente (caché).</p>
  </div>`;
  const load = async () => {
    const q = $('#ops-q').value.trim();
    const r = await api('/api/manage/operators' + (q ? '?q=' + encodeURIComponent(q) : ''));
    $('#ops-body').innerHTML = r.items.length ? r.items.map((o) => `
      <tr><td><b>${esc(o.codigo)}</b></td><td>${esc(o.nombre)}</td>
      <td class="small nowrap">${fmtFecha(o.updated_at)}</td>
      <td><button class="btn sm danger" data-del="${o.id}">Quitar</button></td></tr>`).join('')
      : '<tr><td colspan="4" class="center muted">Sin operarios registrados.</td></tr>';
    $$('#ops-body [data-del]').forEach((b) => b.onclick = async () => {
      if (!confirm('¿Desactivar operario?')) return;
      await api('/api/manage/operators/' + b.dataset.del, { method: 'DELETE' });
      toast('Operario desactivado'); load();
    });
  };
  $('#ops-q').oninput = () => clearTimeout(window.__opsT) || (window.__opsT = setTimeout(load, 250));
  $('#ops-add').onclick = async () => {
    try {
      await api('/api/manage/operators', { method: 'POST', body: { codigo: $('#ops-cod').value, nombre: $('#ops-nom').value } });
      toast('Operario guardado'); $('#ops-cod').value = ''; $('#ops-nom').value = ''; load();
    } catch (e) { toast(e.message, 'err'); }
  };
  load();
}

async function gCatalogos() {
  const r = await api('/api/manage/catalog');
  const list = (clave, titulo, items) => `
    <div class="card">
      <h3 style="margin:0 0 12px;color:var(--primary)">${titulo}</h3>
      <div class="row-flex" style="margin-bottom:10px">
        <input type="text" id="cat-in-${clave}" placeholder="Nuevo valor…" style="max-width:260px" />
        <button class="btn sm" data-addcat="${clave}">+ Agregar</button>
      </div>
      <div>${items.map((v) => `
        <div class="op-item" style="justify-content:space-between;border-bottom:1px solid var(--border)">
          <span>${esc(v)}</span>
          <button class="btn sm danger" data-delcat="${clave}" data-val="${esc(v)}">✕</button>
        </div>`).join('')}</div>
    </div>`;
  $('#gestion-body').innerHTML = `
    <div class="charts">
      ${list('tipo', 'Tipos de hallazgo', r.tipos)}
      ${list('area', 'Áreas', r.areas)}
      ${list('turno', 'Turnos', r.turnos)}
    </div>`;
  $$('#gestion-body [data-addcat]').forEach((b) => b.onclick = async () => {
    const clave = b.dataset.addcat;
    const val = $('#cat-in-' + clave).value.trim();
    if (!val) return;
    try { await api('/api/manage/catalog', { method: 'POST', body: { clave, valor: val } }); toast('Agregado'); renderGestion('catalogos'); }
    catch (e) { toast(e.message, 'err'); }
  });
  $$('#gestion-body [data-delcat]').forEach((b) => b.onclick = async () => {
    if (!confirm(`¿Quitar "${b.dataset.val}" del catálogo?`)) return;
    await api(`/api/manage/catalog/${b.dataset.delcat}/${encodeURIComponent(b.dataset.val)}`, { method: 'DELETE' });
    renderGestion('catalogos');
  });
}

async function gApi() {
  const cfg = await api('/api/manage/api-config');
  let ecfg = {};
  try { ecfg = await api('/api/manage/elemental-config'); } catch { /* sin permisos o sin config */ }
  $('#gestion-body').innerHTML = `
  <div class="card">
    <h3 style="margin-top:0;color:var(--primary)">Conexión con Elemental Web (operarios y OFs)</h3>
    <p class="muted small">Fuente de nombres de operarios y de las fechas de fabricación de las partes de cada orden (OF padre e hijas). La contraseña se guarda en el servidor y nunca se muestra.</p>
    <div class="form-grid">
      <label class="field"><span>Estado</span><select id="el-enabled">
        <option value="0" ${ecfg.enabled === false ? 'selected' : ''}>Desconectada (manual)</option>
        <option value="1" ${ecfg.enabled !== false ? 'selected' : ''}>Conectada</option>
      </select></label>
      <label class="field"><span>URL base</span><input type="text" id="el-base" value="${esc(ecfg.baseUrl || '')}" placeholder="http://192.168.2.119" /></label>
      <label class="field"><span>Usuario</span><input type="text" id="el-user" value="${esc(ecfg.username || '')}" autocomplete="off" /></label>
      <label class="field"><span>Contraseña</span><input type="password" id="el-pass" value="${esc(ecfg.password || '')}" placeholder="••••••" autocomplete="new-password" /></label>
      <label class="field"><span>Timeout (ms)</span><input type="number" id="el-timeout" value="${ecfg.timeoutMs || 15000}" /></label>
      <label class="field"><span>Refrescar órdenes cada (horas)</span><input type="number" id="el-ttl" min="1" max="168" value="${ecfg.woTtlHours || 12}" /></label>
    </div>
    <div class="actions">
      <button class="btn" id="el-save">Guardar conexión</button>
      <button class="btn secondary" id="el-refresh">Refrescar órdenes ahora</button>
      <button class="btn secondary" id="el-test">Probar con una OF</button>
    </div>
    <div id="el-test-result"></div>
  </div>
  <div class="card">
    <h3 style="margin-top:0;color:var(--primary)">Conexión con la REST API de operarios por orden de fabricación</h3>
    <p class="muted small">Cuando el usuario digite la N.° OF y fecha, la app consultará esta API y traerá automáticamente los operarios implicados con su nombre según el código. La configuración se guarda en el servidor.</p>
    <div class="form-grid">
      <label class="field"><span>Estado</span><select id="api-enabled">
        <option value="0" ${!cfg.enabled ? 'selected' : ''}>Desconectada (modo manual / placeholder)</option>
        <option value="1" ${cfg.enabled ? 'selected' : ''}>Conectada (consulta automática)</option>
      </select></label>
      <label class="field"><span>URL base</span><input type="text" id="api-base" value="${esc(cfg.baseUrl)}" placeholder="https://erp.empresa.com/api" /></label>
      <label class="field"><span>Ruta (usa {orden} y {fecha})</span><input type="text" id="api-path" value="${esc(cfg.path)}" /></label>
      <label class="field"><span>Método</span><select id="api-method">
        <option ${cfg.method === 'GET' ? 'selected' : ''}>GET</option>
        <option ${cfg.method === 'POST' ? 'selected' : ''}>POST</option>
      </select></label>
      <label class="field"><span>Timeout (ms)</span><input type="number" id="api-timeout" value="${cfg.timeoutMs}" /></label>
      <label class="field"><span>¿Usar caché si falla la API?</span><select id="api-fb">
        <option value="1" ${cfg.fallbackLocal !== false ? 'selected' : ''}>Sí</option>
        <option value="0" ${cfg.fallbackLocal === false ? 'selected' : ''}>No</option>
      </select></label>
      <label class="field full"><span>Headers (JSON, ej. {"Authorization":"Bearer xxx"})</span>
        <textarea id="api-headers" style="font-family:monospace;min-height:60px">${esc(JSON.stringify(cfg.headers || {}, null, 0))}</textarea></label>
      <label class="field full"><span>Query (JSON, ej. {"fecha":"{fecha}"})</span>
        <textarea id="api-query" style="font-family:monospace;min-height:50px">${esc(JSON.stringify(cfg.query || {}, null, 0))}</textarea></label>
      <label class="field"><span>Mapa: ruta raíz de datos</span><input type="text" id="api-m-root" value="${esc(cfg.map?.root || '')}" placeholder="vacío = respuesta raíz" /></label>
      <label class="field"><span>Mapa: arreglo de operarios</span><input type="text" id="api-m-ops" value="${esc(cfg.map?.operarios || 'operarios')}" /></label>
      <label class="field"><span>Mapa: campo código</span><input type="text" id="api-m-cod" value="${esc(cfg.map?.codigo || 'codigo')}" /></label>
      <label class="field"><span>Mapa: campo nombre</span><input type="text" id="api-m-nom" value="${esc(cfg.map?.nombre || 'nombre')}" /></label>
    </div>
    <div class="actions">
      <button class="btn" id="api-save">Guardar configuración</button>
      <button class="btn secondary" id="api-test">Probar con una OF</button>
    </div>
    <div id="api-test-result"></div>
  </div>
  <div class="card">
    <h3 style="margin-top:0;color:var(--primary)">Últimas consultas realizadas (trazabilidad)</h3>
    <div id="api-lookups" class="muted small">Cargando…</div>
  </div>`;
  $('#api-save').onclick = async () => {
    try {
      const headers = JSON.parse($('#api-headers').value || '{}');
      const query = JSON.parse($('#api-query').value || '{}');
      await api('/api/manage/api-config', {
        method: 'PUT',
        body: {
          enabled: $('#api-enabled').value === '1',
          baseUrl: $('#api-base').value.trim(),
          path: $('#api-path').value.trim(),
          method: $('#api-method').value,
          timeoutMs: Number($('#api-timeout').value),
          fallbackLocal: $('#api-fb').value === '1',
          headers, query,
          map: {
            root: $('#api-m-root').value.trim(),
            operarios: $('#api-m-ops').value.trim(),
            codigo: $('#api-m-cod').value.trim(),
            nombre: $('#api-m-nom').value.trim(),
          },
        },
      });
      toast('Configuración guardada');
    } catch (e) { toast(e.message, 'err'); }
  };
  $('#api-test').onclick = async () => {
    const orden = prompt('Número de orden de fabricación a probar:');
    if (!orden) return;
    const fecha = prompt('Fecha (YYYY-MM-DD), opcional:', hoyISO()) || '';
    $('#api-test-result').innerHTML = '<div class="warn mt">Consultando…</div>';
    try {
      const r = await api(`/api/manage/lookup-operarios?orden=${encodeURIComponent(orden)}&fecha=${encodeURIComponent(fecha)}`);
      $('#api-test-result').innerHTML = `
        <div class="${r.operarios.length ? 'ok-note' : 'warn'} mt">
          <b>Origen: ${r.source}</b> — ${r.operarios.length} operario(s).
          ${r.warning ? esc(r.warning) : ''}
          <ul>${r.operarios.map((o) => `<li>${esc(o.codigo)} — ${esc(o.nombre)}</li>`).join('')}</ul>
        </div>`;
    } catch (e) { $('#api-test-result').innerHTML = `<div class="warn mt">${esc(e.message)}</div>`; }
  };
  $('#el-save').onclick = async () => {
    try {
      await api('/api/manage/elemental-config', {
        method: 'PUT',
        body: {
          enabled: $('#el-enabled').value === '1',
          baseUrl: $('#el-base').value.trim(),
          username: $('#el-user').value.trim(),
          password: $('#el-pass').value,
          timeoutMs: Number($('#el-timeout').value),
          woTtlHours: Number($('#el-ttl').value),
        },
      });
      toast('Conexión con Elemental guardada');
    } catch (e) { toast(e.message, 'err'); }
  };
  $('#el-refresh').onclick = async () => {
    $('#el-test-result').innerHTML = '<div class="warn mt">Descargando órdenes de Elemental (puede tardar)…</div>';
    try {
      const r = await api('/api/manage/elemental-refresh', { method: 'POST' });
      $('#el-test-result').innerHTML = `<div class="ok-note mt">Listo: ${r.total} órdenes indexadas.</div>`;
    } catch (e) { $('#el-test-result').innerHTML = `<div class="warn mt">${esc(e.message)}</div>`; }
  };
  $('#el-test').onclick = async () => {
    const orden = prompt('Número de orden de fabricación a probar en Elemental (ej. 17779):');
    if (!orden) return;
    $('#el-test-result').innerHTML = '<div class="warn mt">Consultando Elemental…</div>';
    try {
      const r = await api(`/api/manage/elemental-of?orden=${encodeURIComponent(orden)}`);
      const partes = r.encontrado ? [...(r.padre ? [r.padre] : []), ...r.hijos] : [];
      $('#el-test-result').innerHTML = !r.encontrado
        ? `<div class="warn mt">${esc(r.warning || 'No encontrada.')}</div>`
        : `<div class="ok-note mt"><b>${partes.length} orden(es)</b> (padre + partes), ${r.operarios.length} operario(s):
            <ul>${partes.map((p) => `<li>${esc(p.orden)} — ${esc(p.producto)} — inicio: ${p.fecha_inicio || '—'} — fin: ${p.fecha_fin || '—'}</li>`).join('')}</ul>
            ${r.operarios.length ? `<div>Operarios: ${r.operarios.map((o) => esc(o.codigo) + ' ' + esc(o.nombre)).join(' · ')}</div>` : ''}
          </div>`;
    } catch (e) { $('#el-test-result').innerHTML = `<div class="warn mt">${esc(e.message)}</div>`; }
  };
  try {
    const lk = await api('/api/manage/lookups');
    $('#api-lookups').innerHTML = lk.items.length ? `
      <div class="table-wrap"><table class="data">
        <thead><tr><th>OF</th><th>Origen</th><th>Operarios</th><th>Fecha consulta</th></tr></thead>
        <tbody>${lk.items.map((l) => `<tr><td>${esc(l.orden)}</td><td>${esc(l.fuente)}</td><td>${l.total_operarios}</td><td class="small nowrap">${esc(l.created_at)}</td></tr>`).join('')}</tbody>
      </table></div>` : 'Aún no se han hecho consultas.';
  } catch { $('#api-lookups').textContent = '—'; }
}

function modalChangePassword() {
  const m = $('#modal');
  m.innerHTML = `
  <div class="modal-box">
    <h3>Cambiar mi contraseña</h3>
    <label class="field"><span>Contraseña actual</span><input type="password" id="cp-cur" /></label>
    <label class="field"><span>Nueva contraseña (mín. 6)</span><input type="password" id="cp-new" /></label>
    <div class="actions"><button class="btn" id="cp-save">Guardar</button><button class="btn secondary" id="cp-cancel">Cancelar</button></div>
  </div>`;
  const close = () => (m.innerHTML = '');
  $('#cp-cancel').onclick = close;
  $('#cp-save').onclick = async () => {
    try {
      await api('/api/auth/change-password', { method: 'POST', body: { current: $('#cp-cur').value, next: $('#cp-new').value } });
      close(); toast('Contraseña actualizada');
    } catch (e) { toast(e.message, 'err'); }
  };
}

/* ============ MEMORANDO (Word) ============ */
function modalMemorando(r) {
  const limpio = (s) => String(s ?? '').trim();
  const asuntoAuto =
    `Producto no conforme: ${limpio(r.tipo_hallazgo) || 'novedad'}` +
    `${limpio(r.referencia) ? ' — Ref. ' + limpio(r.referencia) : ''}` +
    `${limpio(r.orden_fabricacion) ? ' (OF ' + limpio(r.orden_fabricacion) + ')' : ''}`;
  const par = (et, v) => (limpio(v) ? `${et}: ${limpio(v)}` : '');
  const mensajeAuto = [
    'Se notifica la siguiente novedad de producto no conforme registrada en el sistema:',
    '',
    par('Fecha de detección', r.fecha_deteccion),
    par('Área que reporta', r.area_reporta),
    par('Tipo de hallazgo', r.tipo_hallazgo),
    par('Color de la parte con error', r.color_parte_error),
    par('Referencia', r.referencia),
    par('Orden de fabricación', r.orden_fabricacion),
    par('Turno', r.turno),
    par('Cantidad', r.cantidad),
    par('Operario(s)', r.operario_nombre),
    '',
    par('Descripción', r.descripcion),
    '',
    par('Responsable del tratamiento', r.responsable_tratamiento),
    par('Acción o tratamiento implementado', r.accion_tratamiento),
    par('Verificación de eficacia', r.verificacion_eficacia),
    par('Responsable del cierre', r.responsable_cierre),
    par('Fecha de cierre', r.fecha_cierre),
  ].filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n');

  const m = $('#modal');
  m.innerHTML = `
  <div class="modal-box" style="max-width:760px">
    <h3>Memorando — novedad #${r.id}</h3>
    <div class="muted small" style="margin-bottom:10px">
      Los campos vienen cargados con la información de la novedad. Edite lo que necesite y descargue el documento.
    </div>
    <div class="form-grid">
      <label class="field"><span>Nombre del empleado</span><input type="text" id="mo-nombre" value="${esc(limpio(r.operario_nombre) || USER.operator || USER.name || '')}" /></label>
      <label class="field"><span>Fecha</span><input type="date" id="mo-fecha" value="${esc(limpio(r.fecha_cierre) || limpio(r.fecha_deteccion) || hoyISO())}" /></label>
      <label class="field"><span>N°</span><input type="text" id="mo-numero" value="${esc(String(r.id))}" /></label>
      <label class="field"><span>Cargo</span><input type="text" id="mo-cargo" placeholder="Ej. Operario de empaque" /></label>
      <label class="field full"><span>Empresa</span><input type="text" id="mo-empresa" placeholder="Ej. Empresa XYZ S.A.S." /></label>
      <label class="field full"><span>Asunto</span><input type="text" id="mo-asunto" value="${esc(asuntoAuto)}" /></label>
      <label class="field full"><span>Mensaje</span>
        <textarea id="mo-mensaje" rows="10" style="width:100%;min-height:200px;font:inherit">${esc(mensajeAuto)}</textarea>
      </label>
    </div>
    <div class="actions">
      <button class="btn" id="mo-descargar" type="button">⬇ Descargar Word</button>
      <button class="btn secondary" id="mo-cancel" type="button">Cancelar</button>
    </div>
  </div>`;
  const close = () => (m.innerHTML = '');
  $('#mo-cancel').onclick = close;
  m.onclick = (e) => { if (e.target === m) close(); };
  $('#mo-descargar').onclick = async () => {
    const btn = $('#mo-descargar');
    btn.disabled = true;
    try {
      const blob = await api('/api/reports/' + r.id + '/memorando', {
        method: 'POST',
        body: {
          nombre: $('#mo-nombre').value,
          fecha: $('#mo-fecha').value,
          numero: $('#mo-numero').value,
          cargo: $('#mo-cargo').value,
          empresa: $('#mo-empresa').value,
          asunto: $('#mo-asunto').value,
          mensaje: $('#mo-mensaje').value,
        },
        raw: true,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Memorando-${r.id}${limpio(r.referencia) ? '-' + limpio(r.referencia).replace(/[^\w-]+/g, '') : ''}.docx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      toast('Memorando descargado');
    } catch (e) { toast(e.message, 'err'); }
    btn.disabled = false;
  };
}

/* ============ ROUTER ============ */
async function route() {
  const hash = location.hash || '#/';
  const path = hash.slice(2).split('?')[0];

  if (path === '') {
    charts.forEach((c) => c.destroy()); charts = [];
    return renderHome();
  }

  const want = path === 'pqr' ? 'pqr' : 'nc';
  if (MODULE !== want) {
    MODULE = want; USER = null; META = null;
  }
  if (!TOKEN) loadToken();

  if (!USER && TOKEN) {
    try {
      const me = await api('/api/auth/me');
      USER = me.user;
      if (MODULE === 'nc') META = await api('/api/reports/meta');
    } catch {
      setToken(''); USER = null;
    }
  }

  if (path === 'login') {
    charts.forEach((c) => c.destroy()); charts = [];
    if (USER && USER.app === 'nc') { location.hash = '#/dashboard'; return; }
    return renderLogin({ app: 'nc' });
  }
  if (path === 'pqr') {
    charts.forEach((c) => c.destroy()); charts = [];
    if (USER && USER.app === 'pqr') return renderPqrApp();
    return renderLogin({ app: 'pqr' });
  }
  if (!USER) return renderLogin({ app: 'nc' });
  if (USER.app !== 'nc') { location.hash = '#/pqr'; return; }

  if (path === 'dashboard' || path === '') return renderDashboard();
  if (path === 'novedades') return renderList();
  if (path === 'novedades/nueva') return renderForm(null);
  let m;
  if ((m = path.match(/^novedades\/(\d+)\/editar$/))) return renderForm(m[1]);
  if ((m = path.match(/^novedades\/(\d+)$/))) return renderDetail(m[1]);
  if (path === 'usuarios') {
    if (USER.role === 'gestion') { location.hash = '#/gestion/usuarios'; return; }
    return renderUsuarios();
  }
  if (path.startsWith('gestion')) {
    if (USER.role !== 'gestion') { location.hash = '#/novedades'; return; }
    return renderGestion(path.split('/')[1] || 'usuarios');
  }
  location.hash = '#/dashboard';
}

window.addEventListener('hashchange', () => route().catch((e) => {
  if (e && !/Sesión|401/.test(e.message)) toast(e.message, 'err');
}));
route().catch((e) => toast(e.message, 'err'));
