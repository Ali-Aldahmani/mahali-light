const telegramService = require('../services/telegramService');

// Sends new low-stock (reorder) alerts to Telegram. Runs on the server PC
// only (see index.js), every 30 s; does nothing until alerts are switched on
// in Settings -> Telegram alerts.
const INTERVAL_MS = Number(process.env.TELEGRAM_ALERT_INTERVAL_MS) || 30_000;

function startTelegramStockAlertJob() {
  let lastLoggedError = null;
  const tick = async () => {
    try {
      const result = await telegramService.sendPendingStockAlerts();
      if (result.sent) console.log(`[telegram] sent ${result.sent} stock alert(s)`);
      if (result.error && result.error !== lastLoggedError) {
        console.warn(`[telegram] ${result.error}`);
      }
      lastLoggedError = result.error || null;
    } catch (err) {
      console.warn('[telegram] stock alert job failed:', err.message);
    }
  };
  const first = setTimeout(tick, 10_000);
  const timer = setInterval(tick, INTERVAL_MS);
  first.unref?.();
  timer.unref?.();
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}

module.exports = { startTelegramStockAlertJob };
