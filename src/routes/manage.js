const express = require('express');
const bcrypt = require('bcryptjs');
const { db, getCatalog } = require('../db');
const { requireAuth, requireRole } = require('../auth');
const { lookup } = require('../services/apiConnector');
const { loadConfig, saveConfig } = require('../apiConfig');
const elemental = require('../services/elemental');

const router = express.Router();
router.use(requireAuth);

router.get('/catalog', (req, res) => {
  res.json({ tipos: getCatalog('tipo'), areas: getCatalog('area'), turnos: getCatalog('turno') });
});

router.post('/catalog', requireRole('gestion'), (req, res) => {
  const { clave, valor } = req.body || {};
  if (!['tipo', 'area', 'turno'].includes(clave)) return res.status(400).json({ error: 'Clave inválida' });
  if (!valor || !String(valor).trim()) return res.status(400).json({ error: 'Valor requerido' });
  db.prepare('INSERT OR IGNORE INTO catalog (clave, valor) VALUES (?, ?)').run(clave, String(valor).trim());
  res.json({ ok: true, valores: getCatalog(clave) });
});

router.delete('/catalog/:clave/:valor', requireRole('gestion'), (req, res) => {
  const { clave, valor } = req.params;
  if (!['tipo', 'area', 'turno'].includes(clave)) return res.status(400).json({ error: 'Clave inválida' });
  db.prepare('DELETE FROM catalog WHERE clave = ? AND valor = ?').run(clave, valor);
  res.json({ ok: true, valores: getCatalog(clave) });
});

router.get('/operators', (req, res) => {
  const { q } = req.query;
  let rows;
  if (q) {
    rows = db
      .prepare('SELECT * FROM operators WHERE codigo LIKE ? OR nombre LIKE ? ORDER BY nombre LIMIT 200')
      .all(`%${q}%`, `%${q}%`);
  } else {
    rows = db.prepare('SELECT * FROM operators ORDER BY nombre LIMIT 500').all();
  }
  res.json({ items: rows });
});

router.post('/operators', requireRole('gestion'), (req, res) => {
  const { codigo, nombre } = req.body || {};
  if (!codigo || !nombre) return res.status(400).json({ error: 'Código y nombre requeridos' });
  db.prepare(`
    INSERT INTO operators (codigo, nombre) VALUES (?, ?)
    ON CONFLICT(codigo) DO UPDATE SET nombre = excluded.nombre, activo = 1, updated_at = datetime('now')
  `).run(String(codigo).trim(), String(nombre).trim());
  res.status(201).json({ ok: true });
});

