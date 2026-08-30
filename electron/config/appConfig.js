const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

function configPath(userDataPath) {
  return path.join(userDataPath, 'appConfig.json');
}

const DEFAULTS = {
  pcIdentifier: null,
  serverIp: process.env.MAHALI_SERVER_IP || '127.0.0.1',
  serverPort: Number(process.env.PORT || process.env.MAHALI_SERVER_PORT || 3002),
  // Set to true when the server is running with TLS (SERVER_USE_HTTPS=true in
  // the server .env).  Electron will then use https:// for all API calls and
  // will accept the server's self-signed certificate for the configured IP.
  serverUseHttps: false,
  mode: 'server',
  printers: {
    a4: null,
    thermal: null,
    thermalWidth: 80,
    silentPrint: true,
    autoPrintReceipt: false,
  },
  display: {
    sidebarCollapsed: false,
  },
  updater: {
    channel: 'stable',
    autoDownload: true,
    autoInstallOnQuit: true,
  },
};

function load(userDataPath) {
  const file = configPath(userDataPath);
  try {
    if (fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      return { ...DEFAULTS, ...data, printers: { ...DEFAULTS.printers, ...data.printers }, display: { ...DEFAULTS.display, ...data.display } };
    }
  } catch (err) {
    console.warn('[appConfig] read failed', err.message);
  }
  return { ...DEFAULTS };
}

function save(userDataPath, patch) {
  const current = load(userDataPath);
  const next = {
    ...current,
    ...patch,
    printers: { ...current.printers, ...(patch.printers || {}) },
    display: { ...current.display, ...(patch.display || {}) },
    updater: { ...current.updater, ...(patch.updater || {}) },
  };
  fs.mkdirSync(path.dirname(configPath(userDataPath)), { recursive: true });
  fs.writeFileSync(configPath(userDataPath), JSON.stringify(next, null, 2));
  return next;
}

function ensurePcIdentifier(userDataPath) {
  const cfg = load(userDataPath);
  if (cfg.pcIdentifier) return cfg.pcIdentifier;
  const id = `${os.hostname()}-${crypto.randomBytes(3).toString('hex')}`.slice(0, 50);
  save(userDataPath, { pcIdentifier: id });
  return id;
}

function localIps() {
  const nets = os.networkInterfaces();
  const ips = [];
  for (const iface of Object.values(nets)) {
    for (const addr of iface || []) {
      if (addr.family === 'IPv4' && !addr.internal) ips.push(addr.address);
    }
  }
  return ips;
}

module.exports = { load, save, ensurePcIdentifier, localIps, DEFAULTS };
