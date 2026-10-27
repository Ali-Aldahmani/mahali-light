const { checkAllVariants } = require('../services/reorderService');
const { emitEvent } = require('../socket/events');

// Hourly backstop for low-stock alerts (inventory audit INV-006). Receipts
// and stock counts check alerts after they commit, and a failure there is
// only logged; a reorder-level edit checks straight away. This pass catches
// anything those missed: it creates, refreshes or clears the pending alert
// of every active variant. Runs a minute after start, then every hour.
const FIRST_RUN_MS = 60 * 1000;
const EVERY_MS = 60 * 60 * 1000;

async function runReorderAlertSweep(io) {
  try {
    const result = await checkAllVariants();
    for (const payload of result.created) emitEvent(io, 'reorder_alert_created', payload);
    return result;
  } catch (err) {
    console.error('[reorderAlertSweep] failed', err);
    return null;
  }
}

function startReorderAlertSweepJob(io) {
  const first = setTimeout(() => runReorderAlertSweep(io), FIRST_RUN_MS);
  const timer = setInterval(() => runReorderAlertSweep(io), EVERY_MS);
  first.unref?.();
  timer.unref?.();
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}

module.exports = { startReorderAlertSweepJob, runReorderAlertSweep };
