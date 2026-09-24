// Single source of truth for the store's business day.
//
// The store trades in one timezone (Asia/Dubai by default). "Today", the day
// a sale/payment is booked to, and every SQL ::date / CURRENT_DATE bucket
// must all agree on it — previously the code mixed UTC toISOString() slices
// with local getters and a UTC database session, so anything between 00:00
// and 04:00 Dubai time landed on the previous day (and, on the 1st, in the
// previous accounting period).
//
// Three layers keep them aligned:
//   1. applyProcessTimezone() sets process.env.TZ at boot, so local getters,
//      setHours() in jobs, node-cron schedules and pg's local-midnight
//      parsing of DATE columns all use the store timezone.
//   2. server/db/postgres.js sets the Postgres session timezone to match.
//   3. storeDate() formats any instant as the store's calendar day,
//      independent of process TZ.

const DEFAULT_TIMEZONE = 'Asia/Dubai';

function resolveStoreTimezone() {
  const raw = (process.env.STORE_TIMEZONE || '').trim();
  if (!raw) return DEFAULT_TIMEZONE;
  // Also interpolated into the pg connection options — keep it to IANA chars.
  if (!/^[A-Za-z0-9_+\-/]+$/.test(raw)) {
    throw new Error(`[dates] STORE_TIMEZONE "${raw}" is not a valid IANA timezone name.`);
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: raw });
  } catch (_e) {
    throw new Error(`[dates] STORE_TIMEZONE "${raw}" is not a valid IANA timezone name.`);
  }
  return raw;
}

const STORE_TIMEZONE = resolveStoreTimezone();

const dayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: STORE_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

// YYYY-MM-DD of `input` in the store timezone. Date → formatted in the
// store timezone; string → its leading YYYY-MM-DD (already a calendar day);
// null/undefined → today.
function storeDate(input) {
  if (input == null || input === '') return dayFormatter.format(new Date());
  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) return null;
    return dayFormatter.format(input);
  }
  return String(input).slice(0, 10);
}

function todayStoreDate() {
  return dayFormatter.format(new Date());
}

function applyProcessTimezone() {
  if (process.env.TZ !== STORE_TIMEZONE) {
    if (process.env.TZ) {
      console.warn(
        `[dates] overriding TZ=${process.env.TZ} with store timezone ${STORE_TIMEZONE} ` +
          '(set STORE_TIMEZONE to change it).',
      );
    }
    process.env.TZ = STORE_TIMEZONE;
  }
}

module.exports = { STORE_TIMEZONE, storeDate, todayStoreDate, applyProcessTimezone };
