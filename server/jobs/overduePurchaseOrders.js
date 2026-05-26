const { query } = require('../db/postgres');

// Runs once on startup (a few seconds after boot) and then daily at midnight
// local server time. Emits `po_overdue` to manager/admin sockets for every
// purchase order whose `due_date` has passed and which still has an unpaid
// balance. The PO status is intentionally not changed — overdue is a derived
// flag, not a stored state.
function startOverduePoJob(io) {
  if (!io) return () => {};

  let timer = null;

  const run = async () => {
    try {
      const { rows } = await query(
        `SELECT po.id, po.po_number, po.due_date, po.balance_due,
                po.payment_status, po.status,
                s.id AS supplier_id, s.name AS supplier_name
           FROM purchase_orders po
           JOIN suppliers s ON s.id = po.supplier_id
          WHERE po.due_date IS NOT NULL
            AND po.due_date < CURRENT_DATE
            AND po.payment_status <> 'paid'
            AND po.status <> 'cancelled'`,
      );
      if (rows.length) {
        const payload = {
          count: rows.length,
          items: rows.map((r) => ({
            poId: r.id,
            poNumber: r.po_number,
            supplierId: r.supplier_id,
            supplierName: r.supplier_name,
            dueDate: r.due_date,
            balanceDue: Number(r.balance_due),
            paymentStatus: r.payment_status,
            status: r.status,
          })),
          checkedAt: new Date().toISOString(),
        };
        io.to('role:Manager').emit('po_overdue', payload);
        io.to('role:Admin').emit('po_overdue', payload);
      }
    } catch (err) {
      console.error('[overduePoJob] failed', err);
    }
  };

  // Calculate ms until next midnight.
  const msUntilNextMidnight = () => {
    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    return next.getTime() - now.getTime();
  };

  const scheduleNext = () => {
    const ms = msUntilNextMidnight();
    timer = setTimeout(async () => {
      await run();
      scheduleNext();
    }, ms);
    // Don't keep the event loop alive just for this.
    if (timer && typeof timer.unref === 'function') timer.unref();
  };

  // First run a few seconds after boot, then schedule the nightly tick.
  const boot = setTimeout(() => {
    run();
    scheduleNext();
  }, 5000);
  if (boot && typeof boot.unref === 'function') boot.unref();

  return () => {
    if (timer) clearTimeout(timer);
  };
}

module.exports = { startOverduePoJob };
