const express = require('express');
const { db } = require('../db');
const { requireAuth } = require('../auth');

const router = express.Router();
router.use(requireAuth);

function buildFilters(q) {
  const where = [];
  const params = [];
  if (q.estado) { where.push('r.estado = ?'); params.push(q.estado); }
  if (q.tipo) { where.push('r.tipo_hallazgo = ?'); params.push(q.tipo); }
  if (q.area) { where.push('TRIM(r.area_reporta) = ?'); params.push(q.area); }
  if (q.desde) { where.push('r.fecha_deteccion >= ?'); params.push(q.desde); }
  if (q.hasta) { where.push('r.fecha_deteccion <= ?'); params.push(q.hasta); }
  const sql = where.length ? ' WHERE ' + where.join(' AND ') : '';
  return { sql, params };
}

router.get('/', (req, res) => {
  const { sql, params } = buildFilters(req.query);
  const all = (s, extraParams = []) => db.prepare(s).all(...params, ...extraParams);
  const one = (s, extraParams = []) => db.prepare(s).get(...params, ...extraParams);

  const total = one('SELECT COUNT(*) AS n FROM reports r' + sql).n;
  const porEstado = all('SELECT r.estado AS estado, COUNT(*) AS total FROM reports r' + sql + ' GROUP BY r.estado ORDER BY r.estado');
  const unidades = one('SELECT COALESCE(SUM(r.cantidad), 0) AS u FROM reports r' + sql).u;
  const fotos = one(
    'SELECT COUNT(DISTINCT p.report_id) AS con_fotos, COUNT(p.id) AS total_fotos FROM photos p JOIN reports r ON r.id = p.report_id' + sql
  );
  const cerradas = porEstado.find((x) => x.estado === 'CERRADO')?.total || 0;
  const promDias = one(
    "SELECT AVG(julianday(r.fecha_cierre) - julianday(r.fecha_deteccion)) AS d FROM reports r" +
      sql + (sql ? ' AND' : ' WHERE') + " r.estado = 'CERRADO' AND r.fecha_cierre IS NOT NULL"
  ).d;

  const resumen = {
    total,
    abiertas: porEstado.find((x) => x.estado === 'ABIERTO')?.total || 0,
    en_proceso: porEstado.find((x) => x.estado === 'EN PROCESO')?.total || 0,
    cerradas,
    pct_cierre: total ? Math.round((cerradas / total) * 1000) / 10 : 0,
    unidades,
    con_fotos: fotos.con_fotos,
    total_fotos: fotos.total_fotos,
    prom_dias_cierre: promDias != null ? Math.round(promDias * 10) / 10 : null,
  };

  const porTipo = all(
    "SELECT r.tipo_hallazgo AS label, COUNT(*) AS total, COALESCE(SUM(r.cantidad),0) AS unidades FROM reports r" +
      sql + (sql ? ' AND' : ' WHERE') + " r.tipo_hallazgo <> '' GROUP BY r.tipo_hallazgo ORDER BY total DESC"
  );
  const porArea = all(
    "SELECT TRIM(r.area_reporta) AS label, COUNT(*) AS total FROM reports r" +
      sql + (sql ? ' AND' : ' WHERE') + " TRIM(r.area_reporta) <> '' GROUP BY TRIM(r.area_reporta) ORDER BY total DESC"
  );
  const porTurno = all(
    "SELECT r.turno AS label, COUNT(*) AS total FROM reports r" +
      sql + (sql ? ' AND' : ' WHERE') + " r.turno <> '' GROUP BY r.turno ORDER BY r.turno"
  );
  const porMes = all(
    "SELECT substr(r.fecha_deteccion,1,7) AS label, COUNT(*) AS total FROM reports r" +
      sql + (sql ? ' AND' : ' WHERE') + " r.fecha_deteccion <> '' GROUP BY label ORDER BY label DESC LIMIT 12"
  ).reverse();
  const topOperarios = all(
    "SELECT TRIM(r.operario_codigo) AS codigo, TRIM(r.operario_nombre) AS nombre, COUNT(*) AS total, COALESCE(SUM(r.cantidad),0) AS unidades FROM reports r" +
      sql + (sql ? ' AND' : ' WHERE') + " TRIM(r.operario_codigo) <> '' GROUP BY TRIM(r.operario_codigo) ORDER BY total DESC LIMIT 10"
  );

  res.json({
    resumen,
    por_estado: porEstado,
    por_tipo: porTipo,
    por_area: porArea,
    por_turno: porTurno,
    por_mes: porMes,
    top_operarios: topOperarios,
  });
});

module.exports = { router, buildFilters };
