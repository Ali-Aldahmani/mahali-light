// Startup checks for the secrets in .env (moved from server/index.js so they
// can be tested without starting the server).
// ---------------------------------------------------------------------------
// JWT secret guard — fail fast if the secret is absent, too short, or matches
// a known development placeholder so we never accidentally ship a weak secret.
// ---------------------------------------------------------------------------
const KNOWN_WEAK_JWT_PREFIXES = [
  'dev-only',
  'please-change-me',
  'REPLACE_ME',
  'change-me',
  'secret',
  'test-secret',
];

function assertJwtSecret() {
  const secret = process.env.JWT_SECRET || '';
  if (!secret) {
    throw new Error(
      '[startup] JWT_SECRET is not set. Generate one with:\n' +
      '  node -e "require(\'crypto\').randomBytes(48,(e,b)=>console.log(b.toString(\'hex\')))"',
    );
  }
  if (secret.length < 32) {
    throw new Error(
      `[startup] JWT_SECRET is too short (${secret.length} chars). Minimum 32, recommended 64+.`,
    );
  }
  const lower = secret.toLowerCase();
  for (const prefix of KNOWN_WEAK_JWT_PREFIXES) {
    if (lower.startsWith(prefix.toLowerCase())) {
      const isProduction = process.env.NODE_ENV === 'production';
      const msg =
        `[startup] JWT_SECRET looks like a placeholder ("${secret.slice(0, 20)}..."). ` +
        'Replace it with a cryptographically random value.';
      if (isProduction) {
        throw new Error(msg);
      } else {
        console.warn('\x1b[33m⚠  WARN\x1b[0m', msg);
      }
    }
  }
}

function assertBackupSecret() {
  const secret = process.env.MAHALI_BACKUP_SECRET || '';
  const isProduction = process.env.NODE_ENV === 'production';
  if (!secret) {
    const msg =
      '[startup] MAHALI_BACKUP_SECRET is not set. NAS credentials cannot be encrypted safely.\n' +
      '  Generate one with: node -e "require(\'crypto\').randomBytes(32,(e,b)=>console.log(b.toString(\'hex\')))"';
    if (isProduction) {
      throw new Error(msg);
    } else {
      console.warn('\x1b[33m⚠  WARN\x1b[0m', msg);
    }
    return;
  }
  // The .env.example placeholder (or any known placeholder) is a key
  // everyone knows, so "encrypted" NAS credentials and backups would not be
  // protected (engineering audit F-BAK-03). Same rule as JWT_SECRET.
  const lower = secret.toLowerCase();
  if (KNOWN_WEAK_JWT_PREFIXES.some((p) => lower.startsWith(p.toLowerCase()))) {
    const msg =
      `[startup] MAHALI_BACKUP_SECRET looks like a placeholder ("${secret.slice(0, 20)}..."). ` +
      'Replace it with a random value before taking backups. Backups already encrypted with the ' +
      'old value need that old value to restore.';
    if (isProduction) throw new Error(msg);
    console.warn('\x1b[33m⚠  WARN\x1b[0m', msg);
    return;
  }
  // A short secret is weak, but it may already protect existing encrypted
  // backups, so it is a warning rather than a refusal to start.
  if (secret.length < 32) {
    console.warn(
      '\x1b[33m⚠  WARN\x1b[0m',
      `[startup] MAHALI_BACKUP_SECRET is short (${secret.length} chars); 64 random hex characters are recommended.`,
    );
  }
}

module.exports = { assertJwtSecret, assertBackupSecret, KNOWN_WEAK_JWT_PREFIXES };
