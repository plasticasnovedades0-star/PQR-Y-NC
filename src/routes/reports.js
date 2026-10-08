const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const { db, DATA_DIR, getCatalog } = require('../db');
const { requireAuth, requireRole } = require('../auth');

const router = express.Router();
router.use(requireAuth);

const UPLOADS = path.join(DATA_DIR, 'uploads');
const MAX_PHOTOS = 10;
const MIN_PHOTOS = 3;
const MAX_SIZE = 8 * 1024 * 1024;
const ALLOWED = ['image/jpeg', 'image/png', 'image/gif', 'image/bmp'];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: MAX_PHOTOS, fileSize: MAX_SIZE },
  fileFilter: (req, file, cb) => {
    if (ALLOWED.includes(file.mimetype)) return cb(null, true);
    cb(new Error('FORMATO_IMAGEN'));
  },
});

const FIELDS = [
  'fecha_deteccion', 'area_reporta', 'quien_registra', 'responsable_area',
  'tipo_hallazgo', 'color_parte_error', 'descripcion', 'referencia', 'otra_referencia',
  'orden_fabricacion',
  'operario_nombre', 'operario_codigo', 'turno', 'responsable_tratamiento',
  'accion_tratamiento', 'verificacion_eficacia', 'responsable_cierre', 'fecha_cierre',
  'estado', 'evidencia_original', 'origen_operarios',
];

const ESTADOS = ['ABIERTO', 'EN PROCESO', 'CERRADO'];

function validate(body) {
  const errs = [];
  if (!body.fecha_deteccion || !/^\d{4}-\d{2}-\d{2}$/.test(body.fecha_deteccion)) {
    errs.push('Fecha de detección requerida (formato YYYY-MM-DD).');
  }
  if (!body.color_parte_error || !String(body.color_parte_error).trim()) {
    errs.push('El campo Color o parte con el error es obligatorio.');
  }
  if (!body.area_reporta || !String(body.area_reporta).trim()) {
    errs.push('El área que reporta es obligatoria.');
  }
  if (!body.tipo_hallazgo || !String(body.tipo_hallazgo).trim()) {
    errs.push('El tipo de hallazgo es obligatorio.');
  }
  if (!body.responsable_area || !String(body.responsable_area).trim()) {
    errs.push('El responsable del área es obligatorio.');
  }
  if (!body.turno || !String(body.turno).trim()) {
    errs.push('El turno es obligatorio (o "Sin turno").');
  }
  if (!body.referencia || !String(body.referencia).trim()) {
    errs.push('La referencia / producto es obligatoria.');
  }
  if (!body.orden_fabricacion || !String(body.orden_fabricacion).trim()) {
    errs.push('El N.° de orden de fabricación es obligatorio.');
  }
  if (!String(body.operario_codigo || '').trim() || !String(body.operario_nombre || '').trim()) {
    errs.push('Debe registrar al menos un operario con su código y nombre.');
  }
  if (body.estado && !ESTADOS.includes(body.estado)) errs.push('Estado inválido.');
  if (body.fecha_cierre && !/^\d{4}-\d{2}-\d{2}$/.test(body.fecha_cierre)) errs.push('Fecha de cierre inválida.');
  if (body.fecha_cierre && body.estado !== 'CERRADO') {
    errs.push('La fecha de cierre solo aplica cuando el estado es CERRADO.');
  }
  if (body.estado === 'CERRADO' && !body.fecha_cierre) {
    errs.push('Debe indicar la fecha de cierre al cerrar la novedad.');
  }
  if (body.cantidad != null && body.cantidad !== '' && isNaN(Number(body.cantidad))) {
    errs.push('La cantidad debe ser numérica.');
  }
  return errs;
}

