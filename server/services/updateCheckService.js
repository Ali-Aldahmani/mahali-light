'use strict';

// Checks for newer published releases of the POS against a remote source and
// drives the self-update flow (see scripts/applyUpdate.js for the actual
// file swap / restart).
//
// The default source is the GitHub Releases API for this repository, but a
// deployment can point UPDATE_CHECK_URL at:
//   - any JSON endpoint that returns a GitHub release object
//     (tag_name, html_url, published_at, body, ...) for the *check*, or
//   - a direct .tar.gz URL when UPDATE_CHECK_URL ends in `.tar.gz`.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const { AppError, ERROR_CODES } = require('../../shared/errorCodes');
const {
  releasePathFor,
  readStatus,
  writeStatus,
  tryAcquireLock,
  releaseLock,
} = require('./updateInstallState');

const DEFAULT_REPO = 'Ali-Aldahmani/mahali-light';
const DEFAULT_CACHE_MS = 6 * 60 * 60 * 1000; // 6 hours
const DEFAULT_TIMEOUT_MS = 8000;

let cache = null;

function currentVersion() {
  try {
    return require('../../package.json').version;
  } catch (_e) {
    return '0.0.0';
  }
}

function repoName() {
  return process.env.UPDATE_REPO || DEFAULT_REPO;
}

// https://github.com/<owner>/<repo>/archive/refs/tags/v<version>.tar.gz
function tarballUrlFor(version) {
  const v = String(version || '').replace(/^v/, '');
  const [owner, repo] = String(repoName()).split('/');
  const encoded = `${encodeURIComponent(owner || '')}/${encodeURIComponent(repo || '')}`;
  return `https://github.com/${encoded}/archive/refs/tags/v${v}.tar.gz`;
}

function parseVersion(v) {
  // 'v1.2.3-beta' -> { major: 1, minor: 2, patch: 3, pre: 'beta' }
  const s = String(v || '').trim().replace(/^[vV]/, '');
  const [core, pre] = s.split('-');
  const parts = (core || '').split('.').map((n) => parseInt(n, 10));
  return {
    major: Number.isFinite(parts[0]) ? parts[0] : 0,
    minor: Number.isFinite(parts[1]) ? parts[1] : 0,
    patch: Number.isFinite(parts[2]) ? parts[2] : 0,
    pre: pre || null,
  };
}

// Returns 1 if a > b, -1 if a < b, 0 if equal. Prereleases sort below the
// corresponding release (e.g. 1.2.0-beta < 1.2.0).
function compareVersions(a, b) {
  const p = parseVersion(a);
  const q = parseVersion(b);
  for (const key of ['major', 'minor', 'patch']) {
    if (p[key] !== q[key]) return p[key] > q[key] ? 1 : -1;
  }
  if (!!p.pre === !!q.pre) return 0;
  return p.pre ? -1 : 1;
}

async function fetchLatest() {
  const override = process.env.UPDATE_CHECK_URL;
  const url =
    override ||
    `https://api.github.com/repos/${encodeURIComponent(repoName())}/releases/latest`;

  let res;
  try {
    res = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'mahali-light-pos',
      },
      signal: AbortSignal.timeout(
        Number(process.env.UPDATE_FETCH_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS,
      ),
    });
  } catch (err) {
    throw new AppError(
      ERROR_CODES.SYS_UPDATES_UNREACHABLE,
      'Update server is unreachable.',
      { status: 502, details: { reason: err.message } },
    );
  }

  if (!res.ok) {
    throw new AppError(
      ERROR_CODES.SYS_UPDATES_UNREACHABLE,
      `Update server responded with HTTP ${res.status}.`,
      { status: 502 },
    );
  }

  return res.json();
}

async function checkForUpdates() {
  const rawCacheMs = Number(process.env.UPDATE_CACHE_MS);
  const effectiveCacheMs = Number.isFinite(rawCacheMs)
    ? rawCacheMs
    : DEFAULT_CACHE_MS;
  if (cache && Date.now() - cache.fetchedAt < effectiveCacheMs) {
    return cache.result;
  }

  const release = await fetchLatest();
  const tag = String(release.tag_name || release.name || '').trim();
  const latest = tag.replace(/^[vV]/, '');
  const current = currentVersion();
  const updateAvailable = Boolean(tag) && compareVersions(latest, current) > 0;

  const result = {
    currentVersion: current,
    latestVersion: latest || null,
    updateAvailable,
    releaseUrl: release.html_url || null,
    releasedAt: release.published_at || null,
    releaseName: release.name || null,
    notes: (release.body || '').slice(0, 2000) || null,
    downloadUrl: updateAvailable
      ? process.env.UPDATE_CHECK_URL?.endsWith('.tar.gz')
        ? process.env.UPDATE_CHECK_URL
        : tarballUrlFor(latest)
      : null,
  };

  cache = { fetchedAt: Date.now(), result };
  return result;
}

// The version an install is allowed to target: the latest discovered by
// checkForUpdates. Never trusts an arbitrary client-supplied version.
async function resolveInstallTarget() {
  const result = await checkForUpdates();
  if (!result.updateAvailable || !result.latestVersion) {
    throw new AppError(
      ERROR_CODES.BIZ_INVALID_STATE,
      'Already running the latest version. Nothing to install.',
      { status: 409 },
    );
  }
  return result;
}

// Kick off the detached applyUpdate.js runner. Returns the freshly written
// status object, or null if another install is already in progress.
function startInstall(version) {
  const v = String(version || '').replace(/^v/, '');
  if (!v) {
    throw new AppError(
      ERROR_CODES.VALIDATION_FAILED,
      'A version to install is required.',
    );
  }
  const releasePath = releasePathFor(v);
  try {
    fs.rmSync(releasePath, { recursive: true, force: true });
  } catch (_e) {
    /* ignore */
  }

  if (!tryAcquireLock()) {
    return null;
  }

  writeStatus({
    state: 'downloading',
    version: v,
    message: 'Downloading update…',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    error: null,
  });

  const script = path.resolve(__dirname, '..', '..', 'scripts', 'applyUpdate.js');
  // detached + unref so the runner survives the API process being killed by
  // PM2 during the final swap.
  const child = spawn(process.execPath, [script, v], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();

  return readStatus();
}

// Read the install status the runner is writing. If we came back up after a
// successful swap while the runner recorded 'restarting', finalize it.
function getInstallStatus() {
  finalizeIfNeeded();
  return readStatus();
}

function isSubPath(parent, child) {
  const rel = path.relative(parent, child);
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel));
}

function finalizeIfNeeded() {
  const st = readStatus();
  if (st.state !== 'restarting' || !st.version) return;
  const releasePath = releasePathFor(st.version);
  // The new process boots with cwd = the release dir (ecosystem cwd), so a
  // match means the swap completed and we are running the new code.
  if (isSubPath(process.cwd(), releasePath)) {
    writeStatus({
      state: 'done',
      message: 'Update installed.',
      finishedAt: new Date().toISOString(),
      error: null,
    });
    releaseLock();
  }
}

// Test-only hook so suites can force a fresh upstream fetch / state.
function clearCache() {
  cache = null;
}

module.exports = {
  checkForUpdates,
  compareVersions,
  parseVersion,
  currentVersion,
  clearCache,
  tarballUrlFor,
  repoName,
  resolveInstallTarget,
  startInstall,
  getInstallStatus,
};