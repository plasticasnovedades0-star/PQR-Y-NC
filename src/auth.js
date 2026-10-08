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

function seedUsers() {
  const count = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  if (count > 0) return;
  const hash = (p) => bcrypt.hashSync(p, 10);
  const ins = db.prepare(
    'INSERT INTO users (username, password_hash, full_name, role) VALUES (?, ?, ?, ?)'
  );
  ins.run('gestion', hash('Gestion2026'), 'Usuario de Gestión', 'gestion');
  ins.run('reporte', hash('Reporte2026'), 'Usuario de Reporte', 'reporte');
  console.log('[auth] Usuarios iniciales creados: gestion/Gestion2026 y reporte/Reporte2026');
}
seedUsers();

function sign(user) {
  return jwt.sign({ id: user.id, username: user.username, role: user.role, name: user.full_name }, SECRET, {
    expiresIn: TTL,
  });
}

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
    const user = db.prepare('SELECT id, username, full_name, role, active FROM users WHERE id = ?').get(payload.id);
    if (!user || !user.active) return res.status(401).json({ error: 'Usuario inactivo o inexistente' });
    req.user = { id: user.id, username: user.username, name: user.full_name, role: user.role };
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

const attempts = new Map();
const LOCK_MS = 5 * 60 * 1000;

const router = express.Router();

router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Usuario y contraseña requeridos' });

  const key = String(username).toLowerCase();
  const att = attempts.get(key);
  if (att && att.until > Date.now()) {
    return res.status(429).json({ error: 'Demasiados intentos. Espere 5 minutos.' });
  }

  const user = db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(username);
  const ok = user && user.active && bcrypt.compareSync(password, user.password_hash);
  if (!ok) {
    const n = (att && att.count) || 0;
    attempts.set(key, { count: n + 1, until: n + 4 >= 5 ? Date.now() + LOCK_MS : 0 });
    return res.status(401).json({ error: 'Credenciales incorrectas' });
  }
  attempts.delete(key);
  const token = sign(user);
  setCookie(res, token);
  res.json({
    token,
    user: { id: user.id, username: user.username, name: user.full_name, role: user.role },
  });
});

router.post('/logout', (req, res) => {
  clearCookie(res);
  res.json({ ok: true });
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

module.exports = { router, requireAuth, requireRole };
