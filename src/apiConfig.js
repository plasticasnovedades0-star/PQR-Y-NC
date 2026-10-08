const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./db');

const CONFIG_FILE = path.join(DATA_DIR, 'api-config.json');

const DEFAULTS = {
  enabled: false,
  baseUrl: '',
  path: '/ordenes/{orden}',
  method: 'GET',
  query: { fecha: '{fecha}' },
  headers: {},
  timeoutMs: 8000,
  map: {
    root: '',
    operarios: 'operarios',
    codigo: 'codigo',
    nombre: 'nombre',
  },
  fallbackLocal: true,
};

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) };
    }
  } catch (e) {
    console.error('[api-config] Error leyendo configuración:', e.message);
  }
  return { ...DEFAULTS };
}

function saveConfig(cfg) {
  const merged = { ...DEFAULTS, ...cfg };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2), 'utf8');
  return merged;
}

function getByPath(obj, p) {
  if (p === '' || p == null) return obj;
  return String(p)
    .split('.')
    .reduce((acc, k) => (acc == null ? undefined : acc[k]), obj);
}

module.exports = { loadConfig, saveConfig, getByPath, DEFAULTS, CONFIG_FILE };
