const { query, withTransaction } = require('../db/postgres');
const { AppError, ERROR_CODES } = require('../../shared/errorCodes');
const { logActivity } = require('../utils/activityLog');
const cashService = require('./cashService');
const bankService = require('./bankService');

const FREQUENCIES = new Set(['monthly', 'quarterly', 'yearly']);
const PAYMENT_METHODS = new Set(['cash', 'bank']);

function money(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function dateOnly(input) {
  if (!input) return null;
  if (input instanceof Date) return input.toISOString().slice(0, 10);
  return String(input).slice(0, 10);
}

function daysBetween(a, b) {
  const da = new Date(`${dateOnly(a)}T00:00:00`);
  const db = new Date(`${dateOnly(b)}T00:00:00`);
  return Math.round((db - da) / (24 * 60 * 60 * 1000));
}

// Add `frequency` to a base date, capping the day-of-month at the new month's
// last day (so "31 Jan + 1 month" lands on 28/29 Feb, not Mar 2/3).
function addCycle(dateStr, frequency) {
  const base = new Date(`${dateOnly(dateStr)}T00:00:00`);
  const day = base.getDate();
  let target = new Date(base);
  if (frequency === 'monthly') {
    target.setMonth(target.getMonth() + 1);
  } else if (frequency === 'quarterly') {
    target.setMonth(target.getMonth() + 3);
  } else if (frequency === 'yearly') {
    target.setFullYear(target.getFullYear() + 1);
  }
  // setMonth can overshoot for short months — clamp.
  if (target.getDate() !== day) {
    target.setDate(0); // last day of previous month (= last day after rollover)
  }
  return target.toISOString().slice(0, 10);
}

function shapeBill(row, extra = {}) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    categoryId: row.category_id,
    categoryName: row.category_name || null,
    categoryIcon: row.category_icon || null,
    categoryType: row.category_type || null,
    vendorName: row.vendor_name,
    amount: row.amount != null ? Number(row.amount) : null,
    isVariableAmount: Boolean(row.is_variable_amount),
    frequency: row.frequency,
    startDate: dateOnly(row.start_date),
    nextDueDate: dateOnly(row.next_due_date),
    reminderDaysBefore: row.reminder_days_before,
    paymentMethod: row.payment_method,
    bankAccountId: row.bank_account_id,
    bankName: row.bank_name || null,
    autoRecurring: Boolean(row.auto_recurring),
    notes: row.notes,
    status: row.status,
    createdBy: row.created_by,
    createdByUsername: row.created_by_username || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    daysUntilDue:
      row.next_due_date != null ? daysBetween(todayIso(), row.next_due_date) : null,
    ...extra,
  };
}

