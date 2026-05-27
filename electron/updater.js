const { app, BrowserWindow } = require('electron');

let autoUpdater = null;
try {
  ({ autoUpdater } = require('electron-updater'));
} catch (_e) {
  /* optional in dev */
}

function isDev() {
  return process.env.NODE_ENV === 'development' || !app.isPackaged;
}

function initUpdater(mainWindow) {
  if (isDev() || !autoUpdater) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-downloaded', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('updater:ready', {
        version: autoUpdater.updateInfo?.version,
      });
    }
  });

  autoUpdater.on('error', (err) => {
    console.warn('[updater]', err.message);
  });

  const check = () => {
    autoUpdater.checkForUpdatesAndNotify().catch(() => {});
  };
  check();
  setInterval(check, 4 * 60 * 60 * 1000);
}

function installNow() {
  if (autoUpdater) autoUpdater.quitAndInstall();
}

module.exports = { initUpdater, installNow, isDev };
