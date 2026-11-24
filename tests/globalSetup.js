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
  // The PostgreSQL suites create and drop databases on the server they are
  // pointed at, so they run only against a server chosen explicitly with
  // INVOICE_TEST_PG_PORT (+ _USER / _PASSWORD). They used to probe 5432 with
  // postgres/postgres by default, which on a developer or shop PC is the
  // real database server (engineering audit F-TST-02).
  if (process.env.INVOICE_TEST_PG_PORT) {
    await assertDatabaseTestsCanRun();
    return;
  }
  await assertDatabaseTestsCanRun();
  console.warn(
    '[tests] INVOICE_TEST_PG_PORT is not set: the PostgreSQL integration suites (money, stock, ' +
      'migrations) will be SKIPPED. Point it at a disposable test server to run them.',
  );
}
