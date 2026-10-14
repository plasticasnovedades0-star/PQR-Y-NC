const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const JSZip = require('jszip');
const { db, DATA_DIR, getCatalog } = require('../db');
const { requireAuth, requireRole, requireApp } = require('../auth');

const router = express.Router();
router.use(requireAuth);
router.use(requireApp('nc'));

const UPLOADS = path.join(DATA_DIR, 'uploads');
const MAX_PHOTOS = 10;
const MIN_PHOTOS = 3;
const MAX_SIZE = 8 * 1024 * 1024;
const ALLOWED = ['image/jpeg', 'image/png', 'image/gif', 'image/bmp'];
const TIPO_EVIDENCIA = 'EVIDENCIA';
const TIPO_TRATAMIENTO = 'TRATAMIENTO';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: MAX_PHOTOS * 2, fileSize: MAX_SIZE },
  fileFilter: (req, file, cb) => {
    if (ALLOWED.includes(file.mimetype)) return cb(null, true);
    cb(new Error('FORMATO_IMAGEN'));
  },
});

function splitFiles(req) {
  const evidencia = [];
  const tratamiento = [];
  for (const f of req.files || []) {
    if (f.fieldname === 'fotos_trat') tratamiento.push(f);
    else evidencia.push(f);
  }
  return { evidencia, tratamiento };
}

function countByTipo(reportId) {
  const rows = db
    .prepare('SELECT tipo, COUNT(*) AS n FROM photos WHERE report_id = ? GROUP BY tipo')
    .all(reportId);
  let evidencia = 0;
  let tratamiento = 0;
  rows.forEach((r) => {
    if (r.tipo === TIPO_TRATAMIENTO) tratamiento += r.n;
    else evidencia += r.n;
  });
  return { evidencia, tratamiento };
}

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
  const rows = db
    .prepare(`SELECT id, original_name, sort_order, tipo FROM photos WHERE report_id = ?
      ORDER BY CASE tipo WHEN 'TRATAMIENTO' THEN 1 ELSE 0 END, sort_order, id`)
    .all(report.id);
  const photos = rows.map((p) => ({
    ...p,
    tipo: p.tipo === TIPO_TRATAMIENTO ? TIPO_TRATAMIENTO : TIPO_EVIDENCIA,
    url: `/api/reports/${report.id}/photos/${p.id}`,
  }));
  const evidencia = photos.filter((p) => p.tipo === TIPO_EVIDENCIA).length;
  const tratamiento = photos.length - evidencia;
  return {
    ...report,
    photos,
    photos_evidencia: photos.filter((p) => p.tipo === TIPO_EVIDENCIA),
    photos_tratamiento: photos.filter((p) => p.tipo === TIPO_TRATAMIENTO),
    photo_count: photos.length,
    photo_count_evid: evidencia,
    photo_count_trat: tratamiento,
  };
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

router.get('/suggestions', (req, res) => {
  const distinct = (col, limit = 30) => db.prepare(`
    SELECT TRIM(${col}) AS v FROM reports
    WHERE TRIM(COALESCE(${col}, '')) <> ''
    GROUP BY TRIM(${col})
    ORDER BY MAX(id) DESC LIMIT ?`).all(limit).map((x) => x.v);
  const ops = db.prepare(`
    SELECT operario_codigo, operario_nombre FROM reports
    WHERE TRIM(COALESCE(operario_codigo, '')) <> '' OR TRIM(COALESCE(operario_nombre, '')) <> ''
    ORDER BY id DESC LIMIT 500`).all();
  const splitNames = (s) => String(s || '').split(/[,;]|\s+-\s+/).map((x) => x.trim()).filter(Boolean);
  const splitCodes = (s) => String(s || '').split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);
  const codSet = new Set();
  const nomSet = new Set();
  ops.forEach((o) => {
    splitCodes(o.operario_codigo).forEach((v) => codSet.add(v));
    splitNames(o.operario_nombre).forEach((v) => nomSet.add(v));
  });
  res.json({
    colores: distinct('color_parte_error'),
    responsables_area: distinct('responsable_area'),
    responsables_trat: distinct('responsable_tratamiento'),
    responsables_cierre: distinct('responsable_cierre'),
    referencias: distinct('referencia', 50),
    ordenes: distinct('orden_fabricacion', 60),
    otra_ref: distinct('otra_referencia'),
    quines: distinct('quien_registra'),
    operario_cod: [...codSet].slice(0, 80),
    operario_nom: [...nomSet].slice(0, 80),
  });
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
  const perm = canDelete(req.user, row);
  res.json({
    ...withPhotos(row),
    lookups,
    puede_eliminar: !!perm.ok,
    motivo_eliminar: perm.ok ? '' : perm.error,
    minutos_restantes: perm.ok && req.user.role !== 'gestion' ? perm.restantes : null,
  });
});

function canEdit(user, report) {
  if (user.role === 'gestion') return true;
  if (report.estado === 'CERRADO') return false;
  return (report.created_by || '').toLowerCase() === user.username.toLowerCase();
}