function shapeBillPayment(row) {
  if (!row) return null;
  return {
    id: row.id,
    billId: row.bill_id,
    billName: row.bill_name || null,
    categoryName: row.category_name || null,
    categoryIcon: row.category_icon || null,
    vendorName: row.vendor_name || null,
    amountDue: row.amount_due != null ? Number(row.amount_due) : 0,
    amountPaid: row.amount_paid != null ? Number(row.amount_paid) : null,
    dueDate: dateOnly(row.due_date),
    paidDate: dateOnly(row.paid_date),
    paymentMethod: row.payment_method,
    bankAccountId: row.bank_account_id,
    bankName: row.bank_name || null,
    receiptAttachment: row.receipt_attachment,
    paidBy: row.paid_by,
    paidByUsername: row.paid_by_username || null,
    status: row.status,
    notes: row.notes,
    daysUntilDue:
      row.due_date != null ? daysBetween(todayIso(), row.due_date) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// =======================================================================
// CRUD
// =======================================================================
async function createBill(input, userId) {
  if (!input.name?.trim()) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'Bill name is required.');
  }
  if (!FREQUENCIES.has(input.frequency)) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'Invalid frequency.');
  }
  if (!PAYMENT_METHODS.has(input.paymentMethod || 'bank')) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'Invalid payment method.');
  }
  if (!input.startDate) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'Start date is required.');
  }
  if (!input.isVariableAmount && (!input.amount || Number(input.amount) <= 0)) {
    throw new AppError(
      ERROR_CODES.VALIDATION_FAILED,
      'Amount is required for fixed-amount bills.',
    );
  }

  return withTransaction(async (client) => {
    const nextDue = dateOnly(input.firstDueDate || input.startDate);
    const { rows } = await client.query(
      `INSERT INTO bills
         (name, category_id, vendor_name, amount, is_variable_amount,
          frequency, start_date, next_due_date, reminder_days_before,
          payment_method, bank_account_id, auto_recurring, notes, status,
          created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7::date,$8::date,$9,$10,$11,$12,$13,'active',$14)
       RETURNING *`,
      [
        input.name.trim(),
        input.categoryId || null,
        input.vendorName || null,
        input.isVariableAmount ? null : money(input.amount),
        Boolean(input.isVariableAmount),
        input.frequency,
        dateOnly(input.startDate),
        nextDue,
        input.reminderDaysBefore ?? 7,
        input.paymentMethod || 'bank',
        input.bankAccountId || null,
        input.autoRecurring !== false,
        input.notes || null,
        userId || null,
      ],
    );
    const bill = rows[0];

    // Create the first bill_payment row so the upcoming sweep can pick it up.
    await client.query(
      `INSERT INTO bill_payments
         (bill_id, amount_due, due_date, payment_method, bank_account_id, status)
       VALUES ($1, $2, $3::date, $4, $5, 'upcoming')`,
      [
        bill.id,
        bill.is_variable_amount ? 0 : money(bill.amount),
        nextDue,
        bill.payment_method,
        bill.bank_account_id,
      ],
    );

    await logActivity({
      entityType: 'bill',
      entityId: bill.id,
      action: 'bill.created',
      performedBy: userId,
      newValue: {
        name: bill.name,
        frequency: bill.frequency,
        amount: bill.amount,
      },
    });
    return shapeBill(bill);
  });
}

async function updateBill(id, input, userId) {
  return withTransaction(async (client) => {
    const { rows: existing } = await client.query(
      `SELECT * FROM bills WHERE id = $1 FOR UPDATE`,
      [id],
    );
    if (!existing.length) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, {
        status: 404,
      });
    }
    if (existing[0].status === 'cancelled') {
      throw new AppError(ERROR_CODES.BIZ_BILL_CANCELLED, undefined, { status: 409 });
    }
    const patch = {
      name: input.name?.trim() ?? existing[0].name,
      category_id:
        input.categoryId !== undefined ? input.categoryId : existing[0].category_id,
      vendor_name:
        input.vendorName !== undefined ? input.vendorName : existing[0].vendor_name,
      amount:
        input.isVariableAmount === true
          ? null
          : input.amount !== undefined
          ? money(input.amount)
          : existing[0].amount,
      is_variable_amount:
        input.isVariableAmount !== undefined
          ? Boolean(input.isVariableAmount)
          : existing[0].is_variable_amount,
      frequency: input.frequency || existing[0].frequency,
      next_due_date:
        input.nextDueDate !== undefined
          ? dateOnly(input.nextDueDate)
          : dateOnly(existing[0].next_due_date),
      reminder_days_before:
        input.reminderDaysBefore !== undefined
          ? input.reminderDaysBefore
          : existing[0].reminder_days_before,
      payment_method: input.paymentMethod || existing[0].payment_method,
      bank_account_id:
        input.bankAccountId !== undefined
          ? input.bankAccountId
          : existing[0].bank_account_id,
      auto_recurring:
        input.autoRecurring !== undefined
          ? Boolean(input.autoRecurring)
          : existing[0].auto_recurring,
      notes: input.notes !== undefined ? input.notes : existing[0].notes,
    };
    const { rows } = await client.query(
      `UPDATE bills SET
         name = $1, category_id = $2, vendor_name = $3, amount = $4,
         is_variable_amount = $5, frequency = $6, next_due_date = $7::date,
         reminder_days_before = $8, payment_method = $9, bank_account_id = $10,
         auto_recurring = $11, notes = $12, updated_at = NOW()
       WHERE id = $13
       RETURNING *`,
      [
        patch.name,
        patch.category_id,
        patch.vendor_name,
        patch.amount,
        patch.is_variable_amount,
        patch.frequency,
        patch.next_due_date,
        patch.reminder_days_before,
        patch.payment_method,
        patch.bank_account_id,
        patch.auto_recurring,
        patch.notes,
        id,
      ],
    );

    // Keep the pending bill_payment in sync with the updated due date/amount.
    await client.query(
      `UPDATE bill_payments
          SET due_date = $1::date,
              amount_due = $2,
              payment_method = $3,
              bank_account_id = $4,
              updated_at = NOW()
        WHERE bill_id = $5
          AND status IN ('upcoming','due')`,
      [
        patch.next_due_date,
        patch.is_variable_amount ? 0 : money(patch.amount || 0),
        patch.payment_method,
        patch.bank_account_id,
        id,
      ],
    );

    await logActivity({
      entityType: 'bill',
      entityId: id,
      action: 'bill.updated',
      performedBy: userId,
      newValue: { name: patch.name, frequency: patch.frequency },
    });

    return shapeBill(rows[0]);
  });
}

