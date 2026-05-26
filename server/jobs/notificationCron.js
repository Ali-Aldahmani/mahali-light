const { query } = require('../db/postgres');
const notificationService = require('../services/notificationService');

// =======================================================================
// Daily background sweeps that emit phase-spanning notifications.
//   - Invoice balances unpaid for 7+ days       (invoice.overdue_payment)
//   - Warranties expiring within 30 days        (warranty.expiring_soon)
//   - Bills due in next 3 days / today / overdue (bill.* fan-out)
//   - VAT period closing in next 7 days         (finance.vat_due_soon)
//   - Month closing in next 3 days              (finance.period_closing_soon)
// =======================================================================
const TICK_INTERVAL_MS = 24 * 60 * 60 * 1000;

let timer = null;

async function checkOverdueInvoices() {
  const { rows } = await query(
    `SELECT id, invoice_number, balance_due, customer_id,
            confirmed_at::date AS confirmed_date
       FROM invoices
      WHERE status = 'confirmed'
        AND payment_status <> 'paid'
        AND balance_due > 0
        AND confirmed_at < NOW() - INTERVAL '7 days'
        AND confirmed_at > NOW() - INTERVAL '60 days'`,
  );
  if (!rows.length) return 0;
  // Batch into one notification — listing all overdue invoices verbosely
  // would flood the panel.
  const totalDue = rows.reduce((s, r) => s + Number(r.balance_due || 0), 0);
  await notificationService.notifyManagersAndAdmins({
    type: 'invoice.overdue_payment',
    category: 'invoice',
    severity: 'warning',
    title: `${rows.length} invoice${rows.length === 1 ? '' : 's'} overdue 7+ days`,
    message: `Outstanding balance: AED ${totalDue.toFixed(2)}. First overdue: ${rows[0].invoice_number}.`,
    actionUrl: '/customers/outstanding',
    referenceType: 'invoice_batch',
    dedupeKey: 'invoice.overdue_payment.daily',
  });
  return rows.length;
}

async function checkExpiringWarranties() {
  const { rows } = await query(
    `SELECT COUNT(*)::int AS count
       FROM warranties
      WHERE status = 'active'
        AND expiry_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'`,
  );
  const count = rows[0]?.count || 0;
  if (count === 0) return 0;
  await notificationService.notifyManagersAndAdmins({
    type: 'warranty.expiring_soon',
    category: 'warranty',
    severity: 'warning',
    title: `${count} warrant${count === 1 ? 'y' : 'ies'} expiring soon`,
    message: `Within the next 30 days.`,
    actionUrl: '/warranties?filter=expiring',
    referenceType: 'warranty_batch',
    dedupeKey: 'warranty.expiring_soon.daily',
  });
  return count;
}

async function checkBillsDue() {
  // Upcoming bills in next 3 days (excluding today).
  const { rows: upcoming } = await query(
    `SELECT bp.id, bp.amount_due, bp.due_date, b.bill_name
       FROM bill_payments bp
       JOIN bills b ON b.id = bp.bill_id
      WHERE bp.paid_date IS NULL
        AND bp.due_date BETWEEN CURRENT_DATE + 1 AND CURRENT_DATE + 3`,
  );
  for (const r of upcoming) {
    const days = Math.max(
      1,
      Math.round(
        (new Date(r.due_date).getTime() - Date.now()) / (24 * 60 * 60 * 1000),
      ),
    );
    await notificationService.notifyRoles(['Admin', 'Manager'], {
      type: 'bill.upcoming',
      category: 'bill',
      severity: 'info',
      title: `${r.bill_name} due in ${days} day${days === 1 ? '' : 's'}`,
      message: `Amount AED ${Number(r.amount_due || 0).toFixed(2)}.`,
      actionUrl: `/expenses?tab=bills`,
      referenceType: 'bill_payment',
      referenceId: r.id,
      dedupeKey: `bill.upcoming.${r.id}`,
    });
  }

  // Due today.
  const { rows: dueToday } = await query(
    `SELECT bp.id, bp.amount_due, b.bill_name
       FROM bill_payments bp
       JOIN bills b ON b.id = bp.bill_id
      WHERE bp.paid_date IS NULL
        AND bp.due_date = CURRENT_DATE`,
  );
  for (const r of dueToday) {
    await notificationService.notifyRoles(['Admin', 'Manager'], {
      type: 'bill.due_today',
      category: 'bill',
      severity: 'warning',
      title: `${r.bill_name} is due today`,
      message: `Amount AED ${Number(r.amount_due || 0).toFixed(2)}.`,
      actionUrl: `/expenses?tab=bills`,
      referenceType: 'bill_payment',
      referenceId: r.id,
      dedupeKey: `bill.due_today.${r.id}`,
    });
  }

  // Overdue.
  const { rows: overdue } = await query(
    `SELECT bp.id, bp.amount_due, bp.due_date, b.bill_name
       FROM bill_payments bp
       JOIN bills b ON b.id = bp.bill_id
      WHERE bp.paid_date IS NULL
        AND bp.due_date < CURRENT_DATE`,
  );
  for (const r of overdue) {
    const days = Math.max(
      1,
      Math.round(
        (Date.now() - new Date(r.due_date).getTime()) / (24 * 60 * 60 * 1000),
      ),
    );
    await notificationService.notifyRoles(['Admin', 'Manager'], {
      type: 'bill.overdue',
      category: 'bill',
      severity: 'error',
      title: `${r.bill_name} overdue by ${days} day${days === 1 ? '' : 's'}`,
      message: `Amount AED ${Number(r.amount_due || 0).toFixed(2)}.`,
      actionUrl: `/expenses?tab=bills`,
      referenceType: 'bill_payment',
      referenceId: r.id,
      dedupeKey: `bill.overdue.${r.id}`,
    });
  }
  return upcoming.length + dueToday.length + overdue.length;
}

