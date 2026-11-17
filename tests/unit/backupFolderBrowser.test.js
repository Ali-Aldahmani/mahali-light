import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const folderBrowser = require('../../server/backup/folderBrowser');

describe('backup folder browser', () => {
  let dir;

  beforeAll(() => {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mahali-folders-')));
    for (const d of ['beta', 'Alpha', 'folder10', 'folder2', '.hidden', '$RECYCLE.BIN']) {
      fs.mkdirSync(path.join(dir, d));
    }
    fs.writeFileSync(path.join(dir, 'secret.txt'), 'not a folder');
  });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
  afterEach(() => vi.restoreAllMocks());

  it('lists only folders, sorted naturally, without hidden or system ones', async () => {
    const res = await folderBrowser.browse(dir);
    expect(res.path).toBe(dir);
    expect(res.folders.map((f) => f.name)).toEqual(['Alpha', 'beta', 'folder2', 'folder10']);
    expect(res.folders[0].path).toBe(path.join(dir, 'Alpha'));
    expect(res.parent).toBe(path.dirname(dir));
    expect(res.writable).toBe(true);
    expect(res.sep).toBe(path.sep);
    expect(res.roots[0]).toEqual({ name: 'Server app folder', path: process.cwd() });
  });

  it('opens the nearest existing folder when the path does not exist yet', async () => {
    const res = await folderBrowser.browse(path.join(dir, 'beta', 'not', 'yet', 'made'));
    expect(res.path).toBe(path.join(dir, 'beta'));
  });

  it('resolves relative paths (and the empty default) from the server folder', async () => {
    vi.spyOn(process, 'cwd').mockReturnValue(dir);
    expect((await folderBrowser.browse('beta')).path).toBe(path.join(dir, 'beta'));
    // ./backups does not exist here, so it falls back to the server folder.
    expect((await folderBrowser.browse('')).path).toBe(dir);
  });

  it('has no parent at the filesystem root', async () => {
    const root = path.parse(dir).root;
    const res = await folderBrowser.browse(root);
    expect(res.parent).toBeNull();
  });

  it('creates a folder and returns its listing', async () => {
    const res = await folderBrowser.createFolder(dir, 'pos-backups');
    expect(res.path).toBe(path.join(dir, 'pos-backups'));
    expect(fs.statSync(res.path).isDirectory()).toBe(true);
  });

  it('refuses to create a folder that already exists', async () => {
    await expect(folderBrowser.createFolder(dir, 'beta')).rejects.toMatchObject({ status: 409 });
  });

  it.each(['', '..', 'a/b', 'a\\b', 'x:y', 'bad*name', 'a'.repeat(256)])(
    'rejects the folder name %j',
    async (name) => {
      await expect(folderBrowser.createFolder(dir, name)).rejects.toMatchObject({ status: 400 });
      expect(folderBrowser.validateFolderName(name)).toBeTruthy();
    },
  );

  it('refuses to create inside a parent that does not exist', async () => {
    await expect(folderBrowser.createFolder(path.join(dir, 'nope'), 'x')).rejects.toMatchObject({ status: 400 });
  });
});
