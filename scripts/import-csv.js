const fs = require('fs');
const path = require('path');
const { db } = require('../src/db');

const CSV_PATH =
  process.argv[2] ||
  path.join(process.env.USERPROFILE || process.env.HOME || '', 'Downloads', 'REPORTE Y SEGUIMIENTO DE HALLAZGOS.csv');

function parseCSV(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field); field = '';
    } else if (ch === '\n') {
      row.push(field); field = '';
      rows.push(row); row = [];
    } else if (ch !== '\r') {
      field += ch;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function toISO(d) {
  if (!d) return null;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(d).trim());
  if (!m) return null;
  return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

function normEstado(e) {
  const s = String(e || '').trim().toUpperCase();
  if (s === 'CERRADO') return 'CERRADO';
  if (s === 'EN PROCESO') return 'EN PROCESO';
  return 'ABIERTO';
}

if (!fs.existsSync(CSV_PATH)) {
  console.error('No se encontró el CSV:', CSV_PATH);
  process.exit(1);
}

const rows = parseCSV(fs.readFileSync(CSV_PATH, 'utf8')).filter((r) => r.some((c) => c.trim() !== ''));
const header = rows[0];
console.log('Columnas encontradas:', header.length);
console.log(header.map((h, i) => `${i}: ${h}`).join('\n'));

const insert = db.prepare(`
  INSERT OR IGNORE INTO reports (
    id, fecha_deteccion, area_reporta, quien_registra, responsable_area, tipo_hallazgo,
    descripcion, cantidad, referencia, operario_nombre, operario_codigo, turno,
    responsable_tratamiento, accion_tratamiento, verificacion_eficacia, responsable_cierre,
    fecha_cierre, estado, evidencia_original, origen_operarios, created_by, created_at
  ) VALUES (
    @id, @fecha_deteccion, @area_reporta, @quien_registra, @responsable_area, @tipo_hallazgo,
    @descripcion, @cantidad, @referencia, @operario_nombre, @operario_codigo, @turno,
    @responsable_tratamiento, @accion_tratamiento, @verificacion_eficacia, @responsable_cierre,
    @fecha_cierre, @estado, @evidencia_original, 'CSV', 'importación', datetime('now')
  )
`);

let ok = 0, skip = 0, err = 0;
const tx = db.transaction(() => {
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const id = parseInt(String(r[0]).trim(), 10);
    if (!id || isNaN(id)) { skip++; continue; }
    try {
      const info = insert.run({
        id,
        fecha_deteccion: toISO(r[1]) || '1900-01-01',
        area_reporta: (r[2] || '').trim(),
        quien_registra: (r[3] || '').trim(),
        responsable_area: (r[4] || '').trim(),
        tipo_hallazgo: (r[5] || '').trim(),
        descripcion: (r[6] || '').trim(),
        cantidad: String(r[8] || '').trim() === '' ? null : Number(String(r[8]).replace(',', '.')) || null,
        referencia: (r[9] || '').trim(),
        operario_nombre: (r[10] || '').replace(/\n/g, ' ').trim(),
        operario_codigo: (r[11] || '').trim(),
        turno: (r[12] || '').trim(),
        responsable_tratamiento: (r[13] || '').trim(),
        accion_tratamiento: (r[14] || '').trim(),
        verificacion_eficacia: (r[15] || '').trim(),
        responsable_cierre: (r[16] || '').trim(),
        fecha_cierre: toISO(r[17]),
        estado: normEstado(r[19]),
        evidencia_original: (r[7] || '').trim(),
      });
      if (info.changes > 0) ok++; else skip++;
    } catch (e) {
      err++;
      console.error(`Fila ${i} (ID ${id}):`, e.message);
    }
  }
  const maxId = db.prepare('SELECT COALESCE(MAX(id), 0) AS m FROM reports').get().m;
  db.prepare("DELETE FROM sqlite_sequence WHERE name = 'reports'").run();
  db.prepare('INSERT INTO sqlite_sequence (name, seq) VALUES (?, ?)').run('reports', maxId);
});
tx();

const total = db.prepare('SELECT COUNT(*) AS n FROM reports').get().n;
console.log(`\nImportación finalizada: ${ok} nuevas, ${skip} omitidas, ${err} con error. Total en BD: ${total}`);
