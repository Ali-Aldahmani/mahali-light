#!/usr/bin/env node
'use strict';

/**
 * Detached self-update runner for the Docker Compose deployment.
 *
 * Spawned by POST /api/app-updates/install. The API process owns the install
 * lock and writes the "downloading" status before spawning us. We download,
 * verify and (optionally) `npm ci` the new release, then swap its files
 * (server/, shared/, package.json, node_modules) into place over the live
 * app directory and signal the container's PID 1 to exit.
 *
 * We do NOT mark the install "done" ourselves: once PID 1 exits, Docker
 * tears down the whole container's process tree — including this detached
 * runner — so there is no guarantee any code after that signal actually
 * runs. Instead the freshly booted process finalizes its own install (see
 * finalizeIfNeeded in updateCheckService.js) once its package.json version
 * matches what we staged.
 *
 *   usage: node scripts/applyUpdate.js <version>
 *
 * Env knobs:
 *   UPDATE_CHECK_URL          direct .tar.gz URL override (else GitHub tag)
 *   UPDATE_REPO               default Ali-Aldahmani/mahali-light
 *   UPDATE_EXPECTED_SHA256    optional hex sha256 the tarball must match
 *   UPDATE_SKIP_NPM_CI=1      skip `npm ci --omit=dev` (air-gapped install)
 *   UPDATE_NPM_CI_ARGS        extra npm ci args (e.g. "--offline")
 *   UPDATE_ROOT               staging root (default <project>/.updates)
 *   UPDATE_APP_ROOT           live app root to swap files into (default
 *                             <project>/, i.e. /app in the container) —
 *                             overridable so tests never touch a real checkout
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { spawn } = require('child_process');
const tar = require('tar');

const {
  TMP_DIR,
  LOG_FILE,
  readStatus,
  writeStatus,
  releaseLock,
  releasePathFor,
  verifyReleaseDir,
} = require('../server/services/updateInstallState.js');

const PROJECT_ROOT = process.env.UPDATE_APP_ROOT || path.resolve(__dirname, '..');

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  try {
    fs.appendFileSync(LOG_FILE, line + '\n');
  } catch (_e) {
    /* ignore */
  }
  // eslint-disable-next-line no-console
  console.log(line);
}