async function setStatus({ id, status, userId }) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `UPDATE bills
          SET status = $1, updated_at = NOW()
        WHERE id = $2
        RETURNING *`,
      [status, id],
    );
    if (!rows.length) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, { status: 404 });
    }
    // Pausing / cancelling clears any open upcoming payments so the sweep
    // doesn't fire reminders. Resuming re-creates the next payment if there
    // isn't already an open one.
    if (status === 'paused' || status === 'cancelled') {
      await client.query(
        `DELETE FROM bill_payments
          WHERE bill_id = $1 AND status IN ('upcoming','due','overdue')`,
        [id],
      );
    }
    if (status === 'active') {
      const { rows: openRows } = await client.query(
        `SELECT 1 FROM bill_payments
          WHERE bill_id = $1 AND status IN ('upcoming','due','overdue') LIMIT 1`,
        [id],
      );
      if (!openRows.length) {
        await client.query(
          `INSERT INTO bill_payments
             (bill_id, amount_due, due_date, payment_method, bank_account_id, status)
           VALUES ($1, $2, $3::date, $4, $5, 'upcoming')`,
          [
            id,
            rows[0].is_variable_amount ? 0 : money(rows[0].amount || 0),
            dateOnly(rows[0].next_due_date),
            rows[0].payment_method,
            rows[0].bank_account_id,
          ],
        );
      }
    }
    await logActivity({
      entityType: 'bill',
      entityId: id,
      action:
        status === 'paused'
          ? 'bill.paused'
          : status === 'cancelled'
          ? 'bill.cancelled'
          : 'bill.resumed',
      performedBy: userId,
    });
    return shapeBill(rows[0]);
  });
}

// =======================================================================
// Cycle generation
// =======================================================================
async function generateNextCycleWith(client, billId, userId) {
  const { rows } = await client.query(
    `SELECT * FROM bills WHERE id = $1 FOR UPDATE`,
    [billId],
  );
  if (!rows.length) return null;
  const bill = rows[0];
  if (!bill.auto_recurring || bill.status !== 'active') return null;

  const nextDue = addCycle(bill.next_due_date, bill.frequency);
  await client.query(
    `UPDATE bills SET next_due_date = $1::date, updated_at = NOW()
      WHERE id = $2`,
    [nextDue, bill.id],
  );

  // Ensure there's no other open payment for this bill before inserting the
  // next cycle (defensive — payBill should have flipped this one to 'paid').
  const { rows: paymentRows } = await client.query(
    `INSERT INTO bill_payments
       (bill_id, amount_due, due_date, payment_method, bank_account_id, status)
     SELECT $1, $2, $3::date, $4, $5, 'upcoming'
      WHERE NOT EXISTS (
        SELECT 1 FROM bill_payments
         WHERE bill_id = $1 AND status IN ('upcoming','due','overdue')
      )
     RETURNING *`,
    [
      bill.id,
      bill.is_variable_amount ? 0 : money(bill.amount || 0),
      nextDue,
      bill.payment_method,
      bill.bank_account_id,
    ],
  );

  await logActivity({
    entityType: 'bill',
    entityId: bill.id,
    action: 'bill.next_cycle',
    performedBy: userId,
    newValue: { nextDueDate: nextDue },
  });

  return paymentRows[0] || null;
}

