const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');
const { db, DATA_DIR } = require('../src/db');

const SEED_DIR = path.join(__dirname, '..', 'seed');
const SEED_JSON = path.join(SEED_DIR, 'novedades.json');
const SEED_ZIP = path.join(SEED_DIR, 'fotos.zip');
const UPLOADS = path.join(DATA_DIR, 'uploads');

function setSeq(table, maxId) {
  db.prepare('DELETE FROM sqlite_sequence WHERE name = ?').run(table);
  if (maxId > 0) db.prepare('INSERT INTO sqlite_sequence (name, seq) VALUES (?, ?)').run(table, maxId);
}

async function loadSeed(soloSiVacia = false) {
  if (!fs.existsSync(SEED_JSON)) {
    console.log('No existe seed/novedades.json — nada que cargar.');
    return;
  }
  if (soloSiVacia && db.prepare('SELECT COUNT(*) n FROM reports').get().n > 0) return;
  const seed = JSON.parse(fs.readFileSync(SEED_JSON, 'utf8'));
  const reports = seed.reports || [];
  const photos = seed.photos || [];

  const cols = db.prepare('PRAGMA table_info(reports)').all().map((c) => c.name);
  const insCols = cols.filter((c) => reports.some((r) => r[c] !== undefined));
  const insert = db.prepare(
    `INSERT OR IGNORE INTO reports (${insCols.join(',')}) VALUES (${insCols.map((c) => '@' + c).join(',')})`
  );

  let ok = 0, skip = 0, err = 0;
  const tx = db.transaction(() => {
    for (const r of reports) {
      try {
        const info = insert.run(Object.fromEntries(insCols.map((c) => [c, r[c] ?? null])));
        if (info.changes > 0) ok++; else skip++;
      } catch (e) {
        err++;
        console.error(`Reporte ${r.id}:`, e.message);
      }
    }
  });
  tx();
  const maxRep = db.prepare('SELECT COALESCE(MAX(id),0) m FROM reports').get().m;
  setSeq('reports', maxRep);
  console.log(`Novedades: ${ok} nuevas, ${skip} omitidas, ${err} con error. Total: ${db.prepare('SELECT COUNT(*) n FROM reports').get().n}`);

  const pCols = db.prepare('PRAGMA table_info(photos)').all().map((c) => c.name);
  const insP = pCols.filter((c) => photos.some((p) => p[c] !== undefined));
  const insertPhoto = db.prepare(
    `INSERT OR IGNORE INTO photos (${insP.join(',')}) VALUES (${insP.map((c) => '@' + c).join(',')})`
  );
  let pOk = 0, pSkip = 0;
  const txP = db.transaction(() => {
    for (const p of photos) {
      try {
        const info = insertPhoto.run(Object.fromEntries(insP.map((c) => [c, p[c] ?? null])));
        if (info.changes > 0) pOk++; else pSkip++;
      } catch (e) {
        console.error(`Foto ${p.filename}:`, e.message);
      }
    }
  });
  txP();
  setSeq('photos', db.prepare('SELECT COALESCE(MAX(id),0) m FROM photos').get().m);
  console.log(`Filas de fotos: ${pOk} nuevas, ${pSkip} omitidas.`);

  if (fs.existsSync(SEED_ZIP)) {
    const zip = await JSZip.loadAsync(fs.readFileSync(SEED_ZIP));
    let fotos = 0;
    for (const entry of Object.values(zip.files)) {
      if (entry.dir) continue;
      const m = /^(\d+)[\\/](.+)$/.exec(entry.name.replace(/\\/g, '/'));
      if (!m) continue;
      const dest = path.join(UPLOADS, m[1], m[2]);
      if (fs.existsSync(dest)) continue;
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, await entry.async('nodebuffer'));
      fotos++;
    }
    console.log(`Fotos extraídas: ${fotos} (carpeta data/uploads/<id>/)`);
  } else {
    console.log('No existe seed/fotos.zip — se cargan solo los datos.');
  }

  const totalFotos = db.prepare('SELECT COUNT(*) n FROM photos').get().n;
  console.log(`Fotos registradas en BD: ${totalFotos}`);
}

module.exports = { loadSeed };

if (require.main === module) {
  loadSeed(false).catch((e) => {
    console.error('Error cargando semilla:', e.message);
    process.exit(1);
  });
}
