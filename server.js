const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');

const { router: authRouter, requireAuth } = require('./src/auth');
const { router: reportsRouter } = require('./src/routes/reports');
const { router: manageRouter } = require('./src/routes/manage');
const { router: indicatorsRouter } = require('./src/routes/indicators');
const { router: exportRouter } = require('./src/routes/export');

const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

process.on('uncaughtException', (e) => {
  console.error('[fatal] excepción no capturada:', e && e.stack || e);
});
process.on('unhandledRejection', (e) => {
  console.error('[fatal] promesa rechazada:', e && e.stack || e);
});

app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());

app.use('/api/auth', authRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/manage', manageRouter);
app.use('/api/indicators', indicatorsRouter);
app.use('/api/export', exportRouter);

app.get('/api/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

app.use(express.static(PUBLIC_DIR));
app.get(/^\/(?!api\/).*/, (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.use((err, req, res, next) => {
  console.error('[error]', err.message);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Error interno del servidor' });
});

app.listen(PORT, () => {
  console.log(`[nc] Servidor de Gestión NC escuchando en http://localhost:${PORT}`);
  console.log('[nc] Inicie sesión con: gestion / Gestion2026  ó  reporte / Reporte2026');
});
