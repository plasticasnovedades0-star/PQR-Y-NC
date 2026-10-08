const fs = require('fs');
const path = require('path');
const { DATA_DIR, db } = require('../db');

const CFG_FILE = path.join(DATA_DIR, 'elemental-config.json');
const WO_CACHE = path.join(DATA_DIR, 'workorders-cache.json');

const DEFAULTS = {
  enabled: true,
  baseUrl: 'http://192.168.2.119',
  username: '',
  password: '',
  timeoutMs: 15000,
  woTtlHours: 12,
};

function loadConfig() {
  try {
    if (fs.existsSync(CFG_FILE)) return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(CFG_FILE, 'utf8')) };
  } catch (e) {
    console.error('[elemental] Error leyendo configuración:', e.message);
  }
  return { ...DEFAULTS };
}

function saveConfig(cfg) {
  const merged = { ...DEFAULTS, ...cfg };
  fs.writeFileSync(CFG_FILE, JSON.stringify(merged, null, 2), 'utf8');
  return merged;
}

let tokenCache = { token: null, exp: 0 };

async function http(url, opts = {}, cfg) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeoutMs || cfg.timeoutMs || 15000);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    const text = await res.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    if (!res.ok) {
      const msg = (body && (body.exceptionMessage || body.message)) || `HTTP ${res.status}`;
      const err = new Error(msg);
      err.status = res.status;
      throw err;
    }
    return body;
  } finally {
    clearTimeout(t);
  }
}

