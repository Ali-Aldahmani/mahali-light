const { contextBridge, ipcRenderer } = require('electron');

const api = {
  // Reads the local Electron config file (server IP, PC identifier).
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (patch) => ipcRenderer.invoke('config:set', patch),
  getSystemInfo: () => ipcRenderer.invoke('system:info'),
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