function clean(body) {
  const out = {};
  FIELDS.forEach((f) => {
    if (body[f] !== undefined) out[f] = body[f] == null ? '' : String(body[f]).trim();
  });
  if (body.cantidad !== undefined) {
    out.cantidad = body.cantidad === '' || body.cantidad == null ? null : Number(body.cantidad);
  }
  if (out.fecha_cierre === '') out.fecha_cierre = null;
  if (!out.estado) out.estado = 'ABIERTO';
  return out;
}

function defaults() {
  return {
    fecha_deteccion: '', area_reporta: '', quien_registra: '', responsable_area: '',
    tipo_hallazgo: '', color_parte_error: '', descripcion: '', cantidad: null,
    referencia: '', otra_referencia: '', orden_fabricacion: '', operario_nombre: '', operario_codigo: '',
    turno: '', responsable_tratamiento: '', accion_tratamiento: '',
    verificacion_eficacia: '', responsable_cierre: '', fecha_cierre: null,
    estado: 'ABIERTO', evidencia_original: '', origen_operarios: '', created_by: '',
  };
}

function withPhotos(report) {
  const photos = db
    .prepare('SELECT id, original_name, sort_order FROM photos WHERE report_id = ? ORDER BY sort_order, id')
    .all(report.id)
    .map((p) => ({ ...p, url: `/api/reports/${report.id}/photos/${p.id}` }));
  return { ...report, photos, photo_count: photos.length };
}

const SELECT = 'SELECT * FROM reports';

router.get('/', (req, res) => {
  const { estado, tipo, area, desde, hasta, q, operario, orden, limit, offset } = req.query;
  const where = [];
  const params = [];
  if (estado) { where.push('estado = ?'); params.push(estado); }
  if (tipo) { where.push('tipo_hallazgo = ?'); params.push(tipo); }
  if (area) { where.push('TRIM(area_reporta) = ?'); params.push(area); }
  if (desde) { where.push('fecha_deteccion >= ?'); params.push(desde); }
  if (hasta) { where.push('fecha_deteccion <= ?'); params.push(hasta); }
  if (operario) { where.push('(operario_nombre LIKE ? OR operario_codigo LIKE ?)'); params.push(`%${operario}%`, `%${operario}%`); }
  if (orden) { where.push('orden_fabricacion LIKE ?'); params.push(`%${orden}%`); }
  if (q) {
    where.push('(descripcion LIKE ? OR referencia LIKE ? OR quien_registra LIKE ? OR id LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  const sqlWhere = where.length ? ' WHERE ' + where.join(' AND ') : '';
  const lim = Math.min(Number(limit) || 500, 2000);
  const off = Number(offset) || 0;
  const total = db.prepare('SELECT COUNT(*) AS n FROM reports' + sqlWhere).get(...params).n;
  const rows = db
    .prepare(SELECT + sqlWhere + ' ORDER BY fecha_deteccion DESC, id DESC LIMIT ? OFFSET ?')
    .all(...params, lim, off);
  res.json({ total, items: rows.map(withPhotos) });
});

router.get('/meta', (req, res) => {
  res.json({
    tipos: getCatalog('tipo'),
    areas: getCatalog('area'),
    turnos: getCatalog('turno'),
    estados: ESTADOS,
    max_photos: MAX_PHOTOS,
  });
});

router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM reports WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Novedad no encontrada' });
  const lookups = db
    .prepare('SELECT id, fecha, fuente, total_operarios, created_at FROM of_lookups WHERE orden = ? ORDER BY id DESC LIMIT 5')
    .all(row.orden_fabricacion)
    .filter((l) => l.orden);
  res.json({ ...withPhotos(row), lookups });
});

function canEdit(user, report) {
  if (user.role === 'gestion') return true;
  if (report.estado === 'CERRADO') return false;
  return (report.created_by || '').toLowerCase() === user.username.toLowerCase();
}

