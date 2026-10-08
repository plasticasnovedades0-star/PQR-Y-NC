const { loadConfig, getByPath } = require('../apiConfig');
const { db } = require('../db');

function fill(tpl, vars) {
  return String(tpl || '').replace(/\{(\w+)\}/g, (_, k) =>
    vars[k] !== undefined && vars[k] !== null ? encodeURIComponent(vars[k]) : ''
  );
}

async function fetchJson(url, cfg) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), cfg.timeoutMs || 8000);
  try {
    const res = await fetch(url, {
      method: cfg.method || 'GET',
      headers: { Accept: 'application/json', ...(cfg.headers || {}) },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

function normalizeOperators(raw, cfg) {
  const root = getByPath(raw, cfg.map?.root ?? '');
  let arr = getByPath(root, cfg.map?.operarios ?? 'operarios');
  if (!Array.isArray(arr)) {
    if (Array.isArray(root)) arr = root;
    else if (Array.isArray(raw)) arr = raw;
    else arr = [];
  }
  return arr
    .map((it) => ({
      codigo: String(getByPath(it, cfg.map?.codigo ?? 'codigo') ?? '').trim(),
      nombre: String(getByPath(it, cfg.map?.nombre ?? 'nombre') ?? '').trim(),
      extra: it,
    }))
    .filter((o) => o.codigo || o.nombre);
}

function cacheOperators(orden, operarios, fuente) {
  const up = db.prepare(`
    INSERT INTO operators (codigo, nombre, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(codigo) DO UPDATE SET nombre = excluded.nombre, activo = 1, updated_at = datetime('now')
  `);
  const tx = db.transaction(() => {
    operarios.forEach((o) => {
      if (o.codigo && o.nombre) up.run(o.codigo, o.nombre);
    });
  });
  tx();
  if (orden) {
    db.prepare(
      'INSERT INTO of_lookups (orden, fecha, fuente, total_operarios, raw) VALUES (?, ?, ?, ?, ?)'
    ).run(orden, '', fuente, operarios.length, JSON.stringify(operarios).slice(0, 20000));
  }
}

function cachedByOrden(orden) {
  const row = db
    .prepare('SELECT raw FROM of_lookups WHERE orden = ? ORDER BY id DESC LIMIT 1')
    .get(orden);
  if (!row) return null;
  try {
    const arr = JSON.parse(row.raw);
    return Array.isArray(arr) ? arr : null;
  } catch {
    return null;
  }
}

async function lookup({ orden, fecha }) {
  orden = String(orden || '').trim();
  fecha = String(fecha || '').trim();
  if (!orden) return { source: 'NONE', orden, fecha, operarios: [], warning: 'Debe indicar la orden de fabricación.' };

  const cfg = loadConfig();
  if (cfg.enabled && cfg.baseUrl) {
    try {
      const base = cfg.baseUrl.replace(/\/$/, '');
      const url = new URL(base + fill(cfg.path, { orden, fecha }));
      Object.entries(cfg.query || {}).forEach(([k, v]) => url.searchParams.set(k, fill(v, { orden, fecha }).replace(/%2F/g, '/')));
      const raw = await fetchJson(url.toString(), cfg);
      const operarios = normalizeOperators(raw, cfg);
      cacheOperators(orden, operarios, 'API');
      if (!operarios.length) {
        return {
          source: 'API',
          orden,
          fecha,
          operarios: [],
          warning: 'La API respondió pero no se encontraron operarios con el mapeo configurado.',
        };
      }
      return { source: 'API', orden, fecha, operarios };
    } catch (e) {
      const cached = cfg.fallbackLocal ? cachedByOrden(orden) : null;
      if (cached) {
        return {
          source: 'CACHE',
          orden,
          fecha,
          operarios: cached,
          warning: `La API no respondió (${e.message}). Se usó la última consulta guardada.`,
        };
      }
      return {
        source: 'NONE',
        orden,
        fecha,
        operarios: [],
        warning: `No fue posible consultar la API (${e.message}). Puede digitar los operarios manualmente.`,
      };
    }
  }

  const cached = cfg.fallbackLocal ? cachedByOrden(orden) : null;
  if (cached) return { source: 'CACHE', orden, fecha, operarios: cached };
  return {
    source: 'NONE',
    orden,
    fecha,
    operarios: [],
    warning: 'Consulta automática no configurada. Digite o seleccione los operarios manualmente.',
  };
}

module.exports = { lookup };