router.delete('/operators/:id', requireRole('gestion'), (req, res) => {
  db.prepare('UPDATE operators SET activo = 0, updated_at = datetime(\'now\') WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

router.get('/lookup-operarios', async (req, res) => {
  try {
    const result = await lookup({ orden: req.query.orden, fecha: req.query.fecha });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: `Error consultando operarios: ${e.message}` });
  }
});

router.get('/elemental-operario', async (req, res) => {
  try {
    res.json(await elemental.findOperario(req.query.codigo));
  } catch (e) {
    res.status(500).json({ error: `Error consultando operario: ${e.message}` });
  }
});

router.get('/elemental-operarios', async (req, res) => {
  try {
    res.json(await elemental.searchOperarios(req.query.q));
  } catch (e) {
    res.status(500).json({ error: `Error buscando operarios: ${e.message}` });
  }
});

router.get('/elemental-of', async (req, res) => {
  try {
    res.json(await elemental.lookupOf(req.query.orden, { refresh: req.query.refresh === '1' }));
  } catch (e) {
    res.status(500).json({ error: `Error consultando la OF: ${e.message}` });
  }
});

router.post('/elemental-refresh', requireRole('gestion'), async (req, res) => {
  try {
    const cache = await elemental.refreshWorkOrders(elemental.loadConfig());
    res.json({ ok: true, total: cache.rows.length });
  } catch (e) {
    res.status(500).json({ error: `Error refrescando órdenes: ${e.message}` });
  }
});

router.get('/elemental-config', requireRole('gestion'), (req, res) => {
  const cfg = elemental.loadConfig();
  res.json({ ...cfg, password: cfg.password ? '********' : '' });
});

router.put('/elemental-config', requireRole('gestion'), (req, res) => {
  const b = req.body || {};
  const prev = elemental.loadConfig();
  const cfg = elemental.saveConfig({
    enabled: b.enabled !== false,
    baseUrl: b.baseUrl || prev.baseUrl,
    username: b.username !== undefined ? String(b.username).trim() : prev.username,
    password: b.password === '********' || !b.password ? prev.password : String(b.password),
    timeoutMs: Math.min(Math.max(Number(b.timeoutMs) || 15000, 1000), 120000),
    woTtlHours: Math.min(Math.max(Number(b.woTtlHours) || 12, 1), 168),
  });
  res.json({ ...cfg, password: cfg.password ? '********' : '' });
});

router.get('/api-config', requireRole('gestion'), (req, res) => {
  const cfg = loadConfig();
  res.json(cfg);
});

router.put('/api-config', requireRole('gestion'), (req, res) => {
  const b = req.body || {};
  if (b.enabled && (!b.baseUrl || !/^https?:\/\//.test(b.baseUrl))) {
    return res.status(400).json({ error: 'baseUrl debe ser una URL http(s) válida para habilitar la consulta.' });
  }
  const cfg = saveConfig({
    enabled: !!b.enabled,
    baseUrl: b.baseUrl || '',
    path: b.path || '/ordenes/{orden}',
    method: ['GET', 'POST'].includes(b.method) ? b.method : 'GET',
    query: b.query && typeof b.query === 'object' ? b.query : {},
    headers: b.headers && typeof b.headers === 'object' ? b.headers : {},
    timeoutMs: Math.min(Math.max(Number(b.timeoutMs) || 8000, 1000), 60000),
    map: {
      root: b.map?.root ?? '',
      operarios: b.map?.operarios ?? 'operarios',
      codigo: b.map?.codigo ?? 'codigo',
      nombre: b.map?.nombre ?? 'nombre',
    },
    fallbackLocal: b.fallbackLocal !== false,
  });
  res.json(cfg);
});

router.get('/lookups', requireRole('gestion'), (req, res) => {
  const rows = db
    .prepare('SELECT id, orden, fecha, fuente, total_operarios, created_at FROM of_lookups ORDER BY id DESC LIMIT 50')
    .all();
  res.json({ items: rows });
});

router.get('/users', requireRole('gestion'), (req, res) => {
  const rows = db
    .prepare('SELECT id, username, full_name, role, active, created_at FROM users ORDER BY username')
    .all();
  res.json({ items: rows });
});

router.post('/users', requireRole('gestion'), (req, res) => {
  const { username, password, full_name, role } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
  if (String(password).length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
  if (!['reporte', 'gestion'].includes(role)) return res.status(400).json({ error: 'Rol inválido (reporte o gestion)' });
  try {
    db.prepare('INSERT INTO users (username, password_hash, full_name, role) VALUES (?, ?, ?, ?)').run(
      String(username).trim(),
      bcrypt.hashSync(password, 10),
      String(full_name || '').trim(),
      role
    );
    res.status(201).json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message.includes('UNIQUE') ? 'El usuario ya existe' : e.message });
  }
});

router.put('/users/:id', requireRole('gestion'), (req, res) => {
  const { full_name, role, active, password } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
  if (role && !['reporte', 'gestion'].includes(role)) return res.status(400).json({ error: 'Rol inválido' });
  if (active === false && user.id === req.user.id) return res.status(400).json({ error: 'No puede desactivarse a sí mismo' });
  if (password) {
    if (String(password).length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(password, 10), user.id);
  }
  db.prepare('UPDATE users SET full_name = ?, role = ?, active = ? WHERE id = ?').run(
    full_name !== undefined ? String(full_name).trim() : user.full_name,
    role || user.role,
    active !== undefined ? (active ? 1 : 0) : user.active,
    user.id
  );
  res.json({ ok: true });
});

module.exports = { router };
