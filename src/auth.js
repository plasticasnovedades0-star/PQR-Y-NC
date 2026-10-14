const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { db, DATA_DIR } = require('./db');

const SECRET_FILE = path.join(DATA_DIR, 'jwt-secret');
function getSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  if (!fs.existsSync(SECRET_FILE)) {
    fs.writeFileSync(SECRET_FILE, crypto.randomBytes(48).toString('hex'), { mode: 0o600 });
  }
  return fs.readFileSync(SECRET_FILE, 'utf8').trim();
}
const SECRET = getSecret();
const COOKIE = 'nc_token';
const TTL = '12h';

function seedModule(app, claves) {
  const n = db.prepare('SELECT COUNT(*) AS n FROM users WHERE app = ?').get(app).n;
  if (n > 0) return;
  const hash = (p) => bcrypt.hashSync(p, 10);
  const ins = db.prepare(
    'INSERT INTO users (username, password_hash, full_name, role, app) VALUES (?, ?, ?, ?, ?)'
  );
  ins.run('gestion', hash(claves.gestion), 'Usuario de Gestión', 'gestion', app);
  ins.run('reporte', hash(claves.reporte), 'Usuario de Reporte', 'reporte', app);
  console.log(`[auth] Usuarios ${app.toUpperCase()} iniciales creados: gestion/${claves.gestion} y reporte/${claves.reporte}`);
}
seedModule('nc', { gestion: 'Gestion2026', reporte: 'Reporte2026' });
seedModule('pqr', { gestion: 'Gestion2026', reporte: 'Reporte2026' });

function sign(user, operator = '') {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role, name: user.full_name, app: user.app || 'nc', operator },
    SECRET,
    { expiresIn: TTL },
  );
}

const normalizeApp = (a) => (a === 'pqr' ? 'pqr' : 'nc');

function setCookie(res, token) {
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 12 * 60 * 60 * 1000,
  });
}

function clearCookie(res) {
  res.clearCookie(COOKIE);
}

function extractToken(req) {
  const h = req.headers.authorization;
  if (h && h.startsWith('Bearer ')) return h.slice(7);
  if (req.cookies && req.cookies[COOKIE]) return req.cookies[COOKIE];
  return null;
}

function requireAuth(req, res, next) {
  const token = extractToken(req);
  if (!token) return res.status(401).json({ error: 'No autenticado' });
  try {
    const payload = jwt.verify(token, SECRET);
    const user = db.prepare('SELECT id, username, full_name, role, active, pending, app FROM users WHERE id = ?').get(payload.id);
    if (!user || !user.active) return res.status(401).json({ error: 'Usuario inactivo o inexistente' });
    if (user.pending) return res.status(401).json({ error: 'Su cuenta está pendiente de aprobación por un usuario de Gestión.' });
    if (normalizeApp(payload.app) !== normalizeApp(user.app)) {
      return res.status(401).json({ error: 'La sesión no corresponde a este módulo. Inicie sesión de nuevo.' });
    }
    req.user = {
      id: user.id,
      username: user.username,
      name: user.full_name,
      role: user.role,
      app: normalizeApp(user.app),
      operator: payload.operator || '',
    };
    next();
  } catch {
    return res.status(401).json({ error: 'Sesión inválida o expirada' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'No autenticado' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'No tiene permisos para esta acción' });
    }
    next();
  };
}

function requireApp(...apps) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'No autenticado' });
    if (!apps.includes(req.user.app)) {
      return res.status(403).json({ error: 'Este módulo no corresponde a su sesión. Inicie sesión en el módulo correcto.' });
    }
    next();
  };
}

const attempts = new Map();
const LOCK_MS = 5 * 60 * 1000;

const ACCESS_FILE = path.join(DATA_DIR, 'access-config.json');
function loadAccess() {
  try {
    const j = JSON.parse(fs.readFileSync(ACCESS_FILE, 'utf8'));
    return { login_mode: 'password', ...j };
  } catch {
    return { login_mode: 'password' };
  }
}
function saveAccess(cfg) {
  fs.writeFileSync(ACCESS_FILE, JSON.stringify(cfg, null, 2));
}

const router = express.Router();

router.get('/access', (req, res) => {
  const cfg = loadAccess();
  const app = normalizeApp(req.query.app);
  const users = db
    .prepare(`SELECT username, full_name, role FROM users
              WHERE active = 1 AND pending = 0 AND app = ?
              ORDER BY CASE role WHEN 'gestion' THEN 0 ELSE 1 END, full_name`)
    .all(app);
  res.json({ login_mode: cfg.login_mode, app, users });
});

router.put('/access', requireAuth, (req, res, next) => {
  if (!req.user || req.user.role !== 'gestion') {
    return res.status(403).json({ error: 'No tiene permisos para esta acción' });
  }
  const { login_mode } = req.body || {};
  if (!['usuarios', 'password'].includes(login_mode)) {
    return res.status(400).json({ error: 'Modo de acceso inválido' });
  }
  saveAccess({ ...loadAccess(), login_mode });
  res.json({ ok: true, login_mode });
});