const DELETE_WINDOW_MIN = 20;

function minutosDesde(report) {
  const row = db.prepare(
    "SELECT CAST(ROUND((julianday('now') - julianday(created_at)) * 24 * 60) AS INTEGER) AS m FROM reports WHERE id = ?"
  ).get(report.id);
  return row && row.m != null ? row.m : 0;
}

function canDelete(user, report) {
  if (user.role === 'gestion') return { ok: true };
  if ((report.created_by || '').toLowerCase() !== user.username.toLowerCase()) {
    return { ok: false, error: 'Solo puede eliminar novedades que usted registró.' };
  }
  const m = minutosDesde(report);
  const restantes = DELETE_WINDOW_MIN - m;
  if (restantes <= 0) {
    return {
      ok: false,
      error: `Tiempo agotado: solo puede eliminar novedades propias dentro de los primeros ${DELETE_WINDOW_MIN} minutos (ya pasaron ${m} min).`,
    };
  }
  return { ok: true, restantes };
}

router.post('/', (req, res) => {
  upload.any()(req, res, (err) => {
    if (err) {
      const msg = err.message === 'FORMATO_IMAGEN'
        ? 'Solo se permiten imágenes JPG, PNG, GIF o BMP (máx. 10).'
        : err.code === 'LIMIT_FILE_COUNT'
          ? `Máximo ${MAX_PHOTOS} fotos por tipo de evidencia.`
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
    const { evidencia, tratamiento } = splitFiles(req);
    if (evidencia.length < MIN_PHOTOS) {
      return res.status(400).json({ error: `Debe adjuntar mínimo ${MIN_PHOTOS} fotos de evidencia.` });
    }
    if (evidencia.length > MAX_PHOTOS || tratamiento.length > MAX_PHOTOS) {
      return res.status(400).json({ error: `Máximo ${MAX_PHOTOS} fotos en cada sección (evidencias y tratamiento).` });
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
    savePhotos(reportId, evidencia, TIPO_EVIDENCIA);
    savePhotos(reportId, tratamiento, TIPO_TRATAMIENTO);
    const row = db.prepare('SELECT * FROM reports WHERE id = ?').get(reportId);
    res.status(201).json(withPhotos(row));
    } catch (e) {
      console.error('[reports:post]', e);
      if (!res.headersSent) res.status(500).json({ error: 'Error guardando la novedad.' });
    }
  });
});

function savePhotos(reportId, files, tipo = TIPO_EVIDENCIA) {
  if (!files.length) return;
  const dir = path.join(UPLOADS, String(reportId));
  fs.mkdirSync(dir, { recursive: true });
  const ins = db.prepare(
    'INSERT INTO photos (report_id, filename, original_name, sort_order, tipo) VALUES (?, ?, ?, ?, ?)'
  );
  const current = db
    .prepare('SELECT COUNT(*) AS n FROM photos WHERE report_id = ? AND tipo = ?')
    .get(reportId, tipo).n;
  let sort = current;
  files.forEach((f) => {
    if (sort >= MAX_PHOTOS) return;
    const ext = f.mimetype === 'image/png' ? 'png' : f.mimetype === 'image/gif' ? 'gif'
      : f.mimetype === 'image/bmp' ? 'bmp' : 'jpg';
    const name = `${crypto.randomBytes(10).toString('hex')}.${ext}`;
    fs.writeFileSync(path.join(dir, name), f.buffer);
    ins.run(reportId, name, f.originalname || name, sort, tipo);
    sort += 1;
  });
}

router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM reports WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Novedad no encontrada' });
  if (!canEdit(req.user, existing)) {
    return res.status(403).json({ error: 'Solo puede editar novedades abiertas que haya registrado, o cualquier novedad con rol de gestión.' });
  }
  upload.any()(req, res, (err) => {
    if (err) {
      const msg = err.message === 'FORMATO_IMAGEN'
        ? 'Solo se permiten imágenes JPG, PNG, GIF o BMP (máx. 10).'
        : err.code === 'LIMIT_FILE_COUNT'
          ? `Máximo ${MAX_PHOTOS} fotos por tipo de evidencia.`
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

    const { evidencia, tratamiento } = splitFiles(req);
    const saved = countByTipo(existing.id);
    const nEvid = saved.evidencia + evidencia.length;
    const nTrat = saved.tratamiento + tratamiento.length;
    if (nEvid > MAX_PHOTOS || nTrat > MAX_PHOTOS) {
      return res.status(400).json({ error: `Máximo ${MAX_PHOTOS} fotos en cada sección (evidencias: ${nEvid}, tratamiento: ${nTrat}).` });
    }
    if (nEvid < MIN_PHOTOS) {
      return res.status(400).json({ error: `Debe quedar con mínimo ${MIN_PHOTOS} fotos de evidencia (tiene ${saved.evidencia}).` });
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

      savePhotos(existing.id, evidencia, TIPO_EVIDENCIA);
      savePhotos(existing.id, tratamiento, TIPO_TRATAMIENTO);
      const row = db.prepare('SELECT * FROM reports WHERE id = ?').get(existing.id);
      res.json(withPhotos(row));
    } catch (e) {
      console.error('[reports:put]', e);
      if (!res.headersSent) res.status(500).json({ error: 'Error actualizando la novedad.' });
    }
  });
});

