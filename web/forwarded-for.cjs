// Preloaded into the Next.js server process (node --require, and imported by
// next.config.mjs for `next dev` / `next start`).
//
// Browsers reach Express through Next's /api rewrite, so Express only sees
// this process's address unless we forward the client's. Next itself only
// sets `x-forwarded-for ??= socket.remoteAddress` — a client-supplied header
// passes straight through, letting any till spoof its IP (and dodge the
// per-IP login/API rate limits). Next is the edge here, so overwrite the
// header with the real socket address before Next sees the request. Express
// trusts this header only from this process (TRUSTED_PROXIES).
const http = require('http');
const https = require('https');

const PATCHED = Symbol.for('mahali.forwardedForPatched');

function patch(ServerClass) {
  const proto = ServerClass.prototype;
  if (proto[PATCHED]) return;
  const originalEmit = proto.emit;
  proto.emit = function emit(event, req, ...rest) {
    if ((event === 'request' || event === 'upgrade') && req && req.headers) {
      req.headers['x-forwarded-for'] = req.socket?.remoteAddress || '';
      delete req.headers['x-real-ip'];
    }
    return originalEmit.call(this, event, req, ...rest);
  };
  proto[PATCHED] = true;
}

patch(http.Server);
patch(https.Server);
