#!/usr/bin/env node
'use strict';

/**
 * Detached self-update runner for PM2 deployments.
 *
 * Spawned by POST /api/app-updates/install. The API process owns the install
 * lock and writes the "downloading" status before spawning us; we drive the
 * rest and finally restart PM2 (which kills the old API, not us — we run
 * detached). On success the new process boots from the release dir and
 * finalizes the status via GET /api/app-updates/status.
 *
 *   usage: node scripts/applyUpdate.js <version>
 *
 * Env knobs:
 *   UPDATE_CHECK_URL          direct .tar.gz URL override (else GitHub tag)
 *   UPDATE_REPO               default Ali-Aldahmani/mahali-light
 *   UPDATE_EXPECTED_SHA256    optional hex sha256 the tarball must match
 *   UPDATE_SKIP_NPM_CI=1      skip `npm ci --omit=dev` (air-gapped install)
 *   UPDATE_NPM_CI_ARGS        extra npm ci args (e.g. "--offline")
 *   PM2_BIN                   path to pm2 (default: pm2 from PATH)
 *   UPDATE_ROOT               staging root (default <project>/.updates)
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

const PROJECT_ROOT = path.resolve(__dirname, '..');
const ROOT_ECO = path.join(PROJECT_ROOT, 'ecosystem.config.js');
const ROOT_ENV = path.join(PROJECT_ROOT, '.env');
const PM2_BIN = process.env.PM2_BIN || 'pm2';

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

function download(url, destFile, expectedSha) {
  return new Promise((resolve, reject) => {
    // Local tarball (file://) — supported so installs can be staged offline
    // and so the pipeline is testable without network access.
    if (url.startsWith('file://')) {
      const hash = crypto.createHash('sha256');
      const rs = fs.createReadStream(fileUrlToPath(url));
      const out = fs.createWriteStream(destFile);
      const finish = () => {
        const sha = hash.digest('hex');
        if (expectedSha && sha !== expectedSha.toLowerCase()) {
          return reject(new Error(`Checksum mismatch (expected ${expectedSha}).`));
        }
        resolve({ size: fs.statSync(destFile).size, sha });
      };
      rs.on('data', (d) => hash.update(d));
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
        .get(u, { headers: { 'User-Agent': 'mahali-light-pos' } }, (res) => {
          if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
            res.resume();
            if (++redirects > 5) return reject(new Error('Too many redirects.'));
            return get(new URL(res.headers.location, u).toString());
          }
          if (res.statusCode !== 200) {
            res.resume();
            return reject(new Error(`Download failed: HTTP ${res.statusCode}`));
          }
          res.on('data', (d) => hash.update(d));
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
    await download(tarballUrl, tmpTarball, process.env.UPDATE_EXPECTED_SHA256);
  } catch (err) {
    fail(readStatus(), `Download failed: ${err.message}`);
  }
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

    // Copy .env if the deployment keeps one at the project root.
    if (fs.existsSync(ROOT_ENV)) {
      fs.copyFileSync(ROOT_ENV, path.join(releaseDir, '.env'));
    }
  } catch (err) {
    fail(readStatus(), `File preparation failed: ${err.message}`);
  }

  // ---------- 3. Production dependencies ----------
  if (process.env.UPDATE_SKIP_NPM_CI !== '1') {
    try {
      log('Running npm ci --omit=dev');
      writeStatus({ state: 'installing', message: 'Installing dependencies…' });
      const args = ['ci', '--omit=dev'].concat(
        (process.env.UPDATE_NPM_CI_ARGS || '').split(' ').filter(Boolean),
      );
      const npm = await run('npm', args, { cwd: releaseDir, timeoutMs: 900000 });
      if (npm.code !== 0) {
        fail(readStatus(), `npm ci failed: ${(npm.err || npm.out).slice(0, 800)}`);
      }
    } catch (err) {
      fail(readStatus(), `npm ci crashed: ${err.message}`);
    }
  }

  // ---------- 4. Swap + restart via PM2 ----------
  writeStatus({ state: 'swapping', message: 'Replacing application files…' });
  const ecoPath = path.join(releaseDir, 'ecosystem.config.js');
  const eco = `module.exports = {
  apps: [{
    name: 'mahali-light',
    script: 'server/index.js',
    cwd: ${JSON.stringify(releaseDir)},
    watch: false,
    autorestart: true,
    restart_delay: 8000,
    max_restarts: 10,
    min_uptime: '30s',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    error_file: 'logs/pm2-error.log',
    out_file: 'logs/pm2-out.log',
    merge_logs: true,
    env: { NODE_ENV: 'production' },
  }],
};
`;
  try {
    fs.writeFileSync(ecoPath, eco);
  } catch (err) {
    fail(readStatus(), `Could not write ecosystem config: ${err.message}`);
  }

  writeStatus({ state: 'restarting', message: 'Restarting server…' });
  log('Restarting via PM2…');
  try {
    // Ignore a failed delete (app may be named differently or missing).
    await run(PM2_BIN, ['delete', 'mahali-light'], { timeoutMs: 30000 });
    const start = await run(PM2_BIN, ['start', ecoPath], { timeoutMs: 60000 });
    if (start.code !== 0) {
      // Roll back to the pre-existing config so the POS stays online.
      if (fs.existsSync(ROOT_ECO)) {
        log('Start failed; rolling back to previous ecosystem.');
        await run(PM2_BIN, ['start', ROOT_ECO], { timeoutMs: 60000 });
      }
      fail(readStatus(), `pm2 start failed: ${(start.err || start.out).slice(0, 800)}`);
    }
    await run(PM2_BIN, ['save'], { timeoutMs: 30000 }); // persist boot autostart
  } catch (err) {
    fail(readStatus(), `PM2 restart failed: ${err.message}`);
  }

  writeStatus({
    state: 'done',
    message: 'Update installed.',
    finishedAt: new Date().toISOString(),
    error: null,
  });
  releaseLock();
  log(`Update ${version} installed successfully.`);
}

main().catch((err) => fail(readStatus(), err.message));