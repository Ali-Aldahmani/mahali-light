const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const https = require('https');
const http = require('http');

const CONFIG_FILE = path.join(app.getPath('userData'), 'config.json');
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

function loadConfig() {
  const defaults = {
    serverIp: process.env.MAHALI_SERVER_IP || '127.0.0.1',
    pcIdentifier: null,
  };
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      return { ...defaults, ...data };
    }
  } catch (err) {
    console.warn('[electron] failed to load config', err);
  }
  return defaults;
}

function saveConfig(patch) {
  const current = loadConfig();
  const next = { ...current, ...patch };
  try {
    fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2));
  } catch (err) {
    console.warn('[electron] failed to save config', err);
  }
  return next;
}

function ensurePcIdentifier() {
  const cfg = loadConfig();
  if (cfg.pcIdentifier) return cfg.pcIdentifier;
  const id = `${os.hostname()}-${crypto.randomBytes(4).toString('hex')}`.slice(0, 50);
  saveConfig({ pcIdentifier: id });
  return id;
}

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#F5F6FA',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const devUrl = 'http://localhost:5173';
  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL(devUrl);
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  ensurePcIdentifier();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('config:get', () => loadConfig());
ipcMain.handle('config:set', (_e, patch) => saveConfig(patch));
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
  const ip = cfg.serverIp || '127.0.0.1';
  const port = process.env.MAHALI_SERVER_PORT || 3000;
  return `http://${ip}:${port}`;
}

// Fetches a binary URL into a Buffer. Used to pull the PDF from the server
// before rendering it for print.
function downloadBuffer(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https:') ? https : http;
    const req = client.get(url, { headers }, (res) => {
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

async function loadInvoicePdf(invoiceId, kind, token) {
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
      const base = url.startsWith('http') ? url : `${getApiBase()}${url}`;
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const buf = await downloadBuffer(base, headers);

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
