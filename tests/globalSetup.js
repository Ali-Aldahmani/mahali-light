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

export default async function globalSetup() {
  if (process.env.INVOICE_TEST_PG_PORT) return;

  const port = Number(process.env.PG_PROBE_PORT || 5432);
  const reachable = await probePort('127.0.0.1', port);
  if (reachable) {
    process.env.INVOICE_TEST_PG_PORT = String(port);
    if (!process.env.INVOICE_TEST_PG_USER) process.env.INVOICE_TEST_PG_USER = 'postgres';
    if (!process.env.INVOICE_TEST_PG_PASSWORD) process.env.INVOICE_TEST_PG_PASSWORD = 'postgres';
  }
}
