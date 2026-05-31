const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  Notification,
  desktopCapturer,
  Menu,
} = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const https = require('https');
const http = require('http');
const appConfig = require('./config/appConfig');
const { initUpdater } = require('./updater');

function legacyConfigFile() {
  return path.join(app.getPath('userData'), 'config.json');
}
const PRINT_SETTINGS_FILE = path.join(
  app.getPath('userData'),
  'printSettings.json',
);

const DEFAULT_PRINT_SETTINGS = {
  defaultPrinter: null,
  thermalPrinter: null,
  thermalWidth: 80,
  silentPrint: true,
  printCopies: 1,
  autoPrintReceipt: false,
};

function loadPrintSettings() {
  try {
    if (fs.existsSync(PRINT_SETTINGS_FILE)) {
      const data = JSON.parse(fs.readFileSync(PRINT_SETTINGS_FILE, 'utf8'));
      return { ...DEFAULT_PRINT_SETTINGS, ...data };
    }
  } catch (err) {
    console.warn('[electron] failed to load print settings', err);
  }
  return { ...DEFAULT_PRINT_SETTINGS };
}

function savePrintSettings(patch) {
  const current = loadPrintSettings();
  const next = { ...current, ...patch };
  try {
    fs.mkdirSync(path.dirname(PRINT_SETTINGS_FILE), { recursive: true });
    fs.writeFileSync(PRINT_SETTINGS_FILE, JSON.stringify(next, null, 2));
  } catch (err) {
    console.warn('[electron] failed to save print settings', err);
  }
  return next;
}

function userData() {
  return app.getPath('userData');
}

function migrateLegacyConfig() {
  try {
    const legacyPath = legacyConfigFile();
    if (!fs.existsSync(legacyPath)) return;
    const legacy = JSON.parse(fs.readFileSync(legacyPath, 'utf8'));
    appConfig.save(userData(), {
      serverIp: legacy.serverIp,
      pcIdentifier: legacy.pcIdentifier,
    });
    fs.renameSync(legacyPath, `${legacyPath}.bak`);
  } catch (err) {
    console.warn('[electron] legacy config migration skipped', err.message);
  }
}

function loadConfig() {
  return appConfig.load(userData());
}

function saveConfig(patch) {
  return appConfig.save(userData(), patch);
}

function ensurePcIdentifier() {
  return appConfig.ensurePcIdentifier(userData());
}

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1280,
    minHeight: 720,
    backgroundColor: '#F5F6FA',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  Menu.setApplicationMenu(null);

  const devUrl = 'http://localhost:5173';
  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL(devUrl);
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.maximize();
    mainWindow.show();
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ---------------------------------------------------------------------------
// Self-signed TLS — Chromium renderer certificate-error handler
//
// When serverUseHttps=true the renderer makes fetch() calls to an HTTPS server
// with a self-signed certificate.  Chromium blocks such connections by default.
// We intercept the error and allow it ONLY for the configured server IP so
// arbitrary MITM certs on other domains are still rejected.
// ---------------------------------------------------------------------------
app.on('certificate-error', (event, _webContents, url, _error, _certificate, callback) => {
  const cfg = loadConfig();
  if (!cfg.serverUseHttps) {
    // Not using HTTPS — this should not fire, but reject just in case.
    return callback(false);
  }
  try {
    const requestHost = new URL(url).hostname;
    const serverHost  = cfg.serverIp || '127.0.0.1';
    if (requestHost === serverHost || requestHost === '127.0.0.1') {
      event.preventDefault(); // suppress the default blocking behaviour
      return callback(true);  // allow
    }
  } catch (_parseErr) {
    // URL parse failed — fall through and reject
  }
  callback(false); // reject cert errors for any other host
});