// =======================================================================
// Pay
// =======================================================================
async function payBillPayment({
  billPaymentId,
  amountPaid,
  paymentMethod,
  bankAccountId = null,
  paidDate = null,
  notes = null,
  receiptAttachment = null,
  userId,
  io = null,
}) {
  if (!PAYMENT_METHODS.has(paymentMethod)) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'Invalid payment method.');
  }
  const amt = money(amountPaid);
  if (!Number.isFinite(amt) || amt <= 0) {
    throw new AppError(
      ERROR_CODES.BIZ_AMOUNT_REQUIRED,
      'Paid amount must be greater than zero.',
    );
  }

  const result = await withTransaction(async (client) => {
    const { rows: payRows } = await client.query(
      `SELECT bp.*, b.name AS bill_name, b.is_variable_amount, b.status AS bill_status
         FROM bill_payments bp
         JOIN bills b ON b.id = bp.bill_id
        WHERE bp.id = $1 FOR UPDATE`,
      [billPaymentId],
    );
    if (!payRows.length) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, { status: 404 });
    }
    const payment = payRows[0];
    if (payment.status === 'paid') {
      throw new AppError(ERROR_CODES.BIZ_BILL_ALREADY_PAID, undefined, { status: 409 });
    }
    if (payment.bill_status === 'paused') {
      throw new AppError(ERROR_CODES.BIZ_BILL_PAUSED, undefined, { status: 409 });
    }
    if (payment.bill_status === 'cancelled') {
      throw new AppError(ERROR_CODES.BIZ_BILL_CANCELLED, undefined, { status: 409 });
    }

    const paidDateStr = dateOnly(paidDate) || todayIso();
    const amountDue = payment.is_variable_amount ? amt : money(payment.amount_due);

    const { rows } = await client.query(
      `UPDATE bill_payments
          SET amount_due = $1,
              amount_paid = $2,
              paid_date = $3::date,
              payment_method = $4,
              bank_account_id = $5,
              receipt_attachment = COALESCE($6, receipt_attachment),
              paid_by = $7,
              status = 'paid',
              notes = COALESCE($8, notes),
              updated_at = NOW()
        WHERE id = $9
        RETURNING *`,
      [
        amountDue,
        amt,
        paidDateStr,
        paymentMethod,
        bankAccountId,
        receiptAttachment,
        userId || null,
        notes,
        billPaymentId,
      ],
    );

    // Treasury bookkeeping.
    let treasury = null;
    if (paymentMethod === 'cash') {
      treasury = await cashService.recordCashOut({
        client,
        transactionType: 'bill_payment',
        amount: amt,
        referenceType: 'bill_payment',
        referenceId: billPaymentId,
        employeeId: userId,
        notes: `Bill: ${payment.bill_name}`,
      });
    } else {
      treasury = await bankService.recordBankOut({
        client,
        bankAccountId,
        transactionType: 'bill_payment',
        amount: amt,
        referenceType: 'bill_payment',
        referenceId: billPaymentId,
        employeeId: userId,
        description: `Bill: ${payment.bill_name}`,
        allowOverdraft: true,
      });
    }

    // Mark any open notifications resolved.
    await client.query(
      `UPDATE bill_notifications
          SET is_resolved = true, resolved_at = NOW()
        WHERE bill_payment_id = $1 AND is_resolved = false`,
      [billPaymentId],
    );

    // Generate the next cycle (if auto_recurring + active).
    const nextPayment = await generateNextCycleWith(client, payment.bill_id, userId);

    await logActivity({
      entityType: 'bill_payment',
      entityId: billPaymentId,
      action: 'bill.paid',
      performedBy: userId,
      newValue: { amount: amt, method: paymentMethod },
    });

    return {
      payment: shapeBillPayment(rows[0]),
      nextPayment,
      treasury,
      billName: payment.bill_name,
    };
  });

  if (io) {
    const billPaidPayload = {
      billPaymentId,
      billId: result.payment.billId,
      billName: result.billName,
      amount: amt,
      paymentMethod,
      paidBy: userId,
      at: new Date().toISOString(),
    };
    io.to('role:Manager').emit('bill_paid', billPaidPayload);
    io.to('role:Admin').emit('bill_paid', billPaidPayload);

    const balancePayload = {
      newBalance: result.treasury?.balanceAfter,
      delta: result.treasury?.delta,
      transactionType: 'bill_payment',
      changedBy: userId,
      at: new Date().toISOString(),
    };
    if (paymentMethod === 'cash') {
      io.to('role:Manager').emit('cash_balance_updated', balancePayload);
      io.to('role:Admin').emit('cash_balance_updated', balancePayload);
    } else {
      const bankPayload = {
        ...balancePayload,
        accountId: result.treasury?.accountId,
        bankName: result.treasury?.bankName,
      };
      io.to('role:Manager').emit('bank_balance_updated', bankPayload);
      io.to('role:Admin').emit('bank_balance_updated', bankPayload);
    }
  }

  return result;
}

