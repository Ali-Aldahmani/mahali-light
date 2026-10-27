const { AppError, ERROR_CODES } = require('../../shared/errorCodes');

// Authentication audit AUTH-01: in production, passwords and sign-in tokens
// must not cross the shop network unencrypted. Tills reach the API through
// the HTTPS front door (Caddy), which tells Express the original scheme in
// X-Forwarded-Proto; Express believes that header only from TRUSTED_PROXIES.
//
// A plain-HTTP request is still allowed when it comes from this machine and
// was not forwarded for someone else: the container health check, scripts
// and the backup tools. Anything else gets a 403 that says where to go.
//
// REQUIRE_HTTPS=false turns this off (a single PC with no network, or a
// test setup). It is on by default in production.

const LOOPBACK = /^(127\.|::1$|::ffff:127\.)/;

function secureTransportRequired(env = process.env) {
  if (env.REQUIRE_HTTPS != null && env.REQUIRE_HTTPS !== '') {
    return env.REQUIRE_HTTPS !== 'false';
  }
  return env.NODE_ENV === 'production';
}

function isLocalUnforwarded(remoteAddress, headers = {}) {
  return LOOPBACK.test(remoteAddress || '') && !headers['x-forwarded-for'];
}

// `trust(addr, i)` is Express's compiled trust-proxy function.
function forwardedProtoIsHttps(remoteAddress, headers, trust) {
  if (!trust || !trust(remoteAddress || '', 0)) return false;
  const proto = String(headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  return proto === 'https';
}

const httpsMessage = () => {
  const ip = (process.env.SERVER_IP || '').trim();
  return ip
    ? `This connection isn't secure. Open the POS at https://${ip}`
    : 'This connection isn\'t secure. Open the POS with https://';
};

function requireSecureTransport({ required = secureTransportRequired() } = {}) {
  return (req, _res, next) => {
    if (!required || req.secure || isLocalUnforwarded(req.socket?.remoteAddress, req.headers)) {
      return next();
    }
    return next(new AppError(ERROR_CODES.AUTH_NO_PERMISSION, httpsMessage(), {
      status: 403, details: { reason: 'https_required' },
    }));
  };
}

// The same rule for a Socket.IO handshake (no Express req.secure there).
function isSecureHandshake(socket, trust) {
  const req = socket.request;
  const remote = req?.socket?.remoteAddress;
  return Boolean(
    socket.handshake?.secure
    || forwardedProtoIsHttps(remote, req?.headers || {}, trust)
    || isLocalUnforwarded(remote, req?.headers || {}),
  );
}

module.exports = {
  secureTransportRequired, requireSecureTransport, isSecureHandshake, isLocalUnforwarded,
};
