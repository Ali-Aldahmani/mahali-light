const { markAbsentForDay } = require('../services/attendanceService');

// Daily end-of-day sweep at 23:59 local time:
//   1. Auto check-out anyone still open (timeout method)
//   2. Mark all active employees absent if they have no row and no leave
//   3. Emit a summary to managers
//
// We schedule the next run by computing ms-until-next-23:59. This way the
// timing is honest regardless of how long the server has been up — even
// after a clock-jump (DST etc) it still hits the right minute.

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
    const result = await markAbsentForDay({ io });
    console.log(
      `[attendanceSweep] day=${result.day} marked=${result.marked || 0} ` +
        `auto-closed=${result.autoClosed || 0}${result.dryRun ? ` (skipped: ${result.reason})` : ''}`,
    );
  } catch (err) {
    console.error('[attendanceSweep] failed:', err.message);
  }
}

function schedule(io) {
  const delay = msUntilNext(23, 59);
  if (timer) clearTimeout(timer);
  timer = setTimeout(async () => {
    await tick(io);
    schedule(io);
  }, delay);
  const next = new Date(Date.now() + delay);
  console.log(`[attendanceSweep] next run at ${next.toISOString()}`);
}

function startAttendanceSweepJob(io) {
  schedule(io);
}

module.exports = { startAttendanceSweepJob };
