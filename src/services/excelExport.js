const path = require('path');
const fs = require('fs').promises;
const ExcelJS = require('exceljs');
const { db, DATA_DIR } = require('../db');
const { buildFilters } = require('../routes/indicators');

const UPLOADS = path.join(DATA_DIR, 'uploads');

const HEADERS = [
  'ID', 'FECHA DE DETECCIÓN', 'ÁREA QUE REPORTA', 'NOMBRE DE QUIEN REGISTRA',
  'NOMBRE DEL RESPONSABLE DEL ÁREA', 'TIPO DE HALLAZGO', 'COLOR O PARTE CON EL ERROR',
  'DESCRIPCIÓN DEL HALLAZGO',
  'EVIDENCIA ORIGINAL (ARCHIVO)', 'CANTIDAD TOTAL INVOLUCRADA', 'REFERENCIA (PRODUCTO)',
  'OTRA REFERENCIA FÍSICA',
  'ORDEN DE FABRICACIÓN', 'NOMBRE DEL OPERARIO', 'CÓDIGO DEL OPERARIO', 'TURNO',
  'RESPONSABLE DEL TRATAMIENTO', 'ACCIÓN O TRATAMIENTO IMPLEMENTADO',
  'VERIFICACIÓN DE EFICACIA DE LA ACCIÓN', 'RESPONSABLE DEL CIERRE', 'FECHA DE CIERRE',
  'ESTADO DE LA SALIDA NO CONFORME', 'REGISTRADO POR', 'FECHA DE REGISTRO (APP)',
];
const PHOTO_COLS = 10;
const FIRST_PHOTO_COL = HEADERS.length + 1;

function fmtFecha(iso) {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

function headerStyle(cell) {
  cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } };
  cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  cell.border = {
    top: { style: 'thin' }, left: { style: 'thin' },
    bottom: { style: 'thin' }, right: { style: 'thin' },
  };
}

function estadoColor(estado) {
  if (estado === 'CERRADO') return 'FFC6EFCE';
  if (estado === 'EN PROCESO') return 'FFFFEB9C';
  return 'FFFFC7CE';
}

