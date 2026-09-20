/**
 * Unit tests for the self-update state files (status.json, install.lock) and
 * for the lock-gated startInstall path. A temp UPDATE_ROOT keeps these tests
 * off the real repo's `.updates/` directory.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'mahali-upd-'));
process.env.UPDATE_ROOT = ROOT;

const state = await import('../../server/services/updateInstallState.js');
const service = await import('../../server/services/updateCheckService.js');

afterAll(() => {
  fs.rmSync(ROOT, { recursive: true, force: true });
});

describe('updateInstallState (status file)', () => {
  it('returns an idle default when no status file exists', () => {
    expect(state.readStatus()).toEqual({
      state: 'idle',
      version: null,
      message: null,
      startedAt: null,
      finishedAt: null,
      error: null,
    });
  });

  it('merges patches and persists to disk', () => {
    state.writeStatus({ state: 'downloading', version: '1.2.0', message: 'Fetching…' });
    state.writeStatus({ message: 'Fetching payload…' });
    const st = state.readStatus();
    expect(st.state).toBe('downloading');
    expect(st.version).toBe('1.2.0');
    expect(st.message).toBe('Fetching payload…');
    expect(fs.existsSync(state.STATUS_FILE)).toBe(true);
  });

  it('tracks active states via isInstalling', () => {
    state.writeStatus({ state: 'downloading' });
    expect(state.isInstalling()).toBe(true);
    state.writeStatus({ state: 'idle' });
    expect(state.isInstalling()).toBe(false);
    state.writeStatus({ state: 'failed' });
    expect(state.isInstalling()).toBe(false);
  });

  it('builds a clean release path per version', () => {
    expect(state.releasePathFor('v1.2.0')).toBe(path.join(ROOT, 'releases', 'v1.2.0'));
    expect(state.releasePathFor('1.2.0')).toBe(path.join(ROOT, 'releases', 'v1.2.0'));
  });
});

describe('verifyReleaseDir', () => {
  const release = state.releasePathFor('1.2.0');

  beforeEach(() => {
    fs.rmSync(release, { recursive: true, force: true });
    fs.mkdirSync(path.join(release, 'server'), { recursive: true });
  });

  it('accepts a valid release matching the target version', () => {
    fs.writeFileSync(path.join(release, 'package.json'), JSON.stringify({ version: '1.2.0' }));
    fs.writeFileSync(path.join(release, 'server', 'index.js'), '');
    expect(state.verifyReleaseDir(release, 'v1.2.0')).toEqual({ ok: true });
  });

  it('rejects a version mismatch', () => {
    fs.writeFileSync(path.join(release, 'package.json'), JSON.stringify({ version: '1.1.0' }));
    fs.writeFileSync(path.join(release, 'server', 'index.js'), '');
    expect(state.verifyReleaseDir(release, '1.2.0').ok).toBe(false);
  });

  it('rejects a directory without the API entrypoint', () => {
    fs.writeFileSync(path.join(release, 'package.json'), JSON.stringify({ version: '1.2.0' }));
    expect(state.verifyReleaseDir(release, '1.2.0').ok).toBe(false);
  });

  it('rejects a missing package.json', () => {
    expect(state.verifyReleaseDir(release, '1.2.0').ok).toBe(false);
  });
});

describe('updateInstallState (lock)', () => {
  it('enforces an exclusive lock', () => {
    state.releaseLock();
    expect(state.tryAcquireLock()).toBe(true);
    expect(state.tryAcquireLock()).toBe(false);
    state.releaseLock();
    expect(state.tryAcquireLock()).toBe(true);
    state.releaseLock();
  });
});

describe('startInstall (lock gating)', () => {
  it('refuses to start a second install while one is active', () => {
    service.clearCache();
    // Hold the lock as an in-flight install would have done.
    expect(state.tryAcquireLock()).toBe(true);
    state.writeStatus({ state: 'downloading', version: '1.2.0' });

    expect(service.startInstall('1.2.0')).toBeNull();
    state.releaseLock();
  });

  it('requires a non-empty version', () => {
    expect(() => service.startInstall('')).toThrowError(
      expect.objectContaining({ code: 'VALIDATION_FAILED' }),
    );
  });
});