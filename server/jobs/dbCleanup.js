'use strict';

/**
 * Nightly cleanup job for tables that grow unboundedly.
 *
 * Without pruning, two tables accumulate rows indefinitely:
 *
 *   login_attempts  — every login attempt (success or failure) writes a row.
 *                     On an active system this reaches millions of rows within
 *                     a year, degrading isLockedOut() even with the
 *                     (username, attempted_at DESC) index from migration 021.
 *
 *   user_sessions   — a row is written on every login and updated on logout.
 *                     Sessions that are explicitly logged out accumulate a
 *                     `logout_at` timestamp; abandoned sessions (e.g. a PC
 *                     rebooted mid-shift) stay "open" but are unusable because
 *                     the JWT has expired.
 *
 * Retention windows are configurable via environment variables so a production
 * deployment can tune them without a code change:
 *
 *   DB_CLEANUP_LOGIN_ATTEMPTS_DAYS   (default: 90)
 *   DB_CLEANUP_USER_SESSIONS_DAYS    (default: 30)
 *
 * The job fires at 03:00 local time each night (lowest-traffic window) using
 * the same reschedule-with-setTimeout pattern as attendanceSweep.js so it
 * stays on time even after DST transitions.
 */

const { query } = require('../db/postgres');

const LOGIN_ATTEMPTS_DAYS = Number(
  process.env.DB_CLEANUP_LOGIN_ATTEMPTS_DAYS || 90,
);
const USER_SESSIONS_DAYS = Number(
  process.env.DB_CLEANUP_USER_SESSIONS_DAYS || 30,
);

let timer = null;

// ---------------------------------------------------------------------------
// Sweep
// ---------------------------------------------------------------------------

async function sweep() {
  // ---------- login_attempts ----------
  // Keep only the most recent LOGIN_ATTEMPTS_DAYS days.  Older rows are
  // irrelevant to the lockout window (15 min) and serve no business purpose.
  try {
    const { rowCount: attemptsDeleted } = await query(
      `DELETE FROM login_attempts
        WHERE attempted_at < NOW() - make_interval(days => $1)`,
      [LOGIN_ATTEMPTS_DAYS],
    );
    if (attemptsDeleted > 0) {
      console.log(
        `[dbCleanup] pruned ${attemptsDeleted} login_attempts older than ${LOGIN_ATTEMPTS_DAYS}d`,
      );
    }
  } catch (err) {
    console.error('[dbCleanup] login_attempts sweep failed:', err.message);
  }

  // ---------- user_sessions ----------
  // Delete sessions that meet either condition:
  //   (a) explicitly logged out and the logout happened > N days ago, OR
  //   (b) never explicitly logged out but last_activity_at is > N days ago
  //       (abandoned session — the JWT expired long before this point)
  try {
    const { rowCount: sessionsDeleted } = await query(
      `DELETE FROM user_sessions
        WHERE (
          logout_at IS NOT NULL
          AND logout_at < NOW() - make_interval(days => $1)
        )
        OR (
          logout_at IS NULL
          AND last_activity_at < NOW() - make_interval(days => $1)
        )`,
      [USER_SESSIONS_DAYS],
    );
    if (sessionsDeleted > 0) {
      console.log(
        `[dbCleanup] pruned ${sessionsDeleted} user_sessions older than ${USER_SESSIONS_DAYS}d`,
      );
    }
  } catch (err) {
    console.error('[dbCleanup] user_sessions sweep failed:', err.message);
  }
}

// ---------------------------------------------------------------------------
// Scheduling — fire at 03:00 each night, reschedule after each run so the
// job stays on the clock across DST transitions.
// ---------------------------------------------------------------------------

function msUntilNext0300() {
  const now = new Date();
  const target = new Date(now);
  target.setHours(3, 0, 0, 0);
  if (target <= now) target.setDate(target.getDate() + 1);
  return target - now;
}

function schedule() {
  const delay = msUntilNext0300();
  if (timer) clearTimeout(timer);
  timer = setTimeout(async () => {
    await sweep();
    schedule(); // reschedule for the next night
  }, delay);

  const next = new Date(Date.now() + delay);
  console.log(`[dbCleanup] next run at ${next.toISOString()} ` +
    `(login_attempts >${LOGIN_ATTEMPTS_DAYS}d, user_sessions >${USER_SESSIONS_DAYS}d)`);
}

function startDbCleanupJob() {
  schedule();
}

module.exports = { startDbCleanupJob };
