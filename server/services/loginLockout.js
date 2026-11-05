const { query } = require('../db/postgres');

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_WINDOW_MINUTES = 15;

// Authentication audit AUTH-05. Each attempt is counted in one atomic upsert
// BEFORE the password is checked, so parallel guesses can't all slip under
// the limit, and a success clears the count. Counting per username AND
// address means a stranger who knows a username locks out only their own
// PC, not the person's till. Locked attempts don't extend the lock.
async function reserveAttempt(username, ipAddress) {
  const { rows } = await query(
    `INSERT INTO login_lockouts (username, ip_address, failed_count, window_started_at)
     VALUES ($1, $2, 1, NOW())
     ON CONFLICT (username, ip_address) DO UPDATE SET
       failed_count = CASE
         WHEN login_lockouts.locked_until > NOW() THEN login_lockouts.failed_count
         WHEN login_lockouts.locked_until IS NOT NULL
           OR login_lockouts.window_started_at <= NOW() - make_interval(mins => $3) THEN 1
         ELSE login_lockouts.failed_count + 1 END,
       window_started_at = CASE
         WHEN login_lockouts.locked_until > NOW() THEN login_lockouts.window_started_at
         WHEN login_lockouts.locked_until IS NOT NULL
           OR login_lockouts.window_started_at <= NOW() - make_interval(mins => $3) THEN NOW()
         ELSE login_lockouts.window_started_at END,
       locked_until = CASE
         WHEN login_lockouts.locked_until > NOW() THEN login_lockouts.locked_until
         WHEN login_lockouts.locked_until IS NULL
           AND login_lockouts.window_started_at > NOW() - make_interval(mins => $3)
           AND login_lockouts.failed_count + 1 > $4 THEN NOW() + make_interval(mins => $3)
         ELSE NULL END
     RETURNING (locked_until IS NOT NULL AND locked_until > NOW()) AS locked`,
    [username, ipAddress || '', LOCK_WINDOW_MINUTES, MAX_FAILED_ATTEMPTS],
  );
  return Boolean(rows[0]?.locked);
}

async function clearAttempts(username, ipAddress) {
  await query(
    `DELETE FROM login_lockouts WHERE username = $1 AND ip_address = $2`,
    [username, ipAddress || ''],
  );
}

module.exports = { reserveAttempt, clearAttempts };