function fail(st, message) {
  writeStatus({
    state: 'failed',
    message: 'Update failed.',
    finishedAt: new Date().toISOString(),
    error: message,
  });
  releaseLock();
  log(`FAILED: ${message}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Download (follows redirects — GitHub tarballs 302 to codeload)
// ---------------------------------------------------------------------------
function fileUrlToPath(url) {
  const { pathname } = new URL(url);
  let p = decodeURIComponent(pathname);
  if (process.platform === 'win32' && p.startsWith('/')) p = p.slice(1);
  return p;
}

function download(url, destFile, expectedSha, onProgress) {
  return new Promise((resolve, reject) => {
    // Local tarball (file://) — supported so installs can be staged offline
    // and so the pipeline is testable without network access.
    if (url.startsWith('file://')) {
      const hash = crypto.createHash('sha256');
      const srcPath = fileUrlToPath(url);
      const total = (() => {
        try {
          return fs.statSync(srcPath).size;
        } catch (_e) {
          return 0;
        }
      })();
      let downloaded = 0;
      const rs = fs.createReadStream(srcPath);
      const out = fs.createWriteStream(destFile);
      const finish = () => {
        const sha = hash.digest('hex');
        if (expectedSha && sha !== expectedSha.toLowerCase()) {
          return reject(new Error(`Checksum mismatch (expected ${expectedSha}).`));
        }
        resolve({ size: fs.statSync(destFile).size, sha });
      };
      rs.on('data', (d) => {
        hash.update(d);
        downloaded += d.length;
        onProgress?.(downloaded, total);
      });
      rs.pipe(out);
      out.on('finish', () => {
        out.close();
        finish();
      });
      rs.on('error', reject);
      out.on('error', reject);
      return;
    }

    const hash = crypto.createHash('sha256');
    const out = fs.createWriteStream(destFile);
    let redirects = 0;

    const get = (u) => {
      https
        .get(
          u,
          {
            headers: {
              'User-Agent': 'mahali-light-pos',
              ...(process.env.UPDATE_TOKEN
                ? { Authorization: `Bearer ${process.env.UPDATE_TOKEN}` }
                : {}),
            },
          },
          (res) => {
          if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
            res.resume();
            if (++redirects > 5) return reject(new Error('Too many redirects.'));
            return get(new URL(res.headers.location, u).toString());
          }
          if (res.statusCode !== 200) {
            res.resume();
            return reject(new Error(`Download failed: HTTP ${res.statusCode}`));
          }
          const total = Number(res.headers['content-length']) || 0;
          let downloaded = 0;
          res.on('data', (d) => {
            hash.update(d);
            downloaded += d.length;
            onProgress?.(downloaded, total);
          });
          res.pipe(out);
          out.on('finish', () => {
            out.close();
            const sha = hash.digest('hex');
            if (expectedSha && sha !== expectedSha.toLowerCase()) {
              return reject(new Error(`Checksum mismatch (expected ${expectedSha}, got ${sha}).`));
            }
            resolve({ size: fs.statSync(destFile).size, sha });
          });
        })
        .on('error', reject);
    };

    get(url);
  });
}

// ---------------------------------------------------------------------------
// Subprocesses
// ---------------------------------------------------------------------------
function run(cmd, args, { cwd = PROJECT_ROOT, timeoutMs = 600000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd,
      shell: process.platform === 'win32',
      windowsHide: true,
    });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch (_e) {
        /* ignore */
      }
    }, timeoutMs);
    child.stdout?.on('data', (d) => {
      out += d;
    });
    child.stderr?.on('data', (d) => {
      err += d;
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ code: -1, out, err: e.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, out, err });
    });
  });
}

// ---------------------------------------------------------------------------
// Progress reporting
// ---------------------------------------------------------------------------
// Throttled so a fast local connection doesn't hammer the status file with a
// write on every chunk; always lets a changed whole percentage through.
function makeProgressReporter() {
  let lastWriteAt = 0;
  let lastPct = -1;
  return (downloaded, total) => {
    const pct = total > 0 ? Math.min(99, Math.floor((downloaded / total) * 100)) : null;
    const now = Date.now();
    if (pct === lastPct && now - lastWriteAt < 250) return;
    lastWriteAt = now;
    lastPct = pct;
    writeStatus({
      state: 'downloading',
      progress: pct,
      bytesDownloaded: downloaded,
      bytesTotal: total || null,
    });
  };
}

// ---------------------------------------------------------------------------
// Swap in the new release (Docker-native: no PM2, no separate release cwd —
// the new files simply become the live app under PROJECT_ROOT)
// ---------------------------------------------------------------------------
function isRunningInDocker() {
  try {
    return fs.existsSync('/.dockerenv');
  } catch (_e) {
    return false;
  }
}

// Moves src to dest. Prefers a fast, atomic rename, but files that have
// never been touched since the image was built still live in a read-only
// overlay2 layer — some overlay2/kernel combinations (observed under Docker
// Desktop's WSL2 backend) refuse to rename those with EXDEV even though
// src and dest are both under /app, because the rename would require an
// implicit copy-up the kernel won't do for us. Fall back to an explicit
// copy + remove in that case.
function moveInto(src, dest) {
  try {
    fs.renameSync(src, dest);
  } catch (err) {
    if (err.code !== 'EXDEV') throw err;
    fs.cpSync(src, dest, { recursive: true });
    fs.rmSync(src, { recursive: true, force: true });
  }
}

// Moves each entry from releaseDir over the matching live path, backing up
// whatever it replaces so a mid-swap failure can be rolled back cleanly.
// `server` and `package.json` must be present in the release; the rest are
// swapped only if the release actually has them (e.g. UPDATE_SKIP_NPM_CI
// means no node_modules was produced).
function swapInNewRelease(releaseDir) {
  const REQUIRED = ['server', 'package.json'];
  const OPTIONAL = ['shared', 'package-lock.json', 'node_modules'];
  const backupSuffix = `.update-rollback-${Date.now()}`;
  const swapped = []; // { live, backup: string|null }

  const swapOne = (name, required) => {
    const incoming = path.join(releaseDir, name);
    if (!fs.existsSync(incoming)) {
      if (required) throw new Error(`release is missing ${name}`);
      return;
    }
    const live = path.join(PROJECT_ROOT, name);
    const backup = live + backupSuffix;
    const backedUp = fs.existsSync(live);
    if (backedUp) moveInto(live, backup);
    try {
      moveInto(incoming, live);
    } catch (err) {
      if (backedUp) moveInto(backup, live);
      throw err;
    }
    swapped.push({ live, backup: backedUp ? backup : null });
  };

  try {
    for (const name of REQUIRED) swapOne(name, true);
    for (const name of OPTIONAL) swapOne(name, false);
  } catch (err) {
    // Undo whatever already swapped, most recent first.
    for (const { live, backup } of swapped.reverse()) {
      fs.rmSync(live, { recursive: true, force: true });
      if (backup && fs.existsSync(backup)) moveInto(backup, live);
    }
    throw err;
  }

  // Swap succeeded — drop the backups we made along the way.
  for (const { backup } of swapped) {
    if (backup) fs.rmSync(backup, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const version = String(process.argv[2] || '').replace(/^v/, '');
  if (!version) fail(readStatus(), 'Missing version argument.');
  const current = readStatus();
  if (current.version && current.version !== version) {
    fail(current, `Version mismatch: staging ${current.version}, target ${version}.`);
  }

  const releaseDir = releasePathFor(version);
  const tmpTarball = path.join(TMP_DIR, `update-${version}.tgz`);

  fs.mkdirSync(releaseDir, { recursive: true });

  // ---------- 1. Download ----------
  writeStatus({ state: 'downloading', version, message: 'Downloading update…' });
  const override = process.env.UPDATE_CHECK_URL;
  const isDirectTarball =
    override?.startsWith('file://') ||
    override?.endsWith('.tar.gz') ||
    override?.endsWith('.tgz');
  const tarballUrl = isDirectTarball
    ? override
    : `https://github.com/${process.env.UPDATE_REPO || 'Ali-Aldahmani/mahali-light'}/archive/refs/tags/v${version}.tar.gz`;
  log(`Downloading ${tarballUrl}`);
  try {
    fs.rmSync(tmpTarball, { force: true });
    await download(
      tarballUrl,
      tmpTarball,
      process.env.UPDATE_EXPECTED_SHA256,
      makeProgressReporter(),
    );
  } catch (err) {
    fail(readStatus(), `Download failed: ${err.message}`);
  }
  writeStatus({ progress: 100 });
  log('Download complete.');

  // ---------- 2. Extract + verify ----------
  writeStatus({ state: 'installing', message: 'Extracting and installing files…' });
  try {
    fs.rmSync(releaseDir, { recursive: true, force: true });
    fs.mkdirSync(releaseDir, { recursive: true });
    // strip: 1 drops the tarball's single top-level "<repo>-<ref>" folder.
    await tar.x({ file: tmpTarball, cwd: releaseDir, strip: 1 });

    const check = verifyReleaseDir(releaseDir, version);
    if (!check.ok) fail(readStatus(), check.reason);
  } catch (err) {
    fail(readStatus(), `File preparation failed: ${err.message}`);
  }

  // ---------- 3. Production dependencies ----------
  if (process.env.UPDATE_SKIP_NPM_CI !== '1') {
    try {
      log('Running npm ci --omit=dev');
      writeStatus({ state: 'installing', message: 'Installing dependencies…' });
      const extraArgs = (process.env.UPDATE_NPM_CI_ARGS || '').split(' ').filter(Boolean);
      const ci = await run('npm', ['ci', '--omit=dev'].concat(extraArgs), {
        cwd: releaseDir,
        timeoutMs: 900000,
      });
      if (ci.code !== 0) {
        // `npm ci` requires package.json and package-lock.json to match
        // byte-for-byte, which can fail across npm versions even when both
        // files are genuinely consistent (e.g. how optional per-platform
        // packages like esbuild's are recorded changed between npm
        // releases). The running container's npm is fixed at image build
        // time but release lockfiles come from whatever npm the release was
        // built with, so this drift is expected to recur — fall back to a
        // regular install rather than failing every such release.
        log(`npm ci failed, falling back to npm install: ${(ci.err || ci.out).slice(0, 400)}`);
        writeStatus({ message: 'Resolving dependency updates…' });
        const install = await run(
          'npm',
          ['install', '--omit=dev', '--no-audit', '--no-fund'].concat(extraArgs),
          { cwd: releaseDir, timeoutMs: 900000 },
        );
        if (install.code !== 0) {
          fail(readStatus(), `npm install failed: ${(install.err || install.out).slice(0, 800)}`);
        }
      }
    } catch (err) {
      fail(readStatus(), `Dependency install crashed: ${err.message}`);
    }
  }

  // ---------- 4. Swap the new files into place ----------
  writeStatus({ state: 'swapping', message: 'Replacing application files…', progress: 100 });
  log('Swapping in new release files…');
  try {
    swapInNewRelease(releaseDir);
  } catch (err) {
    fail(readStatus(), `Swap failed: ${err.message}`);
  }
  log('Swap complete.');
  try {
    fs.rmSync(releaseDir, { recursive: true, force: true });
  } catch (_e) {
    /* best-effort cleanup of the staging dir; the swap already succeeded */
  }

  // ---------- 5. Restart ----------
  // We stop here, deliberately. process.exit()/further writes from this
  // process are not reliable once PID 1 goes down (see the comment above
  // finalizeIfNeeded in updateCheckService.js) — the new process reports
  // its own success on boot.
  writeStatus({ state: 'restarting', message: 'Restarting server…' });
  if (isRunningInDocker()) {
    log(`Update ${version} staged. Restarting container…`);
    setTimeout(() => {
      try {
        process.kill(1, 'SIGTERM');
      } catch (err) {
        log(`Could not signal PID 1 to restart: ${err.message}`);
      }
    }, 800);
  } else {
    log(`Update ${version} staged, but this process is not running inside Docker — restart the app manually to pick it up.`);
  }
}

main().catch((err) => fail(readStatus(), err.message));