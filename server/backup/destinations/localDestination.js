const fs = require('fs');
const path = require('path');

// Sub-directory naming per archive type so retention logic can scope its
// cleanup. Keep in sync with retentionManager.
const TYPE_SUBDIRS = {
  'db-6h': 'db-6h',
  'db-nightly': 'db-nightly',
  'full-nightly': 'full-nightly',
  'full-weekly': 'full-weekly',
  'full-monthly': 'full-monthly',
  'manual-full': 'manual-full',
  'manual-db': 'manual-db',
};

function resolveBaseDir(localPath) {
  const p = localPath || './backups';
  return path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
}

function targetDir(localPath, scheduleKey) {
  const sub = TYPE_SUBDIRS[scheduleKey] || scheduleKey || 'misc';
  return path.join(resolveBaseDir(localPath), sub);
}

async function save(srcFilePath, backupName, scheduleKey, { localPath } = {}) {
  try {
    const dir = targetDir(localPath, scheduleKey);
    await fs.promises.mkdir(dir, { recursive: true });
    const dest = path.join(dir, backupName);
    await fs.promises.copyFile(srcFilePath, dest);
    return { type: 'local', success: true, path: dest };
  } catch (err) {
    return { type: 'local', success: false, error: err.message };
  }
}

async function listFilesByType(localPath) {
  const base = resolveBaseDir(localPath);
  const result = {};
  if (!fs.existsSync(base)) return result;
  const entries = await fs.promises.readdir(base, { withFileTypes: true });
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const dir = path.join(base, e.name);
    const files = await fs.promises.readdir(dir);
    result[e.name] = await Promise.all(
      files.map(async (f) => {
        const full = path.join(dir, f);
        try {
          const st = await fs.promises.stat(full);
          return { name: f, path: full, sizeBytes: st.size, mtime: st.mtime };
        } catch (_e) {
          return null;
        }
      }),
    ).then((arr) => arr.filter(Boolean));
  }
  return result;
}

async function deleteFile(filePath) {
  try {
    await fs.promises.unlink(filePath);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

module.exports = { save, listFilesByType, deleteFile, targetDir, resolveBaseDir, TYPE_SUBDIRS };
