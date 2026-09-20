/**
 * End-to-end test for scripts/applyUpdate.js run as a subprocess.
 *
 * Drives the real download → extract → verify → (skipped) npm ci → swap
 * pipeline against a local file:// tarball and a scratch "live app" root
 * (UPDATE_APP_ROOT), so no network, no real container and no real checkout
 * are touched.
 */
import { describe, it, expect, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { create as tarCreate } from 'tar';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'mahali-e2e-'));

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

// Seeds a scratch "live app" directory that looks like /app in the
// container: an old version's server/, shared/ and package.json.
function seedLiveRoot(version) {
  const root = fs.mkdtempSync(path.join(WORK, 'live-'));
  fs.mkdirSync(path.join(root, 'server'), { recursive: true });
  fs.mkdirSync(path.join(root, 'shared'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ name: 'mahali-light', version }),
  );
  fs.writeFileSync(path.join(root, 'server', 'index.js'), '// old entry\n');
  fs.writeFileSync(path.join(root, 'shared', 'marker.js'), '// old shared\n');
  return root;
}

function buildReleaseTarball(dir, version) {
  const build = path.join(dir, 'build');
  const fake = path.join(build, 'fake-mahali-light');
  fs.mkdirSync(path.join(fake, 'server'), { recursive: true });
  fs.mkdirSync(path.join(fake, 'shared'), { recursive: true });
  fs.writeFileSync(
    path.join(fake, 'package.json'),
    JSON.stringify({ name: 'mahali-light', version }),
  );
  fs.writeFileSync(path.join(fake, 'server', 'index.js'), `// entry v${version}\n`);
  fs.writeFileSync(path.join(fake, 'shared', 'marker.js'), `// shared v${version}\n`);

  const tarball = path.join(dir, `release-${version}.tar.gz`);
  return tarCreate({ cwd: build, gzip: true, file: tarball }, ['fake-mahali-light']).then(
    () => tarball,
  );
}

afterAll(() => {
  fs.rmSync(WORK, { recursive: true, force: true });
});

describe('applyUpdate.js', () => {
  it('downloads, verifies and swaps the release into the live app root', async () => {
    const dir = fs.mkdtempSync(path.join(WORK, 'ok-'));
    const tarball = await buildReleaseTarball(dir, '9.9.9');
    const liveRoot = seedLiveRoot('1.0.0');
    const updateRoot = path.join(dir, '.updates');

    const res = await runNode(
      path.join(REPO_ROOT, 'scripts', 'applyUpdate.js'),
      ['9.9.9'],
      {
        UPDATE_ROOT: updateRoot,
        UPDATE_APP_ROOT: liveRoot,
        UPDATE_CHECK_URL: `file://${tarball}`,
        UPDATE_SKIP_NPM_CI: '1',
      },
    );
    expect(res.code).toBe(0);

    // Not running inside a real container (no /.dockerenv), so the runner
    // reports "staged, restart manually" and stops at 'restarting' rather
    // than signalling PID 1 — see scripts/applyUpdate.js main().
    const status = JSON.parse(fs.readFileSync(path.join(updateRoot, 'status.json'), 'utf8'));
    expect(status.state).toBe('restarting');
    expect(status.version).toBe('9.9.9');
    expect(status.progress).toBe(100);

    // The live root now runs the new release: files were swapped in place,
    // not left in a separate release directory.
    const pkg = JSON.parse(fs.readFileSync(path.join(liveRoot, 'package.json'), 'utf8'));
    expect(pkg.version).toBe('9.9.9');
    expect(fs.readFileSync(path.join(liveRoot, 'server', 'index.js'), 'utf8')).toContain('v9.9.9');
    expect(fs.readFileSync(path.join(liveRoot, 'shared', 'marker.js'), 'utf8')).toContain('v9.9.9');

    // The staging release dir and downloaded tarball are cleaned up after a
    // successful swap, and no rollback backups are left behind.
    expect(fs.existsSync(path.join(updateRoot, 'releases', 'v9.9.9'))).toBe(false);
    expect(fs.existsSync(path.join(updateRoot, 'tmp', 'update-9.9.9.tgz'))).toBe(false);
    const leftovers = fs.readdirSync(liveRoot).filter((f) => f.includes('.update-rollback-'));
    expect(leftovers).toEqual([]);
  });

  it('fails cleanly on a checksum mismatch and never touches the live app root', async () => {
    const dir = fs.mkdtempSync(path.join(WORK, 'bad-'));
    const tarball = await buildReleaseTarball(dir, '8.8.8');
    const liveRoot = seedLiveRoot('1.0.0');
    const updateRoot = path.join(dir, '.updates');

    const res = await runNode(
      path.join(REPO_ROOT, 'scripts', 'applyUpdate.js'),
      ['8.8.8'],
      {
        UPDATE_ROOT: updateRoot,
        UPDATE_APP_ROOT: liveRoot,
        UPDATE_CHECK_URL: `file://${tarball}`,
        UPDATE_SKIP_NPM_CI: '1',
        UPDATE_EXPECTED_SHA256: '0'.repeat(64),
      },
    );
    expect(res.code).toBe(1);

    const status = JSON.parse(fs.readFileSync(path.join(updateRoot, 'status.json'), 'utf8'));
    expect(status.state).toBe('failed');
    expect(status.error).toContain('Checksum mismatch');
    expect(fs.existsSync(path.join(updateRoot, 'install.lock'))).toBe(false);

    // Never got past the download, so the live app is untouched.
    const pkg = JSON.parse(fs.readFileSync(path.join(liveRoot, 'package.json'), 'utf8'));
    expect(pkg.version).toBe('1.0.0');
  });
});