// =======================================================================
// Reads
// =======================================================================
async function listBills({
  status = null,
  frequency = null,
  categoryId = null,
  limit = 100,
  offset = 0,
}) {
  const parts = [];
  const params = [];
  let i = 1;
  if (status) {
    parts.push(`b.status = $${i++}`);
    params.push(status);
  }
  if (frequency) {
    parts.push(`b.frequency = $${i++}`);
    params.push(frequency);
  }
  if (categoryId) {
    parts.push(`b.category_id = $${i++}`);
    params.push(categoryId);
  }
  const where = parts.length ? `WHERE ${parts.join(' AND ')}` : '';
  const { rows } = await query(
    `SELECT b.*, c.name AS category_name, c.icon AS category_icon,
            c.type AS category_type,
            ba.bank_name,
            u.username AS created_by_username,
            (
              SELECT bp.amount_paid FROM bill_payments bp
               WHERE bp.bill_id = b.id AND bp.status = 'paid'
               ORDER BY bp.paid_date DESC LIMIT 1
            ) AS last_paid_amount,
            (
              SELECT bp.paid_date FROM bill_payments bp
               WHERE bp.bill_id = b.id AND bp.status = 'paid'
               ORDER BY bp.paid_date DESC LIMIT 1
            ) AS last_paid_date,
            (
              SELECT bp.status FROM bill_payments bp
               WHERE bp.bill_id = b.id AND bp.status IN ('upcoming','due','overdue')
               ORDER BY bp.due_date ASC LIMIT 1
            ) AS upcoming_payment_status,
            (
              SELECT bp.id FROM bill_payments bp
               WHERE bp.bill_id = b.id AND bp.status IN ('upcoming','due','overdue')
               ORDER BY bp.due_date ASC LIMIT 1
            ) AS upcoming_payment_id
       FROM bills b
       LEFT JOIN expense_categories c ON c.id = b.category_id
       LEFT JOIN bank_accounts ba ON ba.id = b.bank_account_id
       LEFT JOIN users u ON u.id = b.created_by
       ${where}
       ORDER BY
         CASE b.status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END,
         b.next_due_date ASC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset],
  );

  return rows.map((r) =>
    shapeBill(r, {
      lastPaidAmount: r.last_paid_amount != null ? Number(r.last_paid_amount) : null,
      lastPaidDate: dateOnly(r.last_paid_date),
      upcomingPaymentStatus: r.upcoming_payment_status,
      upcomingPaymentId: r.upcoming_payment_id,
    }),
  );
}

async function getBill(id) {
  const { rows } = await query(
    `SELECT b.*, c.name AS category_name, c.icon AS category_icon,
            c.type AS category_type,
            ba.bank_name,
            u.username AS created_by_username
       FROM bills b
       LEFT JOIN expense_categories c ON c.id = b.category_id
       LEFT JOIN bank_accounts ba ON ba.id = b.bank_account_id
       LEFT JOIN users u ON u.id = b.created_by
      WHERE b.id = $1`,
    [id],
  );
  if (!rows.length) {
    throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, { status: 404 });
  }
  const { rows: payments } = await query(
    `SELECT bp.*, ba.bank_name, u.username AS paid_by_username
       FROM bill_payments bp
       LEFT JOIN bank_accounts ba ON ba.id = bp.bank_account_id
       LEFT JOIN users u ON u.id = bp.paid_by
      WHERE bp.bill_id = $1
      ORDER BY bp.due_date DESC`,
    [id],
  );
  return {
    ...shapeBill(rows[0]),
    payments: payments.map(shapeBillPayment),
  };
}

async function listPayments({
  status = null,
  billId = null,
  from = null,
  to = null,
  limit = 100,
  offset = 0,
}) {
  const parts = [];
  const params = [];
  let i = 1;
  if (status) {
    parts.push(`bp.status = $${i++}`);
    params.push(status);
  }
  if (billId) {
    parts.push(`bp.bill_id = $${i++}`);
    params.push(billId);
  }
  if (from) {
    parts.push(`bp.due_date >= $${i++}::date`);
    params.push(from);
  }
  if (to) {
    parts.push(`bp.due_date <= $${i++}::date`);
    params.push(to);
  }
  const where = parts.length ? `WHERE ${parts.join(' AND ')}` : '';
  const { rows } = await query(
    `SELECT bp.*, b.name AS bill_name, b.vendor_name,
            c.name AS category_name, c.icon AS category_icon,
            ba.bank_name,
            u.username AS paid_by_username
       FROM bill_payments bp
       JOIN bills b ON b.id = bp.bill_id
       LEFT JOIN expense_categories c ON c.id = b.category_id
       LEFT JOIN bank_accounts ba ON ba.id = bp.bank_account_id
       LEFT JOIN users u ON u.id = bp.paid_by
       ${where}
       ORDER BY bp.due_date DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset],
  );
  return rows.map(shapeBillPayment);
}