router.post('/', (req, res) => {
  upload.array('fotos', MAX_PHOTOS)(req, res, (err) => {
    if (err) {
      const msg = err.message === 'FORMATO_IMAGEN'
        ? 'Solo se permiten imágenes JPG, PNG, GIF o BMP (máx. 10).'
        : err.code === 'LIMIT_FILE_COUNT'
          ? `Máximo ${MAX_PHOTOS} fotos por reporte.`
          : `Error con las imágenes: ${err.message}`;
      return res.status(400).json({ error: msg });
    }
    let body;
    try {
      body = JSON.parse(req.body.data || '{}');
    } catch {
      return res.status(400).json({ error: 'Datos inválidos.' });
    }
    const errs = validate(body);
    if (errs.length) return res.status(400).json({ error: errs.join(' ') });
    if ((req.files || []).length < MIN_PHOTOS) {
      return res.status(400).json({ error: `Debe adjuntar mínimo ${MIN_PHOTOS} fotos de evidencia.` });
    }
    const data = clean(body);
    data.created_by = req.user.username;

    try {
      const info = db
      .prepare(`
        INSERT INTO reports (fecha_deteccion, area_reporta, quien_registra, responsable_area,
          tipo_hallazgo, color_parte_error, descripcion, cantidad, referencia, otra_referencia, orden_fabricacion,
          operario_nombre, operario_codigo, turno, responsable_tratamiento, accion_tratamiento,
          verificacion_eficacia, responsable_cierre, fecha_cierre, estado,
          evidencia_original, origen_operarios, created_by)
        VALUES (@fecha_deteccion, @area_reporta, @quien_registra, @responsable_area,
          @tipo_hallazgo, @color_parte_error, @descripcion, @cantidad, @referencia, @otra_referencia, @orden_fabricacion,
          @operario_nombre, @operario_codigo, @turno, @responsable_tratamiento, @accion_tratamiento,
          @verificacion_eficacia, @responsable_cierre, @fecha_cierre, @estado,
          @evidencia_original, @origen_operarios, @created_by)
      `)
      .run({
        ...defaults(),
        ...data,
        created_by: req.user.username,
      });

    const reportId = Number(info.lastInsertRowid);
    savePhotos(reportId, req.files || []);
    const row = db.prepare('SELECT * FROM reports WHERE id = ?').get(reportId);
    res.status(201).json(withPhotos(row));
    } catch (e) {
      console.error('[reports:post]', e);
      if (!res.headersSent) res.status(500).json({ error: 'Error guardando la novedad.' });
    }
  });
});

function savePhotos(reportId, files) {
  if (!files.length) return;
  const dir = path.join(UPLOADS, String(reportId));
  fs.mkdirSync(dir, { recursive: true });
  const ins = db.prepare(
    'INSERT INTO photos (report_id, filename, original_name, sort_order) VALUES (?, ?, ?, ?)'
  );
  const current = db.prepare('SELECT COUNT(*) AS n FROM photos WHERE report_id = ?').get(reportId).n;
  let sort = current;
  files.forEach((f) => {
    if (sort >= MAX_PHOTOS) return;
    const ext = f.mimetype === 'image/png' ? 'png' : f.mimetype === 'image/gif' ? 'gif'
      : f.mimetype === 'image/bmp' ? 'bmp' : 'jpg';
    const name = `${crypto.randomBytes(10).toString('hex')}.${ext}`;
    fs.writeFileSync(path.join(dir, name), f.buffer);
    ins.run(reportId, name, f.originalname || name, sort);
    sort += 1;
  });
}

