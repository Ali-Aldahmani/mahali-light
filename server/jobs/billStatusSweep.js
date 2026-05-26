const { checkAndUpdateBillStatuses } = require('../services/billService');

// Daily 08:00 local sweep:
//   1. Promote upcoming → due / due → overdue based on today's date
//   2. Create bill_notifications for upcoming, due_today, overdue
//   3. Emit `bill_due_reminder` to Manager + Admin
//
// We re-schedule by computing ms-until-next-08:00 each tick so a clock jump
// (DST etc) doesn't desync the run.

let timer = null;

function msUntilNext(hour, minute) {
  const now = new Date();
  const target = new Date(now);
  target.setHours(hour, minute, 0, 0);
  if (target <= now) target.setDate(target.getDate() + 1);
  return target - now;
}

async function tick(io) {
  try {
    const result = await checkAndUpdateBillStatuses({ io });
    console.log(
      `[billStatusSweep] day=${result.day} notifications=${result.notifications}`,
    );
  } catch (err) {
    console.error('[billStatusSweep] failed:', err.message);
  }
}

function schedule(io) {
  const delay = msUntilNext(8, 0);
  if (timer) clearTimeout(timer);
  timer = setTimeout(async () => {
    await tick(io);
    schedule(io);
  }, delay);
  const next = new Date(Date.now() + delay);
  console.log(`[billStatusSweep] next run at ${next.toISOString()}`);
}

function startBillStatusSweepJob(io) {
  schedule(io);
  // Also fire one immediately on boot so a missed 08:00 (server was down) gets
  // caught up the moment we come online. The function is idempotent so this
  // is safe to run more than once per day.
  tick(io).catch(() => {});
}

module.exports = { startBillStatusSweepJob };
