const { contextBridge, ipcRenderer } = require('electron');

const api = {
  // Reads the local Electron config file (server IP, PC identifier).
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (patch) => ipcRenderer.invoke('config:set', patch),
  getLocalIps: () => ipcRenderer.invoke('network:local-ips'),
  toggleFullscreen: () => ipcRenderer.invoke('window:toggle-fullscreen'),
  getSystemInfo: () => ipcRenderer.invoke('system:info'),

  // Phase 7 — printer + PDF integration.
  getPrintSettings: () => ipcRenderer.invoke('print:settings:get'),
  setPrintSettings: (patch) => ipcRenderer.invoke('print:settings:set', patch),
  getPrinters: () => ipcRenderer.invoke('print:get-printers'),
  printInvoice: (payload) => ipcRenderer.invoke('print:invoice', payload),
  printReceipt: (payload) => ipcRenderer.invoke('print:receipt', payload),
  downloadPdf: (payload) => ipcRenderer.invoke('print:download', payload),

  // Phase 16 — native desktop notifications.
  notifyDesktop: (payload) => ipcRenderer.invoke('notify:desktop', payload),
  isWindowFocused: () => ipcRenderer.invoke('window:focused'),

  // Phase 17 — backup helpers (download archive + list USB drives).
  backupDownload: (payload) => ipcRenderer.invoke('backup:download', payload),
  backupListUsb: () => ipcRenderer.invoke('backup:usb-list'),

  // Phase 18 — screenshot for bug reports.
  captureScreenshot: () => ipcRenderer.invoke('screenshot:capture'),
};

// The frontend reads `window.electron.serverIp` (used by src/config.js).
// Must be synchronous — Vite can load the renderer before an async bootstrap finishes.
let cfg = {};
try {
  cfg = ipcRenderer.sendSync('config:get-sync') || {};
} catch (_err) {
  cfg = {};
}

contextBridge.exposeInMainWorld('electron', {
  ...api,
  serverIp: cfg.serverIp || '127.0.0.1',
  serverPort: cfg.serverPort || 3002,
  serverUseHttps: cfg.serverUseHttps ?? false,
  mode: cfg.mode || 'server',
  pcIdentifier: cfg.pcIdentifier,
});
