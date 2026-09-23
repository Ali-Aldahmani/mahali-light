import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { encryptFile, decryptFile, isEncryptedFile } = require('../../server/backup/encryption');

const SECRET = 'unit-test-backup-secret-0123456789abcdef';

describe('backup archive encryption', () => {
  let dir;
  let plain;
  let original;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mahali-enc-test-'));
    plain = path.join(dir, 'archive.tar.gz');
    // Several stream chunks, plus a recognisable marker to search for.
    original = Buffer.concat([
      Buffer.from('CUSTOMER-PASSWORD-HASH-MARKER'),
      crypto.randomBytes(300 * 1024),
    ]);
    fs.writeFileSync(plain, original);
  });

  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('round-trips a multi-chunk file and hides its contents', async () => {
    const enc = path.join(dir, 'a.enc');
    const out = path.join(dir, 'a.out');
    await encryptFile(plain, enc, SECRET);
    const encBytes = fs.readFileSync(enc);
    expect(encBytes.includes(Buffer.from('CUSTOMER-PASSWORD-HASH-MARKER'))).toBe(false);
    expect(await isEncryptedFile(enc)).toBe(true);
    expect(await isEncryptedFile(plain)).toBe(false);

    await decryptFile(enc, out, SECRET);
    expect(fs.readFileSync(out).equals(original)).toBe(true);
  });

  it('uses a fresh salt and IV per file', async () => {
    const e1 = path.join(dir, 'b1.enc');
    const e2 = path.join(dir, 'b2.enc');
    await encryptFile(plain, e1, SECRET);
    await encryptFile(plain, e2, SECRET);
    expect(fs.readFileSync(e1).equals(fs.readFileSync(e2))).toBe(false);
  });

  it('rejects the wrong secret without leaving partial output', async () => {
    const enc = path.join(dir, 'c.enc');
    const out = path.join(dir, 'c.out');
    await encryptFile(plain, enc, SECRET);
    await expect(decryptFile(enc, out, 'some-other-secret')).rejects.toMatchObject({
      code: 'BIZ_BACKUP_DECRYPT_FAILED',
    });
    expect(fs.existsSync(out)).toBe(false);
  });

  it.each([
    ['ciphertext', (size) => 100 * 1024],
    ['header salt', () => 12],
    ['auth tag', (size) => size - 1],
  ])('detects a flipped byte in the %s', async (_label, offsetFor) => {
    const enc = path.join(dir, `d-${_label.replace(' ', '')}.enc`);
    await encryptFile(plain, enc, SECRET);
    const bytes = fs.readFileSync(enc);
    bytes[offsetFor(bytes.length)] ^= 0x01;
    fs.writeFileSync(enc, bytes);
    await expect(decryptFile(enc, path.join(dir, 'd.out'), SECRET)).rejects.toMatchObject({
      code: 'BIZ_BACKUP_DECRYPT_FAILED',
    });
  });

  it('refuses a plaintext archive', async () => {
    await expect(decryptFile(plain, path.join(dir, 'e.out'), SECRET)).rejects.toMatchObject({
      code: 'BIZ_BACKUP_DECRYPT_FAILED',
    });
  });
});
