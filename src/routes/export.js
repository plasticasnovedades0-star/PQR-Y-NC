const express = require('express');
const { requireAuth, requireApp } = require('../auth');
const { buildExcel } = require('../services/excelExport');

const router = express.Router();
router.use(requireAuth);
router.use(requireApp('nc'));

router.get('/excel', async (req, res) => {
  try {
    const wb = await buildExcel(req.query, req.user);
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', `attachment; filename="Novedades_NC_${stamp}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (e) {
    console.error('[export]', e);
    if (!res.headersSent) res.status(500).json({ error: `Error generando Excel: ${e.message}` });
  }
});

module.exports = { router };
