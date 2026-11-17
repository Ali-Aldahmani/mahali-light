import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

const require = createRequire(import.meta.url);
const { backupConfig } = require('../../server/backup/strategies/configBackup');
const { backupUploads } = require('../../server/backup/strategies/uploadsBackup');

// Minimal zip reader (central directory + stored/deflate entries) so the test
// checks the real bytes on disk without adding an unzip dependency.
function readZip(file) {
  const buf = fs.readFileSync(file);
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip: no end-of-central-directory record');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = {};
  for (let n = 0; n < count; n += 1) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('bad central directory');
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;

    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const start = localOff + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(start, start + compSize);
    if (name.endsWith('/')) continue;
    entries[name] = (method === 8 ? zlib.inflateRawSync(raw) : raw).toString('utf8');
  }
  return entries;
}

function write(root, rel, content) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

describe('backup zip strategies (archiver v8)', () => {
  let dir;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mahali-zip-test-'));
  });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.MAHALI_UPLOADS_DIR;
  });

  it('backupConfig zips server/config and leaves secrets out', async () => {
    const root = path.join(dir, 'app');
    write(root, 'server/config/storeSettings.js', 'module.exports = { name: "shop" };');
    write(root, 'server/config/nested/tax.json', '{"vat":16}');
    write(root, 'server/config/prod.env', 'SECRET=1');
    write(root, 'server/config/.env', 'SECRET=2');
    write(root, 'server/config/key.secret', 'SECRET=3');
    vi.spyOn(process, 'cwd').mockReturnValue(root);

    const out = path.join(dir, 'out', 'config.zip');
    const res = await backupConfig(out, { compressionLevel: 9 });

    expect(res.path).toBe(out);
    expect(res.sizeBytes).toBe(fs.statSync(out).size);
    const entries = readZip(out);
    expect(Object.keys(entries).sort()).toEqual(['nested/tax.json', 'storeSettings.js']);
    expect(entries['nested/tax.json']).toBe('{"vat":16}');
  });

  it('backupConfig emits a valid empty zip when server/config is missing', async () => {
    const root = path.join(dir, 'empty-app');
    fs.mkdirSync(root, { recursive: true });
    vi.spyOn(process, 'cwd').mockReturnValue(root);

    const out = path.join(dir, 'out', 'config-empty.zip');
    await backupConfig(out);
    expect(readZip(out)).toEqual({});
  });

  it('backupUploads zips the uploads dir and skips OS junk', async () => {
    const up = path.join(dir, 'uploads');
    const png = 'x'.repeat(5000);
    write(up, 'products/1.png', png);
    write(up, 'logo.svg', '<svg/>');
    write(up, 'Thumbs.db', 'junk');
    write(up, '.DS_Store', 'junk');
    process.env.MAHALI_UPLOADS_DIR = up;

    const out = path.join(dir, 'out', 'uploads.zip');
    const res = await backupUploads(out, { compressionLevel: 6 });

    expect(res.sizeBytes).toBeGreaterThan(0);
    expect(res.sizeBytes).toBeLessThan(png.length); // actually deflated
    const entries = readZip(out);
    expect(Object.keys(entries).sort()).toEqual(['logo.svg', 'products/1.png']);
    expect(entries['products/1.png']).toBe(png);
  });

  it('backupUploads emits a valid empty zip on a fresh install', async () => {
    process.env.MAHALI_UPLOADS_DIR = path.join(dir, 'no-such-uploads');
    const out = path.join(dir, 'out', 'uploads-empty.zip');
    await backupUploads(out);
    expect(readZip(out)).toEqual({});
  });
});