async function getUpcomingGrouped() {
  // Pulls every non-paid bill payment from active bills and buckets them.
  const { rows } = await query(
    `SELECT bp.*, b.name AS bill_name, b.vendor_name, b.is_variable_amount,
            c.name AS category_name, c.icon AS category_icon,
            ba.bank_name
       FROM bill_payments bp
       JOIN bills b ON b.id = bp.bill_id
       LEFT JOIN expense_categories c ON c.id = b.category_id
       LEFT JOIN bank_accounts ba ON ba.id = bp.bank_account_id
      WHERE bp.status IN ('upcoming','due','overdue')
        AND b.status = 'active'
      ORDER BY bp.due_date ASC`,
  );
  const today = todayIso();
  const buckets = { overdue: [], dueToday: [], thisWeek: [], thisMonth: [], later: [] };
  for (const r of rows) {
    const shaped = shapeBillPayment(r);
    const days = shaped.daysUntilDue ?? 0;
    if (days < 0) buckets.overdue.push(shaped);
    else if (days === 0) buckets.dueToday.push(shaped);
    else if (days <= 7) buckets.thisWeek.push(shaped);
    else if (days <= 30) buckets.thisMonth.push(shaped);
    else buckets.later.push(shaped);
  }

  // Summary totals for the dashboard widget.
  const sum = (arr) => arr.reduce((acc, b) => acc + Number(b.amountDue || 0), 0);
  const overdueAmount = sum(buckets.overdue);
  const dueThisWeekAmount = sum(buckets.dueToday) + sum(buckets.thisWeek);
  const dueThisMonthAmount =
    overdueAmount +
    sum(buckets.dueToday) +
    sum(buckets.thisWeek) +
    sum(buckets.thisMonth);

  // Paid this month.
  const monthStart = `${today.slice(0, 7)}-01`;
  const { rows: paidRows } = await query(
    `SELECT COALESCE(SUM(amount_paid),0)::float8 AS total
       FROM bill_payments
      WHERE status = 'paid' AND paid_date >= $1::date`,
    [monthStart],
  );

  // Total monthly recurring expectation.
  const { rows: monthlyRows } = await query(
    `SELECT COALESCE(SUM(amount),0)::float8 AS total
       FROM bills
      WHERE status = 'active'
        AND frequency = 'monthly'
        AND is_variable_amount = false`,
  );

  return {
    asOf: today,
    buckets,
    totals: {
      overdueAmount,
      dueThisWeekAmount,
      dueThisMonthAmount,
      paidThisMonth: Number(paidRows[0].total) || 0,
      monthlyRecurringTotal: Number(monthlyRows[0].total) || 0,
    },
  };
}

