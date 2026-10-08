const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { db, DATA_DIR } = require('../src/db');

const UPLOADS = path.join(DATA_DIR, 'uploads');
const MAX_PHOTOS = 10;
const ALLOWED_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.bmp']);

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const folderArg = args.find((a) => !a.startsWith('--'));

if (!folderArg) {
  console.error('Uso: npm run import-photos -- "<carpeta con las fotos>" [--dry-run]');
  console.error('  La carpeta puede tener subcarpetas numeradas con el ID del reporte (45/...)');
  console.error('  o archivos llamados "45_nombre.jpg" en la raíz.');
  process.exit(1);
}

const ROOT = path.resolve(folderArg);
if (!fs.existsSync(ROOT) || !fs.statSync(ROOT).isDirectory()) {
  console.error('No se encontró la carpeta:', ROOT);
  process.exit(1);
}

function listFiles(dir, rel = '') {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const relPath = rel ? `${rel}/${entry.name}` : entry.name;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(abs, relPath));
    else out.push({ abs, rel: relPath });
  }
  return out;
}

function reportIdFor(rel) {
  const parts = rel.split('/');
  if (parts.length > 1 && /^\d+$/.test(parts[0])) return Number(parts[0]);
  const m = /^(\d+)[_\-. ]/.exec(path.basename(rel));
  return m ? Number(m[1]) : null;
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

const reportIds = new Set(
  db.prepare('SELECT id FROM reports').all().map((r) => r.id)
);
const reportPhotoCount = new Map(
  db
    .prepare(
      'SELECT report_id, COUNT(*) AS n FROM photos GROUP BY report_id'
    )
    .all()
    .map((r) => [r.report_id, r.n])
);

function existingHashes(reportId) {
  const dir = path.join(UPLOADS, String(reportId));
  if (!fs.existsSync(dir)) return new Set();
  const set = new Set();
  for (const f of fs.readdirSync(dir)) {
    try {
      set.add(sha256(path.join(dir, f)));
    } catch {
      /* archivo ilegible: se ignora */
    }
  }
  return set;
}

const groups = new Map();
const unmatched = [];
for (const f of listFiles(ROOT)) {
  const id = reportIdFor(f.rel);
  if (id == null) {
    unmatched.push(f.rel);
    continue;
  }
  if (!ALLOWED_EXT.has(path.extname(f.abs).toLowerCase())) {
    unmatched.push(`${f.rel} (extensión no admitida)`);
    continue;
  }
  if (!groups.has(id)) groups.set(id, []);
  groups.get(id).push(f);
}

let imported = 0;
let dupSkipped = 0;
let limitSkipped = 0;
let unknownId = 0;

console.log(
  DRY
    ? `== MODO PREVIEW (dry-run): no se escribirá nada ==`
    : `== Importando fotos desde ${ROOT} ==`
);
console.log(`Reportes con fotos en la carpeta: ${groups.size}\n`);

const tx = db.transaction(() => {
  const ins = db.prepare(
    'INSERT INTO photos (report_id, filename, original_name, sort_order) VALUES (?, ?, ?, ?)'
  );
  for (const [id, files] of [...groups.entries()].sort((a, b) => a[0] - b[0])) {
    if (!reportIds.has(id)) {
      unknownId += files.length;
      console.log(`ID ${id}: no existe en la app  -> ${files.length} archivo(s) ignorado(s)`);
      continue;
    }
    files.sort((a, b) => a.rel.localeCompare(b.rel, undefined, { numeric: true }));
    const hashes = existingHashes(id);
    let current = reportPhotoCount.get(id) || 0;
    const notes = [];
    for (const f of files) {
      if (current >= MAX_PHOTOS) {
        limitSkipped++;
        notes.push(`límite de ${MAX_PHOTOS}: "${f.rel}" omitido`);
        continue;
      }
      const hash = sha256(f.abs);
      if (hashes.has(hash)) {
        dupSkipped++;
        notes.push(`duplicado: "${f.rel}" omitido`);
        continue;
      }
      const ext = path.extname(f.abs).toLowerCase().replace('.', '');
      const fmt = ext === 'jpeg' ? 'jpg' : ext;
      const newName = `${crypto.randomBytes(10).toString('hex')}.${fmt}`;
      const dest = path.join(UPLOADS, String(id), newName);
      if (!DRY) {
        fs.mkdirSync(path.join(UPLOADS, String(id)), { recursive: true });
        fs.copyFileSync(f.abs, dest);
        ins.run(id, newName, path.basename(f.rel), current);
      }
      hashes.add(hash);
      current++;
      imported++;
      notes.push(`nueva: "${f.rel}" -> foto ${current}`);
    }
    console.log(`ID ${id}:`);
    notes.forEach((n) => console.log(`   ${n}`));
    if (notes.length === 0) console.log('   (sin archivos)');
  }
});

for (const u of unmatched) console.log(`Ignorado (sin ID reconocible): ${u}`);
if (unmatched.length) console.log('');

tx();

console.log('==============================================');
console.log(`${DRY ? 'Se importarían' : 'Importadas'}:  ${imported}`);
console.log(`Duplicadas omitidas:      ${dupSkipped}`);
console.log(`Por límite de 10:         ${limitSkipped}`);
console.log(`ID inexistente en la app: ${unknownId}`);
console.log(`Sin reconocer:            ${unmatched.length}`);
console.log('==============================================');
if (DRY) {
  console.log('Ejecute de nuevo sin --dry-run para aplicar los cambios.');
}