async function checkFinancePeriodClosing() {
  // Tip every Admin 3 days before month-end.
  const { rows } = await query(
    `SELECT (date_trunc('month', CURRENT_DATE) + INTERVAL '1 month - 1 day')::date AS month_end`,
  );
  const monthEnd = rows[0]?.month_end;
  if (!monthEnd) return false;
  const today = new Date();
  const me = new Date(monthEnd);
  const days = Math.round((me - today) / (24 * 60 * 60 * 1000));
  if (days >= 0 && days <= 3) {
    await notificationService.notifyRoles(['Admin'], {
      type: 'finance.period_closing_soon',
      category: 'finance',
      severity: 'info',
      title: `Period closing in ${days} day${days === 1 ? '' : 's'}`,
      message: `Don't forget to confirm journal entries and reconcile balances.`,
      actionUrl: '/finance/periods',
      referenceType: 'period',
      dedupeKey: `finance.period_closing_soon.${monthEnd}`,
    });
    return true;
  }
  return false;
}

async function checkVatDue() {
  // UAE FTA quarterly VAT — emit when within 7 days of the typical deadline
  // (28th of the month following the quarter end).
  const now = new Date();
  const q = Math.floor(now.getMonth() / 3); // 0..3
  const quarterEnd = new Date(now.getFullYear(), q * 3 + 3, 0); // last day of quarter
  const vatDueDate = new Date(quarterEnd);
  vatDueDate.setMonth(vatDueDate.getMonth() + 1);
  vatDueDate.setDate(28);
  const days = Math.round((vatDueDate - now) / (24 * 60 * 60 * 1000));
  if (days < 0 || days > 7) return false;
  await notificationService.notifyRoles(['Admin'], {
    type: 'finance.vat_due_soon',
    category: 'finance',
    severity: 'warning',
    title: `VAT return due in ${days} day${days === 1 ? '' : 's'}`,
    message: `File and pay by ${vatDueDate.toISOString().slice(0, 10)}.`,
    actionUrl: '/finance?tab=vat',
    referenceType: 'vat_period',
    dedupeKey: `finance.vat_due_soon.${vatDueDate.toISOString().slice(0, 10)}`,
  });
  return true;
}

async function sweep() {
  try {
    await checkOverdueInvoices();
  } catch (err) {
    console.warn('[notificationCron] overdue invoices failed', err.message);
  }
  try {
    await checkExpiringWarranties();
  } catch (err) {
    console.warn('[notificationCron] expiring warranties failed', err.message);
  }
  try {
    await checkBillsDue();
  } catch (err) {
    console.warn('[notificationCron] bills due failed', err.message);
  }
  try {
    await checkFinancePeriodClosing();
  } catch (err) {
    console.warn('[notificationCron] period closing failed', err.message);
  }
  try {
    await checkVatDue();
  } catch (err) {
    console.warn('[notificationCron] vat due failed', err.message);
  }
}

function startNotificationCronJobs() {
  // First sweep 30 seconds after boot — gives everything else time to settle.
  const boot = setTimeout(() => sweep().catch(() => {}), 30 * 1000);
  if (boot && typeof boot.unref === 'function') boot.unref();
  if (timer) clearInterval(timer);
  timer = setInterval(() => sweep().catch(() => {}), TICK_INTERVAL_MS);
  if (timer && typeof timer.unref === 'function') timer.unref();
  console.log('[notificationCron] scheduled daily sweep.');
}

module.exports = {
  startNotificationCronJobs,
  checkOverdueInvoices,
  checkExpiringWarranties,
  checkBillsDue,
  checkFinancePeriodClosing,
  checkVatDue,
};