// =======================================================================
// Daily sweep — flip statuses + emit notifications + reminders
// =======================================================================
async function checkAndUpdateBillStatuses({ io = null } = {}) {
  const today = todayIso();
  return withTransaction(async (client) => {
    // Skip paused/cancelled bills entirely.
    await client.query(
      `UPDATE bill_payments bp
          SET status = 'overdue', updated_at = NOW()
         FROM bills b
        WHERE bp.bill_id = b.id
          AND b.status = 'active'
          AND bp.status IN ('upcoming','due')
          AND bp.due_date < $1::date`,
      [today],
    );
    await client.query(
      `UPDATE bill_payments bp
          SET status = 'due', updated_at = NOW()
         FROM bills b
        WHERE bp.bill_id = b.id
          AND b.status = 'active'
          AND bp.status = 'upcoming'
          AND bp.due_date = $1::date`,
      [today],
    );

    // Collect rows that warrant notifications.
    const { rows: alerts } = await client.query(
      `SELECT bp.id, bp.bill_id, bp.due_date, bp.amount_due, bp.status,
              b.name AS bill_name, b.reminder_days_before, b.is_variable_amount,
              ($1::date - bp.due_date)::int AS overdue_days
         FROM bill_payments bp
         JOIN bills b ON b.id = bp.bill_id
        WHERE b.status = 'active'
          AND bp.status IN ('upcoming','due','overdue')
          AND (
            bp.status IN ('due','overdue')
            OR (bp.due_date - $1::date) <= b.reminder_days_before
          )`,
      [today],
    );

    const inserted = [];
    for (const a of alerts) {
      const daysUntilDue = -Number(a.overdue_days || 0);
      const isVariable = Boolean(a.is_variable_amount);
      const amountText = isVariable
        ? 'variable amount'
        : `${money(a.amount_due).toFixed(2)} AED`;
      let type;
      let message;
      if (a.status === 'overdue') {
        type = 'overdue';
        const days = Math.abs(daysUntilDue);
        message = `${a.bill_name} is overdue by ${days} day${days === 1 ? '' : 's'} (${amountText}).`;
      } else if (a.status === 'due') {
        type = 'due_today';
        message = `${a.bill_name} is due today (${amountText}).`;
      } else {
        type = 'upcoming';
        message = `${a.bill_name} is due in ${daysUntilDue} day${daysUntilDue === 1 ? '' : 's'} (${amountText}).`;
      }

      // Insert idempotently using the partial unique index.
      const { rows: notif } = await client.query(
        `INSERT INTO bill_notifications (bill_payment_id, type, message)
         VALUES ($1, $2, $3)
         ON CONFLICT (bill_payment_id, type)
            WHERE is_resolved = false
            DO NOTHING
         RETURNING *`,
        [a.id, type, message],
      );
      if (notif.length) {
        inserted.push({
          notification: notif[0],
          billPaymentId: a.id,
          billName: a.bill_name,
          amount: Number(a.amount_due) || 0,
          dueDate: dateOnly(a.due_date),
          daysUntilDue,
          type,
        });
      }
    }

    if (io && inserted.length) {
      for (const n of inserted) {
        const payload = {
          billPaymentId: n.billPaymentId,
          billName: n.billName,
          amount: n.amount,
          dueDate: n.dueDate,
          daysUntilDue: n.daysUntilDue,
          type: n.type,
        };
        io.to('role:Manager').emit('bill_due_reminder', payload);
        io.to('role:Admin').emit('bill_due_reminder', payload);
      }
    }

    return { day: today, notifications: inserted.length };
  });
}

module.exports = {
  createBill,
  updateBill,
  setStatus,
  payBillPayment,
  generateNextCycleWith,
  listBills,
  getBill,
  listPayments,
  getUpcomingGrouped,
  checkAndUpdateBillStatuses,
  shapeBill,
  shapeBillPayment,
};