app.whenReady().then(() => {
  migrateLegacyConfig();
  ensurePcIdentifier();
  createWindow();
  initUpdater(mainWindow);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('config:get', () => loadConfig());

// config:set — only allow known keys with strict value types.
// A compromised renderer could otherwise overwrite arbitrary config keys
// (e.g. redirect serverIp to an attacker-controlled host).
const CONFIG_PATCH_VALIDATORS = {
  serverIp:       (v) => typeof v === 'string' && v.length > 0 && v.length <= 253,
  serverPort:     (v) => Number.isInteger(v) && v > 0 && v < 65536,
  serverUseHttps: (v) => typeof v === 'boolean',
  mode:           (v) => v === 'server' || v === 'client',
  pcIdentifier:   (v) => typeof v === 'string' && v.length > 0 && v.length <= 50,
  printers:       (v) => v !== null && typeof v === 'object' && !Array.isArray(v),
  display:        (v) => v !== null && typeof v === 'object' && !Array.isArray(v),
  updater:        (v) => v !== null && typeof v === 'object' && !Array.isArray(v),
};
ipcMain.handle('config:set', (_e, patch) => {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    return { error: 'Invalid patch object' };
  }
  const sanitized = {};
  for (const [key, value] of Object.entries(patch)) {
    const validate = CONFIG_PATCH_VALIDATORS[key];
    if (!validate) return { error: `Unknown config key: "${key}"` };
    if (!validate(value)) return { error: `Invalid value for config key "${key}"` };
    sanitized[key] = value;
  }
  return saveConfig(sanitized);
});
ipcMain.handle('network:local-ips', () => appConfig.localIps());
ipcMain.handle('window:toggle-fullscreen', () => {
  if (!mainWindow) return false;
  const next = !mainWindow.isFullScreen();
  mainWindow.setFullScreen(next);
  return next;
});

// Phase 16 — native desktop notifications. Only surface a tray notification
// when the window is NOT focused; otherwise the in-app panel + sound is the
// canonical UX.
ipcMain.handle('window:focused', () => {
  try {
    return mainWindow ? mainWindow.isFocused() : false;
  } catch (_e) {
    return false;
  }
});

ipcMain.handle('notify:desktop', (_e, { title, body } = {}) => {
  try {
    if (!Notification.isSupported()) return { delivered: false };
    if (mainWindow && mainWindow.isFocused()) return { delivered: false };
    const notification = new Notification({
      title: title || 'Mahali Light',
      body: body || '',
      silent: false,
    });
    notification.on('click', () => {
      try {
        if (mainWindow) {
          if (mainWindow.isMinimized()) mainWindow.restore();
          mainWindow.show();
          mainWindow.focus();
        }
      } catch (_err) {
        /* ignore */
      }
    });
    notification.show();
    return { delivered: true };
  } catch (err) {
    return { delivered: false, error: err.message };
  }
});
ipcMain.handle('system:info', () => ({
  hostname: os.hostname(),
  platform: process.platform,
  release: os.release(),
  pcIdentifier: ensurePcIdentifier(),
}));

// ----- Print integration ---------------------------------------------------

ipcMain.handle('print:settings:get', () => loadPrintSettings());
ipcMain.handle('print:settings:set', (_e, patch) => savePrintSettings(patch));

ipcMain.handle('print:get-printers', async () => {
  if (!mainWindow) return [];
  try {
    // Electron exposes `getPrintersAsync` since v23; `getPrinters` was removed
    // in newer versions. Use whichever is available.
    const wc = mainWindow.webContents;
    if (typeof wc.getPrintersAsync === 'function') {
      return await wc.getPrintersAsync();
    }
    if (typeof wc.getPrinters === 'function') {
      return wc.getPrinters();
    }
    return [];
  } catch (err) {
    console.warn('[electron] getPrinters failed', err);
    return [];
  }
});

function getApiBase() {
  const cfg = loadConfig();
  const ip     = cfg.serverIp     || '127.0.0.1';
  const port   = cfg.serverPort   || process.env.MAHALI_SERVER_PORT || 3000;
  const scheme = cfg.serverUseHttps ? 'https' : 'http';
  return `${scheme}://${ip}:${port}`;
}

// ---------------------------------------------------------------------------
// Self-signed TLS agent for main-process HTTPS calls (downloadBuffer etc.)
//
// When serverUseHttps is true the server presents a self-signed certificate.
// Node.js rejects self-signed certs by default; we pass a custom Agent with
// rejectUnauthorized:false ONLY for requests that explicitly use this agent
// (i.e. requests we know are going to our own LAN server).
// ---------------------------------------------------------------------------
let _lanHttpsAgent = null;
function getLanHttpsAgent() {
  if (!_lanHttpsAgent) {
    _lanHttpsAgent = new https.Agent({ rejectUnauthorized: false });
  }
  return _lanHttpsAgent;
}

// ---------------------------------------------------------------------------
// SSRF guard — origin-level URL allowlist for IPC download handlers
//
// `print:download` and `backup:download` accept a `url` from the renderer and
// fetch it in the main process (which has full Node.js network access).  A
// compromised renderer (XSS in the React app, or a malicious update) could
// supply an arbitrary URL and direct the main process to fetch cloud IMDS
// endpoints, internal services, or any host reachable from the server PC.
//
// We compare the *parsed* origin (protocol + hostname + port) rather than
// using a plain startsWith() check, which is bypassable via a URL like
// http://<serverIp>:<port>.evil.com/ — that string starts with the base but
// resolves to a completely different host.
// ---------------------------------------------------------------------------
function isAllowedApiUrl(urlStr) {
  if (typeof urlStr !== 'string' || !urlStr) return false;
  try {
    const allowed = new URL(getApiBase());
    const target  = new URL(urlStr);
    return (
      target.protocol === allowed.protocol &&
      target.hostname  === allowed.hostname &&
      target.port      === allowed.port
    );
  } catch (_e) {
    return false;
  }
}

// Fetches a binary URL into a Buffer. Used to pull the PDF from the server
// before rendering it for print.
function downloadBuffer(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const isHttps = url.startsWith('https:');
    const client  = isHttps ? https : http;
    // When the server uses a self-signed cert (serverUseHttps=true) the Node.js
    // TLS stack would reject it.  We use a dedicated Agent that trusts the cert
    // only for requests we know are going to our own LAN server.
    const options = { headers };
    if (isHttps && loadConfig().serverUseHttps) {
      options.agent = getLanHttpsAgent();
    }
    const req = client.get(url, options, (res) => {
      if (res.statusCode && res.statusCode >= 400) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    req.on('error', reject);
  });
}

// Renders a PDF buffer into a hidden BrowserWindow and prints it. Uses
// chromium's PDF viewer plugin (chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai).
async function printPdfBuffer(buffer, options = {}) {
  const tmpPath = path.join(
    app.getPath('temp'),
    `mahali-print-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.pdf`,
  );
  fs.writeFileSync(tmpPath, buffer);

  const settings = loadPrintSettings();
  const printer = options.printer || settings.defaultPrinter || '';

  return new Promise((resolve) => {
    const win = new BrowserWindow({
      show: false,
      webPreferences: {
        plugins: true,
        offscreen: false,
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    let resolved = false;
    const finish = (result) => {
      if (resolved) return;
      resolved = true;
      try {
        win.close();
      } catch (_e) {
        // ignore
      }
      try {
        fs.unlinkSync(tmpPath);
      } catch (_e) {
        // ignore
      }
      resolve(result);
    };

    win.webContents.on('did-finish-load', () => {
      // Give the embedded PDF viewer a tick to lay out before printing.
      setTimeout(() => {
        const printOpts = {
          silent: options.silent !== false,
          printBackground: true,
          copies: Number(options.copies || settings.printCopies || 1),
          deviceName: printer || undefined,
          margins: { marginType: 'none' },
        };
        win.webContents.print(printOpts, (success, failureReason) => {
          finish({ success, failureReason: failureReason || null });
        });
      }, 250);
    });

    win.loadURL(`file://${tmpPath.replace(/\\/g, '/')}`);

    // Hard timeout: fail open after 20s.
    setTimeout(() => finish({ success: false, failureReason: 'print_timeout' }), 20000);
  });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function loadInvoicePdf(invoiceId, kind, token) {
  // Validate before interpolating into the URL — prevents path-segment
  // injection from a compromised renderer (e.g. "../../admin/something").
  if (!invoiceId || !UUID_RE.test(String(invoiceId))) {
    throw new Error('Invalid invoice ID');
  }
  const base = getApiBase();
  const url = `${base}/api/invoices/${invoiceId}/${kind === 'receipt' ? 'receipt' : 'pdf'}`;
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  return downloadBuffer(url, headers);
}

ipcMain.handle(
  'print:invoice',
  async (_e, { invoiceId, token, printer, silent, copies } = {}) => {
    try {
      const buf = await loadInvoicePdf(invoiceId, 'invoice', token);
      const result = await printPdfBuffer(buf, { printer, silent, copies });
      return { success: result.success, error: result.failureReason };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },
);

ipcMain.handle(
  'print:receipt',
  async (_e, { invoiceId, token, printer, silent, copies } = {}) => {
    try {
      const settings = loadPrintSettings();
      const buf = await loadInvoicePdf(invoiceId, 'receipt', token);
      const result = await printPdfBuffer(buf, {
        printer: printer || settings.thermalPrinter,
        silent: silent !== false && settings.silentPrint,
        copies: copies || settings.printCopies || 1,
      });
      return { success: result.success, error: result.failureReason };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },
);

ipcMain.handle(
  'print:download',
  async (_e, { url, token, filename } = {}) => {
    try {
      if (!url) throw new Error('Missing url');
      const resolved = url.startsWith('http') ? url : `${getApiBase()}${url}`;
      if (!isAllowedApiUrl(resolved)) {
        return { success: false, error: 'URL not permitted' };
      }
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const buf = await downloadBuffer(resolved, headers);

      const result = await dialog.showSaveDialog(mainWindow, {
        title: 'Save PDF',
        defaultPath: filename || 'invoice.pdf',
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      });
      if (result.canceled || !result.filePath) {
        return { success: false, cancelled: true };
      }
      fs.writeFileSync(result.filePath, buf);
      return { success: true, path: result.filePath };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },
);

// ----- Phase 17 — backup integration ---------------------------------------
//
// We never bundle the backup file inside the IPC payload — it could easily
// exceed Electron's IPC message-size limits. Instead we stream the download
// straight to the file the user picks.
ipcMain.handle(
  'backup:download',
  async (_e, { url, token, filename, jobId } = {}) => {
    try {
      const target = url && url.startsWith('http')
        ? url
        : `${getApiBase()}${url || `/api/backup/jobs/${jobId}/download`}`;
      if (!isAllowedApiUrl(target)) {
        return { success: false, error: 'URL not permitted' };
      }
      const headers = token ? { Authorization: `Bearer ${token}` } : {};

      const result = await dialog.showSaveDialog(mainWindow, {
        title: 'Save backup archive',
        defaultPath: filename || `backup-${jobId || 'archive'}.tar.gz`,
        filters: [
          { name: 'Compressed archive', extensions: ['tar.gz', 'tgz', 'tar'] },
          { name: 'All files', extensions: ['*'] },
        ],
      });
      if (result.canceled || !result.filePath) {
        return { success: false, cancelled: true };
      }

      // Stream directly to disk — backup archives can be large, so we must
      // not load them into a Buffer first (unlike downloadBuffer).
      const isHttps = target.startsWith('https:');
      const client  = isHttps ? https : http;
      const reqOpts = { headers };
      if (isHttps && loadConfig().serverUseHttps) {
        reqOpts.agent = getLanHttpsAgent();
      }
      await new Promise((resolve, reject) => {
        const req = client.get(target, reqOpts, (res) => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode}`));
            return;
          }
          const out = fs.createWriteStream(result.filePath);
          res.pipe(out);
          out.on('finish', () => out.close(resolve));
          out.on('error', reject);
          res.on('error', reject);
        });
        req.on('error', reject);
      });
      return { success: true, path: result.filePath };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },
);

ipcMain.handle('backup:usb-list', async () => {
  try {
    const drivelist = require('drivelist');
    const drives = await drivelist.list();
    return (drives || []).filter((d) => d.isRemovable && !d.isSystem);
  } catch (err) {
    return { error: err.message };
  }
});

// Phase 18 — capture the POS window for bug reports (base64 PNG).
ipcMain.handle('screenshot:capture', async () => {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['window'],
      thumbnailSize: { width: 1280, height: 720 },
    });
    const appSource =
      sources.find((s) => /mahali|pos|electron/i.test(s.name)) || sources[0];
    if (!appSource?.thumbnail) return null;
    return appSource.thumbnail.toPNG().toString('base64');
  } catch (err) {
    console.warn('[electron] screenshot:capture failed', err.message);
    return null;
  }
});
