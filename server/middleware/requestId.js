const crypto = require('crypto');

// Correlates one request across the access log (morgan), the error
// handler, and the client: the frontend already sends X-Request-Id on
// every call (web/services/http.ts) but until now nothing on the server
// read it, so a support report referencing "this failed request" had no
// way to be matched to a specific log line. Reuses the client's id when
// present (falls back to generating one for direct/non-browser callers),
// and echoes it back so the client can surface it too.
function requestId(req, res, next) {
  const incoming = req.headers['x-request-id'];
  // A client-supplied id is only reused when it is short and plain, since
  // it goes into logs and error rows (engineering audit F-SEC-03).
  const clean = typeof incoming === 'string' ? incoming.trim() : '';
  req.id = /^[A-Za-z0-9._:-]{1,100}$/.test(clean) ? clean : crypto.randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
}

module.exports = { requestId };
