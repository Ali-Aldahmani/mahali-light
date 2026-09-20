/**
 * End-to-end test for scripts/applyUpdate.js run as a subprocess.
 *
 * Drives the real download → extract → verify → (skipped) npm ci → PM2
 * swap pipeline against a local file:// tarball and a stub pm2, so no
 * network and no real PM2 are needed.
 */
import { describe, it, expect, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { create as tarCreate } from 'tar';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'mahali-e2e-'));
const UPDATE_ROOT = path.join(WORK, '.updates');
const PM2_LOG = path.join(WORK, 'pm2.log');

const isWin = process.platform === 'win32';
const PM2_STUB = path.join(WORK, isWin ? 'pm2-stub.cmd' : 'pm2-stub.sh');

function runNode(script, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd: REPO_ROOT,
      env: { ...process.env, ...env },
      windowsHide: true,
    });
    let out = '';
    child.stdout.on('data', (d) => {
      out += d;
    });
    child.stderr.on('data', (d) => {
      out += d;
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, out }));
  });
}

afterAll(() => {
  fs.rmSync(WORK, { recursive: true, force: true });
});

describe('applyUpdate.js', () => {
  it('downloads, verifies, swaps and restarts a release via PM2', async () => {
    // Build a fake release tree (like the GitHub <repo>-<ref> folder) and
    // pack it into the tarball the runner will download.
    const build = path.join(WORK, 'build');
    const fake = path.join(build, 'fake-mahali-light');
    fs.mkdirSync(path.join(fake, 'server'), { recursive: true });
    fs.writeFileSync(
      path.join(fake, 'package.json'),
      JSON.stringify({ name: 'mahali-light', version: '9.9.9' }),
    );
    fs.writeFileSync(path.join(fake, 'server', 'index.js'), '// dummy entry\n');

    const tarball = path.join(WORK, 'release-9.9.9.tar.gz');
    await tarCreate({ cwd: build, gzip: true, file: tarball }, ['fake-mahali-light']);

    // Stub pm2 that records its invocations and always succeeds.
    if (isWin) {
      fs.writeFileSync(
        PM2_STUB,
        '@echo off\r\necho %*>> "%PM2_LOG%" 2>nul\r\nexit /b 0\r\n',
      );
    } else {
      fs.writeFileSync(
        PM2_STUB,
        `#!/bin/sh\nprintf '%s\\n' "$*" >> "${PM2_LOG}"\nexit 0\n`,
        { mode: 0o755 },
      );
    }

    const res = await runNode(
      path.join(REPO_ROOT, 'scripts', 'applyUpdate.js'),
      ['9.9.9'],
      {
        UPDATE_ROOT,
        UPDATE_CHECK_URL: `file://${tarball}`,
        UPDATE_SKIP_NPM_CI: '1',
        PM2_BIN: PM2_STUB,
        PM2_LOG,
      },
    );
    expect(res.code).toBe(0);

    // Status finished as "done" and the install lock was released.
    const status = JSON.parse(
      fs.readFileSync(path.join(UPDATE_ROOT, 'status.json'), 'utf8'),
    );
    expect(status.state).toBe('done');
    expect(status.version).toBe('9.9.9');
    expect(fs.existsSync(path.join(UPDATE_ROOT, 'install.lock'))).toBe(false);

    // The release dir holds a ready-to-run app + generated ecosystem config.
    const releaseDir = path.join(UPDATE_ROOT, 'releases', 'v9.9.9');
    expect(fs.existsSync(path.join(releaseDir, 'package.json'))).toBe(true);
    expect(fs.existsSync(path.join(releaseDir, 'server', 'index.js'))).toBe(true);
    const eco = fs.readFileSync(path.join(releaseDir, 'ecosystem.config.js'), 'utf8');
    expect(eco).toContain("name: 'mahali-light'");
    expect(eco).toContain('server/index.js');

    // PM2 was invoked for delete → start → save.
    const pm2Calls = fs.readFileSync(PM2_LOG, 'utf8');
    const calls = pm2Calls
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
      .join(' ');
    expect(calls).toContain('delete mahali-light');
    expect(calls).toContain('start');
    expect(calls).toContain('save');
  });

  it('fails cleanly on a checksum mismatch and never touches PM2', async () => {
    const build = path.join(WORK, 'build2');
    const fake = path.join(build, 'fake-mahali-light');
    fs.mkdirSync(path.join(fake, 'server'), { recursive: true });
    fs.writeFileSync(
      path.join(fake, 'package.json'),
      JSON.stringify({ name: 'mahali-light', version: '8.8.8' }),
    );
    fs.writeFileSync(path.join(fake, 'server', 'index.js'), '// dummy entry\n');

    const tarball = path.join(WORK, 'release-8.8.8.tar.gz');
    await tarCreate({ cwd: build, gzip: true, file: tarball }, ['fake-mahali-light']);

    const res = await runNode(
      path.join(REPO_ROOT, 'scripts', 'applyUpdate.js'),
      ['8.8.8'],
      {
        UPDATE_ROOT: path.join(WORK, '.updates2'),
        UPDATE_CHECK_URL: `file://${tarball}`,
        UPDATE_SKIP_NPM_CI: '1',
        UPDATE_EXPECTED_SHA256: '0'.repeat(64),
        PM2_BIN: PM2_STUB,
        PM2_LOG: path.join(WORK, 'pm2-2.log'),
      },
    );
    expect(res.code).toBe(1);

    const status = JSON.parse(
      fs.readFileSync(path.join(WORK, '.updates2', 'status.json'), 'utf8'),
    );
    expect(status.state).toBe('failed');
    expect(status.error).toContain('Checksum mismatch');
    expect(fs.existsSync(path.join(WORK, '.updates2', 'install.lock'))).toBe(false);
    expect(fs.existsSync(path.join(WORK, '.updates2', 'releases', 'v8.8.8', 'ecosystem.config.js'))).toBe(false);
  });
});