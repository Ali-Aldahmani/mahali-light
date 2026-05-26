const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

const CONFIG_FILE = path.join(app.getPath('userData'), 'config.json');

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
