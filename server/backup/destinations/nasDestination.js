const fs = require('fs');
const path = require('path');

// NAS access strategy:
//   Windows  → UNC path \\<ip>\share\sub\... — assumes the share has been
//              mounted/authenticated once by the OS (or via stored credentials).
//   *nix     → expects an SMB or NFS mount accessible at nas_path.
//
// We don't ship an embedded SMB client because that pulls a multi-megabyte
// native dep into the desktop app for an edge case. Operators with a sealed
// NAS should map it as a network drive on the server PC.
function buildNasPath({ nasIp, nasPath }) {
  if (!nasPath) return null;
  // Already a UNC path (\\server\share\...) — accept as-is.
  if (/^\\\\/.test(nasPath)) return nasPath;
  if (process.platform === 'win32') {
    const cleaned = String(nasPath).replace(/^\/+/, '').replace(/\//g, '\\');
    return `\\\\${nasIp || 'localhost'}\\${cleaned}`;
  }
  // POSIX: treat nas_path as a directory that's already mounted.
  if (path.isAbsolute(nasPath)) return nasPath;
  return path.join('/mnt/nas', nasPath);
}

function timeoutPromise(ms, label) {
  return new Promise((_resolve, reject) => {
    setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
}

async function save(srcFilePath, backupName, scheduleKey, settings = {}) {
  const dest = buildNasPath({ nasIp: settings.nasIp, nasPath: settings.nasPath });
  if (!dest) {
    return { type: 'nas', success: false, error: 'NAS path is not configured.' };
  }
  const targetDir = path.join(dest, scheduleKey || 'misc');
  const finalPath = path.join(targetDir, backupName);
  try {
    await Promise.race([
      (async () => {
        await fs.promises.mkdir(targetDir, { recursive: true });
        await fs.promises.copyFile(srcFilePath, finalPath);
      })(),
      timeoutPromise(30000, 'NAS copy'),
    ]);
    return { type: 'nas', success: true, path: finalPath };
  } catch (err) {
    return { type: 'nas', success: false, error: err.message };
  }
}

async function testConnection(settings = {}) {
  const dest = buildNasPath({ nasIp: settings.nasIp, nasPath: settings.nasPath });
  if (!dest) return { ok: false, error: 'NAS path is not configured.' };
  try {
    await Promise.race([
      fs.promises.access(dest, fs.constants.W_OK),
      timeoutPromise(15000, 'NAS access'),
    ]);
    return { ok: true, path: dest };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function diskUsage(settings = {}) {
  // Without an SMB client we cannot ask the NAS its true disk usage; return
  // a best-effort 'unknown' result and let the UI gracefully fall back.
  const dest = buildNasPath({ nasIp: settings.nasIp, nasPath: settings.nasPath });
  if (!dest) return { available: false };
  try {
    await fs.promises.access(dest);
    return { available: true, freeBytes: null, totalBytes: null };
  } catch (_e) {
    return { available: false };
  }
}

module.exports = { save, testConnection, diskUsage, buildNasPath };