router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM reports WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Novedad no encontrada' });
  if (!canEdit(req.user, existing)) {
    return res.status(403).json({ error: 'Solo puede editar novedades abiertas que haya registrado, o cualquier novedad con rol de gestión.' });
  }
  upload.array('fotos', MAX_PHOTOS)(req, res, (err) => {
    if (err) {
      const msg = err.message === 'FORMATO_IMAGEN'
        ? 'Solo se permiten imágenes JPG, PNG, GIF o BMP (máx. 10).'
        : `Error con las imágenes: ${err.message}`;
      return res.status(400).json({ error: msg });
    }
    let body;
    try {
      body = JSON.parse(req.body.data || '{}');
    } catch {
      return res.status(400).json({ error: 'Datos inválidos.' });
    }
    const merged = { ...existing, ...body };
    const errs = validate(merged);
    if (errs.length) return res.status(400).json({ error: errs.join(' ') });
    const data = clean(merged);

    const photoCount = db.prepare('SELECT COUNT(*) AS n FROM photos WHERE report_id = ?').get(existing.id).n;
    const incoming = (req.files || []).length;
    if (photoCount + incoming > MAX_PHOTOS) {
      return res.status(400).json({ error: `Máximo ${MAX_PHOTOS} fotos por reporte (tiene ${photoCount} y envió ${incoming}).` });
    }
    if (photoCount + incoming < MIN_PHOTOS) {
      return res.status(400).json({ error: `Debe quedar con mínimo ${MIN_PHOTOS} fotos de evidencia (tiene ${photoCount}).` });
    }

    try {
      db.prepare(`
      UPDATE reports SET
        fecha_deteccion=@fecha_deteccion, area_reporta=@area_reporta, quien_registra=@quien_registra,
        responsable_area=@responsable_area, tipo_hallazgo=@tipo_hallazgo, color_parte_error=@color_parte_error,
        descripcion=@descripcion,
        cantidad=@cantidad, referencia=@referencia, otra_referencia=@otra_referencia,
        orden_fabricacion=@orden_fabricacion,
        operario_nombre=@operario_nombre, operario_codigo=@operario_codigo, turno=@turno,
        responsable_tratamiento=@responsable_tratamiento, accion_tratamiento=@accion_tratamiento,
        verificacion_eficacia=@verificacion_eficacia, responsable_cierre=@responsable_cierre,
        fecha_cierre=@fecha_cierre, estado=@estado, evidencia_original=@evidencia_original,
        origen_operarios=@origen_operarios, updated_at=datetime('now')
      WHERE id=@id
    `).run({ ...defaults(), ...data, id: existing.id });

      savePhotos(existing.id, req.files || []);
      const row = db.prepare('SELECT * FROM reports WHERE id = ?').get(existing.id);
      res.json(withPhotos(row));
    } catch (e) {
      console.error('[reports:put]', e);
      if (!res.headersSent) res.status(500).json({ error: 'Error actualizando la novedad.' });
    }
  });
});

router.delete('/:id', requireRole('gestion'), (req, res) => {
  const existing = db.prepare('SELECT * FROM reports WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Novedad no encontrada' });
  db.prepare('DELETE FROM reports WHERE id = ?').run(existing.id);
  const dir = path.join(UPLOADS, String(existing.id));
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  res.json({ ok: true });
});

router.delete('/:id/photos/:photoId', (req, res) => {
  const existing = db.prepare('SELECT * FROM reports WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Novedad no encontrada' });
  if (!canEdit(req.user, existing)) return res.status(403).json({ error: 'Sin permisos para modificar este reporte' });
  const photo = db.prepare('SELECT * FROM photos WHERE id = ? AND report_id = ?').get(req.params.photoId, existing.id);
  if (!photo) return res.status(404).json({ error: 'Foto no encontrada' });
  db.prepare('DELETE FROM photos WHERE id = ?').run(photo.id);
  const file = path.join(UPLOADS, String(existing.id), photo.filename);
  if (fs.existsSync(file)) fs.unlinkSync(file);
  res.json({ ok: true });
});

router.get('/:id/photos/:photoId', (req, res) => {
  const photo = db
    .prepare('SELECT * FROM photos WHERE id = ? AND report_id = ?')
    .get(req.params.photoId, req.params.id);
  if (!photo) return res.status(404).json({ error: 'Foto no encontrada' });
  const file = path.join(UPLOADS, String(req.params.id), photo.filename);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'Archivo no encontrado' });
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.sendFile(file);
});

module.exports = { router, MAX_PHOTOS };