router.post('/login', (req, res) => {
  const { username, password, operator, app: appBody } = req.body || {};
  const app = normalizeApp(appBody);
  const cfg = loadAccess();
  if (!username || !String(username).trim()) {
    return res.status(400).json({ error: 'Seleccione un usuario' });
  }
  const hasPass = password !== undefined && password !== null && String(password) !== '';
  const opName = String(operator || '').trim();

  if (cfg.login_mode !== 'usuarios') {
    if (!hasPass) return res.status(400).json({ error: 'Contraseña requerida' });
    if (!opName) return res.status(400).json({ error: 'Escriba su nombre para registrar el acceso' });
  }

  const key = app + ':' + String(username).toLowerCase();
  const att = attempts.get(key);
  if (hasPass && att && att.until > Date.now()) {
    return res.status(429).json({ error: 'Demasiados intentos. Espere 5 minutos.' });
  }

  const user = db.prepare('SELECT * FROM users WHERE app = ? AND username = ? COLLATE NOCASE').get(app, username);
  if (user && user.active && user.pending) {
    return res.status(403).json({ error: 'Su cuenta está pendiente de aprobación. Un usuario de Gestión debe aprobarla.' });
  }
  const ok = user && user.active && !user.pending && (!hasPass || bcrypt.compareSync(String(password), user.password_hash));
  if (!ok) {
    if (hasPass) {
      const n = (att && att.count) || 0;
      attempts.set(key, { count: n + 1, until: n + 4 >= 5 ? Date.now() + LOCK_MS : 0 });
    }
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
  }
  attempts.delete(key);

  const finalOp = opName || user.full_name || user.username;
  const token = sign(user, finalOp);
  setCookie(res, token);
  try {
    db.prepare('INSERT INTO access_log (username, operator, role, ip, app) VALUES (?, ?, ?, ?, ?)')
      .run(user.username, finalOp, user.role, String(req.ip || '').replace('::ffff:', ''), app);
  } catch (e) {
    console.error('[auth:access_log]', e.message);
  }
  res.json({
    token,
    operator: finalOp,
    app,
    user: { id: user.id, username: user.username, name: user.full_name, role: user.role, app, operator: finalOp },
  });
});

router.post('/logout', (req, res) => {
  clearCookie(res);
  res.json({ ok: true });
});

router.post('/register', (req, res) => {
  const { username, password, confirm, full_name, role, app: appBody } = req.body || {};
  const app = normalizeApp(appBody);
  const u = String(username || '').trim();
  const n = String(full_name || '').trim();
  const p = String(password || '');
  const rol = role === 'gestion' ? 'gestion' : 'reporte';

  if (!n || n.length < 3) return res.status(400).json({ error: 'Escriba su nombre completo (mínimo 3 letras).' });
  if (!/^[a-zA-Z0-9._-]{3,20}$/.test(u)) {
    return res.status(400).json({ error: 'El usuario debe tener de 3 a 20 caracteres (letras, números, punto, guion o guion bajo).' });
  }
  if (p.length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres.' });
  if (confirm !== undefined && String(confirm) !== p) {
    return res.status(400).json({ error: 'La confirmación no coincide con la contraseña.' });
  }
  const exists = db.prepare('SELECT id FROM users WHERE app = ? AND username = ? COLLATE NOCASE').get(app, u);
  if (exists) return res.status(409).json({ error: 'Ese nombre de usuario ya existe en este módulo. Elija otro.' });

  const hayCuentas = db.prepare('SELECT COUNT(*) AS n FROM users WHERE app = ?').get(app).n;
  const pendiente = hayCuentas > 0 ? 1 : 0;

  try {
    db.prepare('INSERT INTO users (username, password_hash, full_name, role, active, pending, app) VALUES (?, ?, ?, ?, 1, ?, ?)')
      .run(u, bcrypt.hashSync(p, 10), n, rol, pendiente, app);
  } catch (e) {
    console.error('[auth:register]', e.message);
    return res.status(500).json({ error: 'No se pudo crear el usuario.' });
  }

  const etqMod = app === 'pqr' ? 'PQR' : 'NC';
  const etqRol = rol === 'gestion' ? 'Gestión' : 'Reporte';
  res.status(201).json({
    ok: true,
    app,
    pendiente: !!pendiente,
    role: rol,
    username: u,
    full_name: n,
    mensaje: pendiente
      ? `Cuenta de ${etqRol} creada para "${n}" en el módulo ${etqMod}. Un usuario de Gestión activo debe aprobarla antes de que pueda ingresar.`
      : `Cuenta de ${etqRol} creada para "${n}" en el módulo ${etqMod} y aprobada (era la primera cuenta del módulo).`,
  });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

router.post('/change-password', requireAuth, (req, res) => {
  const { current, next } = req.body || {};
  if (!current || !next || String(next).length < 6) {
    return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 6 caracteres' });
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(current, user.password_hash)) {
    return res.status(401).json({ error: 'Contraseña actual incorrecta' });
  }
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(next, 10), user.id);
  res.json({ ok: true });
});

module.exports = { router, requireAuth, requireRole, requireApp };
