/**
 * Unit tests for updateCheckService.
 *
 * Focus areas:
 *   1. Version parsing / comparison — prereleases sort below releases.
 *   2. Upstream fetch — success, non-OK responses, and unreachable hosts.
 *   3. Result shape — updateAvailable flag vs current installed version.
 *   4. Caching — a fresh cache entry prevents repeated upstream fetches.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const service = await import('../../server/services/updateCheckService.js');

// ---------------------------------------------------------------------------
// Version parsing + comparison
// ---------------------------------------------------------------------------
describe('parseVersion', () => {
  it('strips a leading v and splits numeric parts', () => {
    expect(service.parseVersion('v1.2.3')).toEqual({
      major: 1,
      minor: 2,
      patch: 3,
      pre: null,
    });
  });

  it('keeps a prerelease suffix separately', () => {
    expect(service.parseVersion('1.2.0-beta')).toEqual({
      major: 1,
      minor: 2,
      patch: 0,
      pre: 'beta',
    });
  });

  it('degrades gracefully on garbage input', () => {
    expect(service.parseVersion('')).toEqual({
      major: 0,
      minor: 0,
      patch: 0,
      pre: null,
    });
  });
});

describe('compareVersions', () => {
  it('returns 1 when a is newer', () => {
    expect(service.compareVersions('v2.0.0', '1.1.0')).toBe(1);
    expect(service.compareVersions('v1.10.0', '1.9.9')).toBe(1);
  });

  it('returns -1 when a is older', () => {
    expect(service.compareVersions('1.0.0', 'v1.0.1')).toBe(-1);
  });

  it('returns 0 for equal versions', () => {
    expect(service.compareVersions('v1.1.0', '1.1.0')).toBe(0);
  });

  it('sorts a prerelease below its release', () => {
    expect(service.compareVersions('1.2.0-beta', '1.2.0')).toBe(-1);
    expect(service.compareVersions('1.2.0', '1.2.0-rc1')).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Upstream fetch
// ---------------------------------------------------------------------------
const OK_RELEASE = {
  tag_name: 'v9.9.9',
  html_url: 'https://github.com/Ali-Aldahmani/mahali-light/releases/tag/v9.9.9',
  published_at: '2026-09-01T00:00:00Z',
  name: 'v9.9.9',
  body: 'Release notes.',
};

beforeEach(() => {
  process.env.UPDATE_CHECK_URL = 'https://updates.example.test/latest';
  delete process.env.UPDATE_CACHE_MS;
  service.clearCache();
});

afterEach(() => {
  delete process.env.UPDATE_CHECK_URL;
  delete process.env.UPDATE_TOKEN;
  vi.unstubAllGlobals();
});

describe('checkForUpdates', () => {
  it('reports updateAvailable when the remote tag is newer', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => OK_RELEASE,
    }));

    const result = await service.checkForUpdates();
    expect(result.updateAvailable).toBe(true);
    expect(result.latestVersion).toBe('9.9.9');
    expect(result.currentVersion).not.toBe('9.9.9');
    expect(result.releaseUrl).toBe(OK_RELEASE.html_url);
  });

  it('reports no update when the remote tag matches the installed version', async () => {
    const current = service.currentVersion();
    const tag = `v${current}`;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ...OK_RELEASE, tag_name: tag }),
    }));

    const result = await service.checkForUpdates();
    expect(result.updateAvailable).toBe(false);
    expect(result.latestVersion).toBe(current);
  });

it('throws SYS_UPDATES_UNREACHABLE on a non-OK upstream response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    }));

    await expect(service.checkForUpdates()).rejects.toMatchObject({
      code: 'SYS_UPDATES_UNREACHABLE',
    });
  });

  it('treats a 404 as "no releases published yet", not an outage', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    }));

    await expect(service.checkForUpdates()).rejects.toMatchObject({
      code: 'BIZ_INVALID_STATE',
      status: 404,
    });
  });

  it('throws SYS_UPDATES_UNREACHABLE when the network fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('EHOSTUNREACH')));

    await expect(service.checkForUpdates()).rejects.toMatchObject({
      code: 'SYS_UPDATES_UNREACHABLE',
    });
  });

  it('caches the result so the upstream is fetched at most once per window', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => OK_RELEASE,
    });
    vi.stubGlobal('fetch', fetchMock);

    await service.checkForUpdates();
    await service.checkForUpdates();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('skips the cache when UPDATE_CACHE_MS is 0', async () => {
    process.env.UPDATE_CACHE_MS = '0';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => OK_RELEASE,
    });
    vi.stubGlobal('fetch', fetchMock);

    await service.checkForUpdates();
    await service.checkForUpdates();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('sends a bearer token when UPDATE_TOKEN is set', async () => {
    process.env.UPDATE_TOKEN = 'ghp_token123';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => OK_RELEASE,
    });
    vi.stubGlobal('fetch', fetchMock);

    await service.checkForUpdates();
    const [, opts] = fetchMock.mock.calls[0];
    expect(opts.headers.Authorization).toBe('Bearer ghp_token123');
  });

  it('points downloadUrl at the GitHub tag tarball for JSON endpoints', async () => {
    delete process.env.UPDATE_CHECK_URL;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => OK_RELEASE,
    }));

    const result = await service.checkForUpdates();
    expect(result.downloadUrl).toBe(
      'https://github.com/Ali-Aldahmani/mahali-light/archive/refs/tags/v9.9.9.tar.gz',
    );
  });

  it('requests the releases API with the owner/repo slash unescaped', async () => {
    delete process.env.UPDATE_CHECK_URL;
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => OK_RELEASE,
    });
    vi.stubGlobal('fetch', fetchMock);

    await service.checkForUpdates();
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe(
      'https://api.github.com/repos/Ali-Aldahmani/mahali-light/releases/latest',
    );
  });

  it('uses the override URL directly when UPDATE_CHECK_URL is a tarball', async () => {
    process.env.UPDATE_CHECK_URL = 'https://cdn.example.test/mahali-light.tar.gz';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => OK_RELEASE,
    }));

    const result = await service.checkForUpdates();
    expect(result.downloadUrl).toBe('https://cdn.example.test/mahali-light.tar.gz');
  });
});

describe('tarballUrlFor', () => {
  it('normalises the version and encodes the repo', () => {
    expect(service.tarballUrlFor('v1.2.0')).toBe(
      'https://github.com/Ali-Aldahmani/mahali-light/archive/refs/tags/v1.2.0.tar.gz',
    );
  });
});

describe('resolveInstallTarget', () => {
  it('returns the check result when an update is available', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => OK_RELEASE,
    }));

    const target = await service.resolveInstallTarget();
    expect(target.updateAvailable).toBe(true);
    expect(target.latestVersion).toBe('9.9.9');
  });

  it('throws BIZ_INVALID_STATE when already up to date', async () => {
    const current = service.currentVersion();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ...OK_RELEASE, tag_name: `v${current}` }),
    }));

    await expect(service.resolveInstallTarget()).rejects.toMatchObject({
      code: 'BIZ_INVALID_STATE',
      status: 409,
    });
  });
});