import net from 'node:net';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

function probePort(host, port, timeoutMs = 800) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (ok) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.on('connect', () => done(true));
    socket.on('timeout', () => done(false));
    socket.on('error', () => done(false));
  });
}

// REQUIRE_DB_TESTS=1 (set in CI): the PostgreSQL suites must run. Without it
// they skip quietly when no test database is reachable, which once hid a
// whole class of tests from CI (authentication audit AUTH-13, inventory
// audit INV-015).
async function assertDatabaseTestsCanRun() {
  if (process.env.REQUIRE_DB_TESTS !== '1') return;
  const port = Number(process.env.INVOICE_TEST_PG_PORT);
  if (!port || !(await probePort('127.0.0.1', port, 3000))) {
    throw new Error(
      `REQUIRE_DB_TESTS=1 but no test database is reachable on 127.0.0.1:${port || '(INVOICE_TEST_PG_PORT not set)'}. `
      + 'The PostgreSQL suites would be skipped; start the test database or unset REQUIRE_DB_TESTS.',
    );
  }
}

export default async function globalSetup() {
  if (process.env.INVOICE_TEST_PG_PORT) {
    await assertDatabaseTestsCanRun();
    return;
  }

  // Never fall back to the app's own PG* settings from .env: the integration
  // suites create and drop databases, and .env points at a real one.
  const port = Number(process.env.PG_PROBE_PORT || 5432);
  const reachable = await probePort('127.0.0.1', port);
  if (reachable) {
    process.env.INVOICE_TEST_PG_PORT = String(port);
    if (!process.env.INVOICE_TEST_PG_USER) process.env.INVOICE_TEST_PG_USER = 'postgres';
    if (!process.env.INVOICE_TEST_PG_PASSWORD) process.env.INVOICE_TEST_PG_PASSWORD = 'postgres';
  }
  await assertDatabaseTestsCanRun();
}
