const { query } = require('../db/postgres');

// Auto-cancel draft invoices older than the configured threshold. The spec
// suggests 24h; we make it configurable via DRAFT_INVOICE_MAX_AGE_HOURS env
// (default 24). Drafts have no stock side-effects, so cancelling them is a
// pure DB write — no movements to reverse.
const MAX_AGE_HOURS = Number(
  process.env.DRAFT_INVOICE_MAX_AGE_HOURS || 24,
);
const TICK_INTERVAL_MS = 60 * 60 * 1000; // hourly
let timer = null;

async function sweep() {
  try {
    const { rows } = await query(
      `UPDATE invoices
          SET status = 'cancelled',
              cancel_reason = 'auto-cancelled: draft older than ' || $1 || 'h',
              cancelled_at = NOW(),
              updated_at = NOW()
        WHERE status = 'draft'
          AND created_at < NOW() - make_interval(hours => $1)
        RETURNING id, invoice_number`,
      [MAX_AGE_HOURS],
    );
    if (rows.length) {
      console.log(
        `[staleDraftInvoices] auto-cancelled ${rows.length} stale draft(s)`,
      );
      // Best-effort history rows; ignore failures.
      try {
        for (const r of rows) {
          await query(
            `INSERT INTO invoice_history (invoice_id, action, notes)
             VALUES ($1, 'cancelled', 'auto-cancelled: stale draft')`,
            [r.id],
          );
        }
      } catch (_e) {
        // ignore
      }
    }
  } catch (err) {
    console.error('[staleDraftInvoices] sweep failed', err.message);
  }
}

function startStaleDraftInvoiceJob() {
  sweep().catch(() => {});
  if (timer) clearInterval(timer);
  timer = setInterval(sweep, TICK_INTERVAL_MS);
  console.log(
    `[staleDraftInvoices] scheduled hourly sweep (max age ${MAX_AGE_HOURS}h).`,
  );
}

module.exports = { startStaleDraftInvoiceJob };
