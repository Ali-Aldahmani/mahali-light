/**
 * Runtime robustness fixes from the software engineering audit (22 Nov 2026):
 *   F-OPS-01  graceful shutdown (server/utils/shutdown.js)
 *   F-OPS-03  database timeouts are configurable and safe (durationSetting)
 *   F-OPS-04  errors keep their real status; busy database is retryable
 *   F-UPD-01  newer-schema guard (pure part)
 */
import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';

const require = createRequire(import.meta.url);
const { classifyError } = require('../../server/services/errorLogService');
const { createShutdown } = require('../../server/utils/shutdown');
const { durationSetting } = require('../../server/db/postgres');
const { assertSchemaNotNewer } = require('../../server/db/migrate');

function pgError(code, message = 'pg error') {
  return Object.assign(new Error(message), { code, severity: 'ERROR', routine: 'x' });
}

describe('classifyError (F-OPS-04, F-OPS-03)', () => {
  it.each(['40P01', '40001', '55P03', '57014'])(
    'maps %s (deadlock / lock wait / timeout) to a retryable DB_BUSY 503',
    (code) => {
      const c = classifyError(pgError(code));
      expect(c.code).toBe('DB_BUSY');
      expect(c.status).toBe(503);
      expect(c.severity).toBe('warning');
      expect(c.message).toMatch(/Nothing was saved/);
    },
  );

  it('keeps a plain error\'s 4xx status instead of calling it a database failure', () => {
    const c = classifyError(Object.assign(new Error('Origin "x" not allowed by CORS'), { status: 403 }));
    expect(c.status).toBe(403);
    expect(c.code).toBe('AUTH_NO_PERMISSION');
  });

  it('maps body-parser\'s 413 to a client error', () => {
    const c = classifyError(Object.assign(new Error('request entity too large'), { status: 413, expose: true }));
    expect(c.status).toBe(413);
    expect(c.code).toBe('VALIDATION_FAILED');
  });

  it('reports a non-database programming error as INTERNAL_ERROR, not DB_QUERY_FAILED', () => {
    const c = classifyError(new TypeError("Cannot read properties of undefined (reading 'id')"));
    expect(c.code).toBe('INTERNAL_ERROR');
    expect(c.status).toBe(500);
  });

  it('still reports a real query failure as DB_QUERY_FAILED', () => {
    expect(classifyError(pgError('42703', 'column "x" does not exist')).code).toBe('DB_QUERY_FAILED');
    expect(classifyError(new Error('timeout exceeded when trying to connect')).code).toBe('DB_QUERY_FAILED');
  });

  it('leaves constraint violations and AppErrors as before', () => {
    expect(classifyError(pgError('23503')).status).toBe(409);
    const { AppError, ERROR_CODES } = require('../../shared/errorCodes');
    const c = classifyError(new AppError(ERROR_CODES.RESOURCE_NOT_FOUND));
    expect(c.status).toBe(404);
  });
});

describe('durationSetting (F-OPS-03)', () => {
  it('accepts PostgreSQL durations and rejects anything else', () => {
    process.env.TEST_DUR = '5s';
    expect(durationSetting('TEST_DUR', '10s')).toBe('5s');
    process.env.TEST_DUR = '0';
    expect(durationSetting('TEST_DUR', '10s')).toBe('0');
    process.env.TEST_DUR = '5s -c search_path=evil';
    expect(durationSetting('TEST_DUR', '10s')).toBe('10s');
    delete process.env.TEST_DUR;
    expect(durationSetting('TEST_DUR', '10s')).toBe('10s');
  });
});

describe('assertSchemaNotNewer (F-UPD-01)', () => {
  it('passes when every applied migration ships with this build', () => {
    expect(() => assertSchemaNotNewer(new Set(['001_a.sql']), ['001_a.sql', '002_b.sql'])).not.toThrow();
  });

  it('refuses unknown applied migrations unless the operator overrides', () => {
    const applied = new Set(['001_a.sql', '003_newer.sql']);
    expect(() => assertSchemaNotNewer(applied, ['001_a.sql'])).toThrow(/003_newer\.sql/);
    process.env.MIGRATE_ALLOW_NEWER_SCHEMA = '1';
    try {
      expect(() => assertSchemaNotNewer(applied, ['001_a.sql'])).not.toThrow();
    } finally {
      delete process.env.MIGRATE_ALLOW_NEWER_SCHEMA;
    }
  });
});

describe('graceful shutdown (F-OPS-01)', () => {
  const quietLog = { log: () => {}, warn: () => {}, error: () => {} };

  function fakeServer() {
    const server = new EventEmitter();
    server.inFlight = 1;
    server.close = vi.fn((cb) => {
      server.closeCb = cb;
      if (server.inFlight === 0) cb();
    });
    server.closeIdleConnections = vi.fn();
    server.finishRequest = () => {
      server.inFlight = 0;
      server.closeCb?.();
    };
    return server;
  }

  it('waits for the in-flight request, then closes the pool and exits 0', async () => {
    const server = fakeServer();
    const order = [];
    const exit = vi.fn();
    const shutdown = createShutdown({
      getServer: () => server,
      enterMaintenance: () => order.push('maintenance'),
      stopJobs: () => order.push('jobs'),
      closePool: async () => order.push('pool'),
      exit,
      log: quietLog,
    });

    const done = shutdown('SIGTERM');
    await new Promise((r) => setImmediate(r));
    expect(server.close).toHaveBeenCalled();
    expect(server.closeIdleConnections).toHaveBeenCalled();
    expect(order).toEqual(['maintenance', 'jobs']);
    expect(exit).not.toHaveBeenCalled(); // the request is still running

    server.finishRequest();
    await done;
    expect(order).toEqual(['maintenance', 'jobs', 'pool']);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('closes live-update sockets through io.close (which closes the HTTP server)', async () => {
    const server = fakeServer();
    const io = { close: vi.fn((cb) => cb()) };
    const exit = vi.fn();
    await createShutdown({ getServer: () => server, getIo: () => io, exit, log: quietLog })('SIGTERM');
    expect(io.close).toHaveBeenCalled();
    expect(server.close).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('exits 1 at the deadline if a request never finishes', async () => {
    vi.useFakeTimers();
    try {
      const server = fakeServer();
      const exit = vi.fn();
      createShutdown({ getServer: () => server, exit, timeoutMs: 1000, log: quietLog })('SIGTERM');
      await vi.advanceTimersByTimeAsync(1001);
      expect(exit).toHaveBeenCalledWith(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a second signal exits immediately', async () => {
    const server = fakeServer();
    const exit = vi.fn();
    const shutdown = createShutdown({ getServer: () => server, exit, log: quietLog });
    shutdown('SIGTERM');
    await shutdown('SIGINT');
    expect(exit).toHaveBeenCalledWith(1);
  });
});

