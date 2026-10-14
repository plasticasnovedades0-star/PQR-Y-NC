const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, '..', 'data');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, 'uploads'), { recursive: true });

const db = new Database(path.join(DATA_DIR, 'app.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL CHECK (role IN ('reporte','gestion')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fecha_deteccion TEXT NOT NULL,
  area_reporta TEXT NOT NULL DEFAULT '',
  quien_registra TEXT NOT NULL DEFAULT '',
  responsable_area TEXT NOT NULL DEFAULT '',
  tipo_hallazgo TEXT NOT NULL DEFAULT '',
  color_parte_error TEXT NOT NULL DEFAULT '',
  descripcion TEXT NOT NULL DEFAULT '',
  cantidad REAL,
  referencia TEXT NOT NULL DEFAULT '',
  orden_fabricacion TEXT NOT NULL DEFAULT '',
  operario_nombre TEXT NOT NULL DEFAULT '',
  operario_codigo TEXT NOT NULL DEFAULT '',
  turno TEXT NOT NULL DEFAULT '',
  responsable_tratamiento TEXT NOT NULL DEFAULT '',
  accion_tratamiento TEXT NOT NULL DEFAULT '',
  verificacion_eficacia TEXT NOT NULL DEFAULT '',
  responsable_cierre TEXT NOT NULL DEFAULT '',
  fecha_cierre TEXT,
  estado TEXT NOT NULL DEFAULT 'ABIERTO' CHECK (estado IN ('ABIERTO','EN PROCESO','CERRADO')),
  evidencia_original TEXT NOT NULL DEFAULT '',
  origen_operarios TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  original_name TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS operators (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo TEXT NOT NULL UNIQUE,
  nombre TEXT NOT NULL,
  activo INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS of_lookups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  orden TEXT NOT NULL,
  fecha TEXT NOT NULL DEFAULT '',
  fuente TEXT NOT NULL DEFAULT 'API',
  total_operarios INTEGER NOT NULL DEFAULT 0,
  raw TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS catalog (
  clave TEXT NOT NULL,
  valor TEXT NOT NULL,
  PRIMARY KEY (clave, valor)
);

CREATE TABLE IF NOT EXISTS access_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  operator TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT '',
  ip TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_reports_estado ON reports(estado);
CREATE INDEX IF NOT EXISTS idx_reports_fecha ON reports(fecha_deteccion);
CREATE INDEX IF NOT EXISTS idx_photos_tipo ON photos(report_id, tipo);
CREATE INDEX IF NOT EXISTS idx_access_log ON access_log(created_at);
`);

const reportCols = db.prepare('PRAGMA table_info(reports)').all().map((c) => c.name);
if (!reportCols.includes('color_parte_error')) {
  db.exec("ALTER TABLE reports ADD COLUMN color_parte_error TEXT NOT NULL DEFAULT ''");
}
if (!reportCols.includes('otra_referencia')) {
  db.exec("ALTER TABLE reports ADD COLUMN otra_referencia TEXT NOT NULL DEFAULT ''");
}

const photoCols = db.prepare('PRAGMA table_info(photos)').all().map((c) => c.name);
if (!photoCols.includes('tipo')) {
  db.exec("ALTER TABLE photos ADD COLUMN tipo TEXT NOT NULL DEFAULT 'EVIDENCIA'");
}
db.exec("CREATE INDEX IF NOT EXISTS idx_photos_tipo ON photos(report_id, tipo)");

const userCols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
if (!userCols.includes('pending')) {
  db.exec('ALTER TABLE users ADD COLUMN pending INTEGER NOT NULL DEFAULT 0');
}
if (!userCols.includes('app')) {
  db.exec(`
    CREATE TABLE users_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      full_name TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL CHECK (role IN ('reporte','gestion')),
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      pending INTEGER NOT NULL DEFAULT 0,
      app TEXT NOT NULL DEFAULT 'nc',
      UNIQUE (app, username)
    );
    INSERT INTO users_new (id, username, password_hash, full_name, role, active, created_at, pending, app)
      SELECT id, username, password_hash, full_name, role, active, created_at, COALESCE(pending, 0), 'nc' FROM users;
    DROP TABLE users;
    ALTER TABLE users_new RENAME TO users;
  `);
}
db.exec('UPDATE users SET pending = 0 WHERE pending IS NULL');
db.exec("UPDATE users SET app = 'nc' WHERE app IS NULL OR app = ''");
db.exec('CREATE INDEX IF NOT EXISTS idx_users_app ON users(app, username)');

const logCols = db.prepare('PRAGMA table_info(access_log)').all().map((c) => c.name);
if (!logCols.includes('app')) {
  db.exec("ALTER TABLE access_log ADD COLUMN app TEXT NOT NULL DEFAULT 'nc'");
}

const TIPOS = [
  'Faltante de parte y/o producto',
  'Faltante de etiquetas',
  'EAN incorrecto',
  'Etiqueta incorrecta',
  'Daño físico',
  'Sin código',
  'Código incorrecto',
  'Sin EAN 14',
  'EAN 14 incorrecto',
  'Sin etiqueta',
  'Etiqueta torcida',
  'Sin termoencoger',
  'Mal termoencogido',
  'Defecto funcional',
  'Defecto estético',
  'Faltante de unidades',
  'Excedente en unidades',
];

const AREAS = ['Cedi', 'Planta', 'Despacho', 'Calidad'];
const TURNOS = ['TURNO 1', 'TURNO 2', 'TURNO 3'];

function seedCatalog() {
  const ins = db.prepare('INSERT OR IGNORE INTO catalog (clave, valor) VALUES (?, ?)');
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM catalog WHERE clave = 'tipo'").run();
    TIPOS.forEach((v) => ins.run('tipo', v));
    AREAS.forEach((v) => ins.run('area', v));
    TURNOS.forEach((v) => ins.run('turno', v));
  });
  tx();
}
seedCatalog();

function getCatalog(clave) {
  return db
    .prepare('SELECT valor FROM catalog WHERE clave = ? ORDER BY rowid')
    .all(clave)
    .map((r) => r.valor);
}

module.exports = { db, DATA_DIR, getCatalog, TIPOS, AREAS, TURNOS };