async function buildExcel(query, user) {
  const { sql, params } = buildFilters(query);
  const reports = db
    .prepare('SELECT * FROM reports r' + sql + ' ORDER BY r.fecha_deteccion ASC, r.id ASC')
    .all(...params);

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Gestión NC';
  wb.created = new Date();

  const ws = wb.addWorksheet('NOVEDADES', {
    views: [{ state: 'frozen', xSplit: 2, ySplit: 1 }],
    pageSetup: { orientation: 'landscape' },
  });

  ws.columns = HEADERS.map((h, i) => ({
    header: h,
    key: 'c' + i,
    width: [6, 14, 16, 20, 24, 22, 24, 40, 30, 12, 14, 24, 14, 30, 14, 10, 22, 44, 16, 20, 14, 16, 16, 18][i],
  }));
  for (let i = 0; i <= PHOTO_COLS; i++) {
    ws.getColumn(FIRST_PHOTO_COL + i).width = 20;
  }
  ws.getRow(1).height = 34;
  ws.getRow(1).eachCell((c) => headerStyle(c));
  ws.getRow(1).getCell(FIRST_PHOTO_COL).value = 'N.° FOTOS';
  headerStyle(ws.getRow(1).getCell(FIRST_PHOTO_COL));
  for (let i = 0; i < PHOTO_COLS; i++) {
    const c = ws.getRow(1).getCell(FIRST_PHOTO_COL + 1 + i);
    c.value = `FOTO ${i + 1}`;
    headerStyle(c);
  }

  const imageIds = [];
  async function addPhotos(rowIdx, report) {
    const photos = db
      .prepare('SELECT * FROM photos WHERE report_id = ? ORDER BY sort_order, id')
      .all(report.id);
    let count = 0;
    for (const p of photos) {
      if (count >= PHOTO_COLS) break;
      const file = path.join(UPLOADS, String(report.id), p.filename);
      try {
        const buf = await fs.readFile(file);
        const ext = path.extname(p.filename).toLowerCase().replace('.', '');
        const fmt = ext === 'jpeg' ? 'jpg' : ext;
        if (!['jpg', 'png', 'gif', 'bmp'].includes(fmt)) continue;
        const imgId = wb.addImage({ buffer: buf, extension: fmt });
        ws.addImage(imgId, {
          tl: { col: FIRST_PHOTO_COL + count + 0.1, row: rowIdx - 1 + 0.15 },
          ext: { width: 140, height: 105 },
          editAs: 'oneCell',
        });
        imageIds.push(imgId);
        count++;
      } catch {
        /* imagen no disponible */
      }
    }
    return count;
  }

  let photoPromises = [];
  reports.forEach((r, idx) => {
    const rowIdx = idx + 2;
    const row = ws.getRow(rowIdx);
    const cells = [
      r.id, fmtFecha(r.fecha_deteccion), r.area_reporta, r.quien_registra, r.responsable_area,
      r.tipo_hallazgo, r.color_parte_error, r.descripcion, r.evidencia_original,
      r.cantidad != null ? r.cantidad : '', r.referencia, r.otra_referencia, r.orden_fabricacion,
      r.operario_nombre, r.operario_codigo, r.turno, r.responsable_tratamiento,
      r.accion_tratamiento, r.verificacion_eficacia, r.responsable_cierre,
      fmtFecha(r.fecha_cierre), r.estado, r.created_by, r.created_at,
    ];
    cells.forEach((v, i) => {
      const c = row.getCell(i + 1);
      c.value = v;
      c.alignment = { vertical: 'top', wrapText: [6, 7, 8, 11, 17, 18].includes(i) };
      c.border = {
        top: { style: 'thin' }, left: { style: 'thin' },
        bottom: { style: 'thin' }, right: { style: 'thin' },
      };
    });
    const estCell = row.getCell(22);
    estCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: estadoColor(r.estado) } };
    estCell.font = { bold: true };
    photoPromises.push(
      addPhotos(rowIdx, r).then((n) => {
        row.getCell(FIRST_PHOTO_COL).value = n > 0 ? n : null;
        row.height = n > 0 ? 82 : 30;
      })
    );
  });
  await Promise.all(photoPromises);
  ws.getRow(1).height = 34;
  const wi = wb.addWorksheet('INDICADORES');
  wi.columns = [{ width: 34 }, { width: 16 }, { width: 16 }, { width: 16 }];
  const res = db
    .prepare('SELECT * FROM reports r' + sql)
    .all(...params);
  const cerradas = res.filter((r) => r.estado === 'CERRADO').length;
  const unidades = res.reduce((a, r) => a + (Number(r.cantidad) || 0), 0);
  const dias = res
    .filter((r) => r.estado === 'CERRADO' && r.fecha_cierre)
    .map((r) => (new Date(r.fecha_cierre) - new Date(r.fecha_deteccion)) / 86400000);
  const promDias = dias.length ? Math.round((dias.reduce((a, b) => a + b, 0) / dias.length) * 10) / 10 : '';
  const totalFotos = db
    .prepare('SELECT COUNT(*) AS n FROM photos p JOIN reports r ON r.id = p.report_id' + sql)
    .get(...params).n;
  const conFotos = db
    .prepare('SELECT COUNT(DISTINCT p.report_id) AS n FROM photos p JOIN reports r ON r.id = p.report_id' + sql)
    .get(...params).n;

  let rr = 1;
  const title = (text) => {
    const c = wi.getCell(rr, 1);
    c.value = text;
    c.font = { bold: true, size: 13, color: { argb: 'FF1F4E79' } };
    rr++;
  };
  const table = (headers, rows) => {
    const hr = wi.getRow(rr);
    headers.forEach((h, i) => {
      const c = hr.getCell(i + 1);
      c.value = h;
      headerStyle(c);
    });
    rr++;
    rows.forEach((row) => {
      headers.forEach((h, i) => {
        const c = wi.getCell(rr, i + 1);
        c.value = row[i] != null ? row[i] : '';
        c.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
      });
      rr++;
    });
    rr++;
  };

  title('RESUMEN GENERAL');
  table(
    ['INDICADOR', 'VALOR'],
    [
      ['Total de novedades', res.length],
      ['Abiertas', res.filter((r) => r.estado === 'ABIERTO').length],
      ['En proceso', res.filter((r) => r.estado === 'EN PROCESO').length],
      ['Cerradas', cerradas],
      ['% de cierre', res.length ? Math.round((cerradas / res.length) * 1000) / 10 + ' %' : '0 %'],
      ['Unidades implicadas (total)', unidades],
      ['Promedio de días a cierre', promDias],
      ['Reportes con fotos', conFotos],
      ['Fotos totales', totalFotos],
      ['Generado por', user ? `${user.name || user.username} (${user.role})` : 'sistema'],
      ['Fecha de generación', new Date().toLocaleString('es-CO')],
    ]
  );

  const group = (label, key) => {
    const map = new Map();
    res.forEach((r) => {
      const k = (r[key] || '').toString().trim() || '(sin dato)';
      const cur = map.get(k) || { total: 0, und: 0 };
      cur.total++;
      cur.und += Number(r.cantidad) || 0;
      map.set(k, cur);
    });
    table(
      [label, 'NOVEDADES', 'UNIDADES'],
      [...map.entries()].sort((a, b) => b[1].total - a[1].total).map(([k, v]) => [k, v.total, v.und])
    );
  };

  title('NOVEDADES POR TIPO DE HALLAZGO');
  group('TIPO DE HALLAZGO', 'tipo_hallazgo');
  title('NOVEDADES POR ÁREA');
  group('ÁREA', 'area_reporta');
  title('NOVEDADES POR TURNO');
  group('TURNO', 'turno');
  title('NOVEDADES POR ESTADO');
  group('ESTADO', 'estado');

  title('TOP OPERARIOS CON MÁS HALLAZGOS');
  const opMap = new Map();
  res.forEach((r) => {
    const cod = (r.operario_codigo || '').trim();
    if (!cod) return;
    const cur = opMap.get(cod) || { nombre: (r.operario_nombre || '').trim(), total: 0, und: 0 };
    cur.total++;
    cur.und += Number(r.cantidad) || 0;
    opMap.set(cod, cur);
  });
  table(
    ['CÓDIGO', 'NOMBRE DEL OPERARIO', 'HALLAZGOS', 'UNIDADES'],
    [...opMap.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, 15)
      .map(([cod, v]) => [cod, v.nombre, v.total, v.und])
  );

  title('NOVEDADES POR MES');
  const mesMap = new Map();
  res.forEach((r) => {
    const k = (r.fecha_deteccion || '').slice(0, 7) || '(sin fecha)';
    mesMap.set(k, (mesMap.get(k) || 0) + 1);
  });
  table(['MES', 'NOVEDADES'], [...mesMap.entries()].sort().map(([k, v]) => [k, v]));

  const wo = wb.addWorksheet('OPERARIOS');
  wo.columns = [{ header: 'CÓDIGO', key: 'codigo', width: 14 }, { header: 'NOMBRE', key: 'nombre', width: 44 }];
  wo.getRow(1).eachCell(headerStyle);
  db.prepare('SELECT codigo, nombre FROM operators ORDER BY nombre').all().forEach((o) => wo.addRow(o));

  return wb;
}

module.exports = { buildExcel, HEADERS, PHOTO_COLS };
