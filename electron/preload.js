const { contextBridge, ipcRenderer } = require('electron');

const api = {
  // Reads the local Electron config file (server IP, PC identifier).
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (patch) => ipcRenderer.invoke('config:set', patch),
  getSystemInfo: () => ipcRenderer.invoke('system:info'),

  // Phase 7 — printer + PDF integration.
  getPrintSettings: () => ipcRenderer.invoke('print:settings:get'),
  setPrintSettings: (patch) => ipcRenderer.invoke('print:settings:set', patch),
  getPrinters: () => ipcRenderer.invoke('print:get-printers'),
  printInvoice: (payload) => ipcRenderer.invoke('print:invoice', payload),
  printReceipt: (payload) => ipcRenderer.invoke('print:receipt', payload),
  downloadPdf: (payload) => ipcRenderer.invoke('print:download', payload),
};

// The frontend reads `window.electron.serverIp` (used by src/config.js).
const bootstrap = async () => {
  try {
    const cfg = await api.getConfig();
    contextBridge.exposeInMainWorld('electron', {
      ...api,
      serverIp: cfg.serverIp,
      pcIdentifier: cfg.pcIdentifier,
    });
  } catch (_err) {
    contextBridge.exposeInMainWorld('electron', api);
  }
};

bootstrap();
