const {
  expireWarranties,
  notifyExpiringSoon,
} = require('../services/warrantyService');

// Daily sweep: flip past-due active warranties to 'expired' and broadcast a
// summary count of warranties expiring within the next 30 days. We schedule
// the first run a few seconds after boot (so other migrations/seeds have
// settled) and then every 24h thereafter.
const TICK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const EXPIRING_WINDOW_DAYS = Number(
  process.env.WARRANTY_EXPIRING_WINDOW_DAYS || 30,
);

let timer = null;

async function sweep(io) {
  try {
    const expired = await expireWarranties({ io });
    if (expired.count > 0) {
      console.log(
        `[warrantyExpiry] flipped ${expired.count} warranty/warranties to expired.`,
      );
    }
    const expiring = await notifyExpiringSoon({
      days: EXPIRING_WINDOW_DAYS,
      io,
    });
    if (expiring.count > 0) {
      console.log(
        `[warrantyExpiry] ${expiring.count} warranties expiring in the next ${EXPIRING_WINDOW_DAYS} days.`,
      );
    }
  } catch (err) {
    console.error('[warrantyExpiry] sweep failed', err.message);
  }
}

function startWarrantyExpiryJob(io) {
  setTimeout(() => sweep(io).catch(() => {}), 30 * 1000);
  if (timer) clearInterval(timer);
  timer = setInterval(() => sweep(io).catch(() => {}), TICK_INTERVAL_MS);
  console.log('[warrantyExpiry] scheduled daily sweep.');
}

module.exports = { startWarrantyExpiryJob };
