/**
 * Startup secret checks (engineering audit F-BAK-03): the backup secret gets
 * the same placeholder rule as JWT_SECRET, without bricking shops whose
 * existing (short) secret protects their encrypted backups.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { assertBackupSecret, assertJwtSecret } = require('../../server/utils/startupSecrets');

const saved = { ...process.env };
afterEach(() => {
  for (const k of ['MAHALI_BACKUP_SECRET', 'JWT_SECRET', 'NODE_ENV']) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.restoreAllMocks();
});

const PLACEHOLDER = 'REPLACE_ME_WITH_OUTPUT_OF_node_-e_require_crypto_.randomBytes(32).toString(hex)';

describe('assertBackupSecret', () => {
  it('refuses the .env.example placeholder in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.MAHALI_BACKUP_SECRET = PLACEHOLDER;
    expect(() => assertBackupSecret()).toThrow(/placeholder/);
  });

  it('only warns about the placeholder outside production', () => {
    process.env.NODE_ENV = 'development';
    process.env.MAHALI_BACKUP_SECRET = PLACEHOLDER;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => assertBackupSecret()).not.toThrow();
    expect(warn).toHaveBeenCalled();
  });

  it('warns, but starts, with a short real secret (it may protect existing backups)', () => {
    process.env.NODE_ENV = 'production';
    process.env.MAHALI_BACKUP_SECRET = 'a1b2c3d4e5f6';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => assertBackupSecret()).not.toThrow();
    expect(warn.mock.calls.flat().join(' ')).toMatch(/short/);
  });

  it('accepts a random 64-hex secret silently', () => {
    process.env.NODE_ENV = 'production';
    process.env.MAHALI_BACKUP_SECRET = 'f'.repeat(64);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => assertBackupSecret()).not.toThrow();
    expect(warn).not.toHaveBeenCalled();
  });

  it('still refuses a missing secret in production', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.MAHALI_BACKUP_SECRET;
    expect(() => assertBackupSecret()).toThrow(/not set/);
  });
});

describe('assertJwtSecret (unchanged)', () => {
  it('refuses the placeholder in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'REPLACE_ME_WITH_OUTPUT_OF_node_-e_require_crypto_.randomBytes(48)';
    expect(() => assertJwtSecret()).toThrow(/placeholder/);
  });
});
