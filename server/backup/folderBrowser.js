const fs = require('fs');
const path = require('path');

// Lists folders on the machine the server runs on, for the "Browse" dialog
// beside the backup Local path. Backups are written by the server, so the
// browser's own folder picker can't help: it only knows the viewer's PC.
// Folders only — file names are never returned.

const MAX_FOLDERS = 1000;
const MAX_NAME = 255;

// Windows system folders nobody should pick as a backup target.
const HIDDEN_NAMES = new Set(['$recycle.bin', 'system volume information', '$windows.~bt', '$windows.~ws']);

function isWindows() {
  return process.platform === 'win32';
}

function listRoots() {
  const roots = [{ name: 'Server app folder', path: process.cwd() }];
  if (isWindows()) {
    for (let c = 65; c <= 90; c += 1) {
      const drive = `${String.fromCharCode(c)}:\\`;
      if (fs.existsSync(drive)) roots.push({ name: drive, path: drive });
    }
  } else {
    roots.push({ name: '/', path: '/' });
  }
  return roots;
}

// Same rule the local destination uses: relative paths hang off the server's
// working directory.
function resolveLocal(p) {
  const s = String(p || '').trim() || './backups';
  return path.isAbsolute(s) ? path.resolve(s) : path.resolve(process.cwd(), s);
}

async function isDir(p) {
  try {
    return (await fs.promises.stat(p)).isDirectory();
  } catch {
    return false;
  }
}

// The configured path may not exist yet (it is created on the first backup),
// so open the nearest folder above it that does.
async function nearestExisting(p) {
  let cur = p;
  for (;;) {
    if (await isDir(cur)) return cur;
    const up = path.dirname(cur);
    if (up === cur) return process.cwd();
    cur = up;
  }
}

async function canWrite(p) {
  try {
    await fs.promises.access(p, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

async function browse(requested) {
  const target = await nearestExisting(resolveLocal(requested));
  let dirents;
  try {
    dirents = await fs.promises.readdir(target, { withFileTypes: true });
  } catch (err) {
    const e = new Error(`Can't open ${target}: ${err.code === 'EACCES' || err.code === 'EPERM' ? 'access denied' : err.message}`);
    e.status = 400;
    throw e;
  }
  const folders = dirents
    .filter((d) => d.isDirectory()
      && !d.name.startsWith('.')
      && !HIDDEN_NAMES.has(d.name.toLowerCase()))
    .map((d) => ({ name: d.name, path: path.join(target, d.name) }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }));
  const parent = path.dirname(target);
  return {
    path: target,
    parent: parent === target ? null : parent,
    folders: folders.slice(0, MAX_FOLDERS),
    truncated: folders.length > MAX_FOLDERS,
    writable: await canWrite(target),
    roots: listRoots(),
    sep: path.sep,
  };
}

function validateFolderName(name) {
  const n = String(name || '').trim();
  if (!n) return 'Enter a folder name.';
  if (n.length > MAX_NAME) return 'Folder name is too long.';
  if (n === '.' || n === '..') return 'That folder name is not allowed.';
  if (/[<>:"/\\|?*\x00-\x1f]/.test(n)) return 'Folder names cannot contain < > : " / \\ | ? *';
  if (isWindows() && /[. ]$/.test(n)) return 'Folder names cannot end with a dot or space.';
  return null;
}

async function createFolder(parent, name) {
  const problem = validateFolderName(name);
  if (problem) {
    const e = new Error(problem);
    e.status = 400;
    throw e;
  }
  const base = resolveLocal(parent);
  if (!(await isDir(base))) {
    const e = new Error(`${base} does not exist.`);
    e.status = 400;
    throw e;
  }
  const created = path.join(base, String(name).trim());
  try {
    await fs.promises.mkdir(created);
  } catch (err) {
    const e = new Error(err.code === 'EEXIST'
      ? 'A folder with that name already exists.'
      : `Can't create the folder: ${err.code === 'EACCES' || err.code === 'EPERM' ? 'access denied' : err.message}`);
    e.status = err.code === 'EEXIST' ? 409 : 400;
    throw e;
  }
  return browse(created);
}

module.exports = { browse, createFolder, validateFolderName, resolveLocal };
