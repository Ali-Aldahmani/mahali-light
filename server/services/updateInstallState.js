'use strict';

// Shared state for the self-update flow. Both the API (live process) and the
// detached `scripts/applyUpdate.js` runner read/write the same files under
// <project>.updates/. Everything is file-based so a process restart never
// loses the update progress.

const fs = require('fs');
const path = require('path');

const UPDATES_DIR =
  process.env.UPDATE_ROOT || path.resolve(__dirname, '..', '..', '.updates');
const RELEASES_DIR = path.join(UPDATES_DIR, 'releases');
const TMP_DIR = path.join(UPDATES_DIR, 'tmp');
const STATUS_FILE = path.join(UPDATES_DIR, 'status.json');
const LOCK_FILE = path.join(UPDATES_DIR, 'install.lock');
const LOG_FILE = path.join(UPDATES_DIR, 'install.log');

// States that mean "an install is actively in progress".
const ACTIVE_STATES = new Set([
  'downloading',
  'installing',
  'swapping',
  'restarting',
]);

function ensureDirs() {
  fs.mkdirSync(RELEASES_DIR, { recursive: true });
  fs.mkdirSync(TMP_DIR, { recursive: true });
}

function readStatus() {
  try {
    return JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'));
  } catch {
    return {
      state: 'idle',
      version: null,
      message: null,
      startedAt: null,
      finishedAt: null,
      error: null,
    };
  }
}

function writeStatus(patch) {
  ensureDirs();
  const next = { ...readStatus(), ...patch };
  fs.writeFileSync(STATUS_FILE, JSON.stringify(next, null, 2));
  return next;
}

// Exclusive lock so two admins (or the button + a race) cannot start two
// installs at once. 'wx' fails if the file already exists.
function tryAcquireLock() {
  ensureDirs();
  try {
    fs.writeFileSync(
      LOCK_FILE,
      `${process.pid}\n${new Date().toISOString()}\n`,
      { flag: 'wx' },
    );
    return true;
  } catch {
    return false;
  }
}

function releaseLock() {
  try {
    fs.unlinkSync(LOCK_FILE);
  } catch {
    /* ignore */
  }
}

function isInstalling() {
  return ACTIVE_STATES.has(readStatus().state);
}

function releasePathFor(version) {
  return path.join(RELEASES_DIR, `v${String(version || '').replace(/^v/, '')}`);
}

// Validate an extracted release before it is swapped in: it must carry the
// expected package.json version and the API entrypoint. Pure function so the
// detached runner and unit tests share it.
function verifyReleaseDir(releaseDir, expectedVersion) {
  const pkgPath = path.join(releaseDir, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    return { ok: false, reason: 'release is missing package.json' };
  }
  if (!fs.existsSync(path.join(releaseDir, 'server', 'index.js'))) {
    return { ok: false, reason: 'release is missing server/index.js' };
  }
  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  } catch {
    return { ok: false, reason: 'release package.json is not valid JSON' };
  }
  const got = String(pkg.version || '');
  const want = String(expectedVersion || '').replace(/^v/, '');
  if (got !== want) {
    return { ok: false, reason: `release version ${got} does not match target ${want}` };
  }
  return { ok: true };
}

module.exports = {
  UPDATES_DIR,
  RELEASES_DIR,
  TMP_DIR,
  STATUS_FILE,
  LOCK_FILE,
  LOG_FILE,
  ACTIVE_STATES,
  ensureDirs,
  readStatus,
  writeStatus,
  tryAcquireLock,
  releaseLock,
  isInstalling,
  releasePathFor,
  verifyReleaseDir,
};