router.delete('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM reports WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Novedad no encontrada' });
  const perm = canDelete(req.user, existing);
  if (!perm.ok) return res.status(403).json({ error: perm.error });
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

const MEMORANDO_TEMPLATE = path.join(DATA_DIR, '..', 'Base memorando.docx');

const xmlEsc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;');

function cellText(tc) {
  const t = [...tc.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map((x) => x[1]).join('');
  return t.replace(/\s+/g, ' ').trim();
}

function injectCellText(tc, val) {
  const lineas = String(val).split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  if (!lineas.length) return tc;
  const run = (txt) =>
    `<w:r><w:rPr><w:rFonts w:ascii="Calibri Light" w:hAnsi="Calibri Light"/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr><w:t xml:space="preserve">${xmlEsc(txt)}</w:t></w:r>`;
  const idx = tc.indexOf('</w:p>');
  if (idx < 0) return tc;
  let res = tc.slice(0, idx) + run(lineas[0]) + tc.slice(idx);
  if (lineas.length > 1) {
    const paras = lineas
      .slice(1)
      .map((l) => `<w:p><w:pPr><w:spacing w:after="0"/><w:rPr><w:rFonts w:ascii="Calibri Light" w:hAnsi="Calibri Light"/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:pPr>${run(l)}</w:p>`)
      .join('');
    res = res.replace(/<\/w:tc>$/, paras + '</w:tc>');
  }
  return res;
}

function fillMemorandoXml(xml, valores) {
  const rowRe = /<w:tr[\s\S]*?<\/w:tr>/g;
  const cellRe = /<w:tc>[\s\S]*?<\/w:tc>/g;
  let out = '';
  let last = 0;
  let rm;
  while ((rm = rowRe.exec(xml))) {
    const fila = rm[0];
    out += xml.slice(last, rm.index);
    last = rm.index + fila.length;
    const celdas = [];
    let cm;
    cellRe.lastIndex = 0;
    while ((cm = cellRe.exec(fila))) celdas.push({ s: cm.index, e: cm.index + cm[0].length, x: cm[0] });
    const cambios = [];
    for (let i = 0; i < celdas.length - 1; i++) {
      const etiqueta = cellText(celdas[i].x);
      if (!Object.prototype.hasOwnProperty.call(valores, etiqueta)) continue;
      const v = String(valores[etiqueta] ?? '').trim();
      if (!v) continue;
      cambios.push({ s: celdas[i + 1].s, e: celdas[i + 1].e, x: injectCellText(celdas[i + 1].x, v) });
    }
    if (!cambios.length) { out += fila; continue; }
    let pos = 0;
    for (const c of cambios) {
      out += fila.slice(pos, c.s) + c.x;
      pos = c.e;
    }
    out += fila.slice(pos);
  }
  out += xml.slice(last);
  return out;
}

function memorandoValores(r, b) {
  const f = (v) => (v === undefined || v === null ? '' : String(v).trim());
  return {
    'NOMBRE DEL EMPLEADO': f(b.nombre) || f(r.operario_nombre) || f(r.quien_registra),
    FECHA: f(b.fecha) || f(r.fecha_cierre) || f(r.fecha_deteccion),
    'N°': f(b.numero) || String(r.id),
    CARGO: f(b.cargo),
    EMPRESA: f(b.empresa),
    ASUNTO: f(b.asunto),
    MENSAJE: f(b.mensaje),
  };
}

router.post('/:id/memorando', (req, res) => {
  const r = db.prepare('SELECT * FROM reports WHERE id = ?').get(req.params.id);
  if (!r) return res.status(404).json({ error: 'Novedad no encontrada' });
  if (!fs.existsSync(MEMORANDO_TEMPLATE)) {
    return res.status(404).json({ error: 'No se encontró la plantilla "Base memorando.docx" en la carpeta del proyecto.' });
  }
  JSZip.loadAsync(fs.readFileSync(MEMORANDO_TEMPLATE))
    .then(async (zip) => {
      const entry = zip.file('word/document.xml');
      if (!entry) throw new Error('Plantilla inválida (sin word/document.xml)');
      const xml = await entry.async('string');
      zip.file('word/document.xml', fillMemorandoXml(xml, memorandoValores(r, req.body || {})));
      const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
      const nombre = `Memorando-${r.id}${r.referencia ? '-' + String(r.referencia).replace(/[^\w-]+/g, '') : ''}.docx`;
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', `attachment; filename="${nombre}"`);
      res.setHeader('Cache-Control', 'no-store');
      res.send(buf);
    })
    .catch((e) => {
      console.error('[reports:memorando]', e.message);
      res.status(500).json({ error: 'No se pudo generar el memorando: ' + e.message });
    });
});

module.exports = { router, MAX_PHOTOS };