async function getToken(cfg) {
  if (tokenCache.token && Date.now() < tokenCache.exp) return tokenCache.token;
  if (!cfg.username || !cfg.password) {
    throw new Error('Credenciales de Elemental no configuradas.');
  }
  const body = new URLSearchParams({
    grant_type: 'password',
    username: cfg.username,
    password: cfg.password,
  });
  const data = await http(`${cfg.baseUrl.replace(/\/$/, '')}/api/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
    timeoutMs: 20000,
  }, cfg);
  if (!data || !data.access_token) throw new Error('Elemental no devolvió token.');
  const expSec = Number(data.expires_in) || 86400;
  tokenCache = { token: data.access_token, exp: Date.now() + (expSec - 60) * 1000 };
  return tokenCache.token;
}

async function elemGet(apiPath, cfg, extraQuery = {}, timeoutMs) {
  const base = cfg.baseUrl.replace(/\/$/, '');
  const token = await getToken(cfg);
  const url = new URL(`${base}/api/api${apiPath}`);
  Object.entries(extraQuery).forEach(([k, v]) => url.searchParams.set(k, v));
  try {
    return await http(url.toString(), {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      timeoutMs,
    }, cfg);
  } catch (e) {
    if (e.status === 401) {
      tokenCache = { token: null, exp: 0 };
      const t2 = await getToken(cfg);
      return await http(url.toString(), {
        method: 'GET',
        headers: { Authorization: `Bearer ${t2}`, Accept: 'application/json' },
        timeoutMs,
      }, cfg);
    }
    throw e;
  }
}

/* ---------- Operarios ---------- */

let employeesCache = { at: 0, items: null };

async function getEmployees(cfg) {
  if (employeesCache.items && Date.now() - employeesCache.at < 5 * 60 * 1000) {
    return employeesCache.items;
  }
  const items = await elemGet('/employees', cfg);
  const arr = Array.isArray(items) ? items : [];
  employeesCache = { at: Date.now(), items: arr };
  return arr;
}

function normCode(s) {
  return String(s || '').toUpperCase().replace(/^CH/, '').replace(/[^A-Z0-9]/g, '');
}

async function findOperario(codigo) {
  const cfg = loadConfig();
  if (!cfg.enabled) return { source: 'NONE', codigo, nombre: '', warning: 'Consulta Elemental deshabilitada.' };
  const want = normCode(codigo);
  if (!want) return { source: 'NONE', codigo, nombre: '', warning: 'Debe indicar el código del operario.' };
  try {
    const emps = await getEmployees(cfg);
    const hit = emps.find((e) => normCode(e.integrationId) === want)
      || emps.find((e) => normCode(e.integrationId) === want.padStart(3, '0'))
      || emps.find((e) => want.length >= 3 && normCode(e.integrationId) === want.padStart(4, '0'));
    if (hit) {
      return { source: 'ELEMENTAL', codigo: String(codigo).trim(), nombre: String(hit.fullName || '').trim(), integrationId: hit.integrationId };
    }
    return { source: 'NONE', codigo: String(codigo).trim(), nombre: '', warning: 'Código no encontrado en Elemental.' };
  } catch (e) {
    return { source: 'NONE', codigo: String(codigo).trim(), nombre: '', warning: `No fue posible consultar Elemental: ${e.message}` };
  }
}

async function searchOperarios(q) {
  const cfg = loadConfig();
  if (!cfg.enabled) return { source: 'NONE', items: [], warning: 'Consulta Elemental deshabilitada.' };
  q = String(q || '').trim();
  try {
    const emps = await getEmployees(cfg);
    const nq = normCode(q);
    const nqDigits = q.replace(/\D/g, '');
    const items = emps
      .map((e) => ({
        codigo: normCode(e.integrationId),
        nombre: String(e.fullName || '').trim(),
        integrationId: String(e.integrationId || '').trim(),
      }))
      .filter((e) => e.codigo || e.nombre)
      .filter((e) => {
        if (!q) return true;
        if (nq && e.codigo === nq) return true;
        if (nqDigits && e.codigo.replace(/\D/g, '') === nqDigits) return true;
        return e.nombre.toUpperCase().includes(q.toUpperCase());
      })
      .slice(0, 50);
    return { source: 'ELEMENTAL', items };
  } catch (e) {
    return { source: 'NONE', items: [], warning: `No fue posible consultar Elemental: ${e.message}` };
  }
}

/* ---------- Órdenes de fabricación (padre / hijos) ---------- */

let woCache = { at: 0, rows: null, index: null, children: null };

function buildIndexes(rows) {
  const index = new Map();
  const children = new Map();
  rows.forEach((w) => {
    if (!w || !w.workOrderId) return;
    index.set(w.workOrderId, w);
    if (w.workOrderType === 1 && w.workOrderId.includes('-')) {
      const p = w.workOrderId.split('-')[0];
      if (!children.has(p)) children.set(p, []);
      children.get(p).push(w);
    }
  });
  children.forEach((arr) => arr.sort((a, b) => String(a.workOrderId).localeCompare(String(b.workOrderId), undefined, { numeric: true })));
  return { index, children };
}

async function loadWorkOrders(cfg, { refresh = false, timeoutMs } = {}) {
  const ttl = (cfg.woTtlHours || 12) * 3600 * 1000;
  if (!refresh && woCache.rows && Date.now() - woCache.at < ttl) return woCache;

  if (!refresh && woCache.rows && Date.now() - woCache.at < ttl * 4) {
    refreshWorkOrders(cfg).catch(() => {});
    return woCache;
  }

  if (!refresh) {
    try {
      if (fs.existsSync(WO_CACHE)) {
        const st = fs.statSync(WO_CACHE);
        const raw = JSON.parse(fs.readFileSync(WO_CACHE, 'utf8'));
        if (Array.isArray(raw.rows) && raw.rows.length && Date.now() - st.mtimeMs < ttl * 4) {
          const idx = buildIndexes(raw.rows);
          woCache = { at: st.mtimeMs, rows: raw.rows, ...idx };
          refreshWorkOrders(cfg).catch(() => {});
          return woCache;
        }
      }
    } catch (e) {
      console.error('[elemental] Cache de órdenes ilegible:', e.message);
    }
  }

  return await refreshWorkOrders(cfg, timeoutMs);
}

async function refreshWorkOrders(cfg, timeoutMs = 90000) {
  const rows = await elemGet('/workOrders', cfg, {}, timeoutMs);
  if (!Array.isArray(rows) || !rows.length) throw new Error('Elemental devolvió una lista de órdenes vacía.');
  const idx = buildIndexes(rows);
  woCache = { at: Date.now(), rows, ...idx };
  try {
    fs.writeFileSync(WO_CACHE, JSON.stringify({ fetchedAt: new Date().toISOString(), rows }), 'utf8');
  } catch (e) {
    console.error('[elemental] No se pudo guardar cache de órdenes:', e.message);
  }
  return woCache;
}

function dateOnly(s) {
  return s ? String(s).slice(0, 10) : null;
}

function ofRow(w) {
  return {
    orden: w.workOrderId,
    producto: w.productName || '',
    producto_codigo: w.productId != null ? String(w.productId) : '',
    cantidad_programada: w.programedQty,
    fecha_inicio: dateOnly(w.startDate),
    fecha_inicio_raw: w.startDate || null,
    fecha_fin: dateOnly(w.endDate),
    fecha_fin_raw: w.endDate || null,
    estado: w.status,
    tipo: w.workOrderType === 1 ? 'HIJA' : 'PADRE',
  };
}

async function lookupOf(orden, { refresh = false } = {}) {
  orden = String(orden || '').trim();
  if (!orden) throw new Error('Debe indicar la orden de fabricación.');
  const cfg = loadConfig();
  if (!cfg.enabled) throw new Error('Consulta Elemental deshabilitada.');

  const cache = await loadWorkOrders(cfg, { refresh });
  const base = orden.includes('-') ? orden.split('-')[0] : orden;

  const padre = cache.index.get(base) || cache.index.get(orden) || null;
  const hijos = cache.children.get(base) || [];
  if (!padre && !hijos.length) {
    return {
      source: 'ELEMENTAL', orden, encontrado: false, padre: null, hijos: [], operarios: [],
      warning: `No se encontró la orden ${orden} en Elemental.`,
    };
  }

  let operarios = [];
  let operariosWarning = null;
  try {
    const rows = await elemGet('/vWorkOrderReportByEmployeesOperations', cfg, {
      $filter: `substringof('${orden.replace(/'/g, "''")}',workOrder)`,
    });
    const seen = new Map();
    (Array.isArray(rows) ? rows : []).forEach((r) => {
      const wo = String(r.workOrder || '');
      if (wo !== orden && !wo.startsWith(orden + '-') && wo !== base && !wo.startsWith(base + '-')) return;
      const codigo = normCode(r.employeeIntegrationId);
      if (!codigo) return;
      const prev = seen.get(codigo);
      const total = Number(r.totalTime) || 0;
      if (!prev || total > prev.total) {
        seen.set(codigo, {
          codigo,
          nombre: String(r.employeeFullName || '').trim(),
          integrationId: r.employeeIntegrationId,
          total,
        });
      }
    });
    operarios = [...seen.values()].map(({ codigo, nombre, integrationId }) => ({ codigo, nombre, integrationId }));
    if (padre) {
      try {
        db.prepare(
          'INSERT INTO of_lookups (orden, fecha, fuente, total_operarios, raw) VALUES (?, ?, ?, ?, ?)'
        ).run(orden, dateOnly(padre.startDate) || '', 'ELEMENTAL', operarios.length, JSON.stringify(operarios).slice(0, 20000));
      } catch { /* auditoría best-effort */ }
    }
  } catch (e) {
    operariosWarning = `No se pudieron consultar los operarios de la OF: ${e.message}`;
  }

  return {
    source: 'ELEMENTAL',
    orden,
    base,
    encontrado: true,
    padre: padre ? ofRow(padre) : null,
    hijos: hijos.map(ofRow),
    operarios,
    operariosWarning,
  };
}

module.exports = {
  loadConfig, saveConfig, findOperario, searchOperarios, lookupOf, refreshWorkOrders,
};
