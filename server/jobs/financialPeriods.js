const { ensurePeriodsForYear } = require('../services/journalService');

// Keeps financial periods provisioned for the current and next calendar year
// so they're visible (and closable) in Finance before any posting needs
// them. Posting also self-heals via assertPeriodOpenFor; this job just makes
// the periods exist ahead of time. Idempotent — ON CONFLICT DO NOTHING.
const TICK_INTERVAL_MS = 24 * 60 * 60 * 1000; // daily
let timer = null;

async function sweep() {
  try {
    const year = new Date().getFullYear();
    await ensurePeriodsForYear(year);
    await ensurePeriodsForYear(year + 1);
  } catch (err) {
    console.error('[financialPeriods] sweep failed', err.message);
  }
}

function startFinancialPeriodsJob() {
  sweep().catch(() => {});
  if (timer) clearInterval(timer);
  timer = setInterval(sweep, TICK_INTERVAL_MS);
  console.log('[financialPeriods] scheduled daily period provisioning.');
}

module.exports = { startFinancialPeriodsJob, sweep };
