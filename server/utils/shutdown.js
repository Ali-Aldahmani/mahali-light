// Graceful shutdown (audit F-OPS-01).
//
// `docker stop`, `compose down` and the self-update flow all send SIGTERM.
// Exiting at once cut requests that were half-way through (PostgreSQL rolled
// them back, so nothing was corrupted, but the till saw a network error) and
// left the pool's connections to time out on the database side.
//
// On the first signal: refuse new writes (maintenance mode), stop the
// schedulers so no new backup or sweep starts, stop accepting connections,
// let in-flight requests finish, close the database pool, then exit. A
// second signal, or the deadline passing, exits immediately. Docker's
// default grace period is 10 s, so the deadline stays below it.

function createShutdown({
  getServer = () => null,
  getIo = () => null,
  stopJobs = () => {},
  closePool = async () => {},
  enterMaintenance = () => {},
  timeoutMs = 8000,
  exit = (code) => process.exit(code),
  log = console,
} = {}) {
  let started = false;

  return async function shutdown(signal) {
    if (started) {
      log.warn(`[server] ${signal} again - exiting now.`);
      exit(1);
      return;
    }
    started = true;
    log.log(`[server] ${signal} received - finishing in-flight requests...`);

    const deadline = setTimeout(() => {
      log.warn(`[server] shutdown took longer than ${timeoutMs} ms - exiting anyway.`);
      exit(1);
    }, timeoutMs);
    if (typeof deadline.unref === 'function') deadline.unref();

    try {
      enterMaintenance();
      try {
        stopJobs();
      } catch (err) {
        log.warn('[server] stopping schedulers failed:', err?.message || err);
      }

      const server = getServer();
      const io = getIo();
      if (server || io) {
        await new Promise((resolve) => {
          const done = () => resolve();
          try {
            // Live-update sockets are open connections too, so they go
            // first: io.close() disconnects them and then closes the HTTP
            // server, whose callback waits for in-flight requests.
            if (io) io.close(done);
            else server.close(done);
          } catch (_err) {
            resolve();
          }
          // Idle keep-alive sockets would otherwise hold the server open
          // until the deadline.
          if (server && typeof server.closeIdleConnections === 'function') {
            server.closeIdleConnections();
          }
        });
      }

      await closePool();
      clearTimeout(deadline);
      log.log('[server] shutdown complete.');
      exit(0);
    } catch (err) {
      clearTimeout(deadline);
      log.error('[server] shutdown failed:', err);
      exit(1);
    }
  };
}

module.exports = { createShutdown };
