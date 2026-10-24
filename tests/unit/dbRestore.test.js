import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { restoreDatabase } = require('../../server/backup/strategies/dbBackup');

// A stand-in for pg_restore: records its arguments and exits with `code`.
function fakeRestore(code, stderr = '') {
  const calls = [];
  const spawnProcess = (bin, args) => {
    calls.push(args);
    const proc = new EventEmitter();
    proc.stderr = new EventEmitter();
    setImmediate(() => {
      if (stderr) proc.stderr.emit('data', Buffer.from(stderr));
      proc.emit('close', code);
    });
    return proc;
  };
  return { spawnProcess, calls };
}

describe('database restore exit handling', () => {
  let dir;
  let dump;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mahali-restore-test-'));
    dump = path.join(dir, 'x-db.dump');
    fs.writeFileSync(dump, 'not a real dump');
  });

  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('runs as one transaction that stops at the first error', async () => {
    const { spawnProcess, calls } = fakeRestore(0);
    await restoreDatabase(dump, { spawnProcess });
    expect(calls[0]).toContain('--single-transaction');
    expect(calls[0]).toContain('--exit-on-error');
  });

  it('exit code 0 is a successful restore', async () => {
    const { spawnProcess } = fakeRestore(0);
    await expect(restoreDatabase(dump, { spawnProcess })).resolves.toMatchObject({ success: true });
  });

  it('exit code 1 (errors during restore) is a failure, not a success', async () => {
    const { spawnProcess } = fakeRestore(1, 'pg_restore: error: could not execute query');
    const result = await restoreDatabase(dump, { spawnProcess });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/exited with code 1/);
    expect(result.error).toMatch(/rolled back/);
    expect(result.error).toMatch(/could not execute query/);
  });
});
