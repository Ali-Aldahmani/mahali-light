const { query, withTransaction } = require('../db/postgres');
const { AppError, ERROR_CODES } = require('../../shared/errorCodes');
const { logActivity } = require('../utils/activityLog');
const cashService = require('./cashService');
const bankService = require('./bankService');
const { deleteAttachmentFile } = require('../utils/upload');

const PAYMENT_METHODS = new Set(['cash', 'bank']);

function money(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function dateOnly(input) {
  if (!input) return null;
  if (input instanceof Date) return input.toISOString().slice(0, 10);
  return String(input).slice(0, 10);
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function shapeExpense(row) {
  if (!row) return null;
  return {
    id: row.id,
    categoryId: row.category_id,
    categoryName: row.category_name || null,
    categoryIcon: row.category_icon || null,
    description: row.description,
    amount: Number(row.amount) || 0,
    expenseDate: dateOnly(row.expense_date),
    paymentMethod: row.payment_method,
    bankAccountId: row.bank_account_id,
    bankName: row.bank_name || null,
    receiptAttachment: row.receipt_attachment,
    paidBy: row.paid_by,
    paidByUsername: row.paid_by_username || null,
    notes: row.notes,
    createdAt: row.created_at,
  };
}

// =======================================================================
// Create
// =======================================================================
async function createExpense({
  categoryId,
  description,
  amount,
  expenseDate,
  paymentMethod,
  bankAccountId = null,
  notes = null,
  userId,
  io = null,
}) {
  if (!description?.trim()) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'Description is required.');
  }
  const amt = money(amount);
  if (!Number.isFinite(amt) || amt <= 0) {
    throw new AppError(
      ERROR_CODES.VALIDATION_FAILED,
      'Amount must be greater than zero.',
    );
  }
  if (!PAYMENT_METHODS.has(paymentMethod)) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'Invalid payment method.');
  }

  const result = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO one_time_expenses
         (category_id, description, amount, expense_date,
          payment_method, bank_account_id, paid_by, notes)
       VALUES ($1,$2,$3,$4::date,$5,$6,$7,$8)
       RETURNING *`,
      [
        categoryId || null,
        description.trim(),
        amt,
        dateOnly(expenseDate) || todayIso(),
        paymentMethod,
        bankAccountId || null,
        userId || null,
        notes || null,
      ],
    );

    const expense = rows[0];

    let treasury = null;
    if (paymentMethod === 'cash') {
      treasury = await cashService.recordCashOut({
        client,
        transactionType: 'expense',
        amount: amt,
        referenceType: 'expense',
        referenceId: expense.id,
        employeeId: userId,
        notes: `Expense: ${description.trim().slice(0, 80)}`,
      });
    } else {
      treasury = await bankService.recordBankOut({
        client,
        bankAccountId,
        transactionType: 'expense',
        amount: amt,
        referenceType: 'expense',
        referenceId: expense.id,
        employeeId: userId,
        description: `Expense: ${description.trim().slice(0, 80)}`,
        allowOverdraft: true,
      });
    }

    await logActivity({
      entityType: 'expense',
      entityId: expense.id,
      action: 'expense.created',
      performedBy: userId,
      newValue: { amount: amt, method: paymentMethod, categoryId },
    });

    return { expense, treasury };
  });

  if (io) {
    const expensePayload = {
      expenseId: result.expense.id,
      category: result.expense.category_id,
      amount: amt,
      recordedBy: userId,
      at: new Date().toISOString(),
    };
    io.to('role:Manager').emit('expense_recorded', expensePayload);
    io.to('role:Admin').emit('expense_recorded', expensePayload);

    const balancePayload = {
      newBalance: result.treasury?.balanceAfter,
      delta: result.treasury?.delta,
      transactionType: 'expense',
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

  // Return a fully-shaped record (re-fetch so we get joined names/icons).
  return getExpense(result.expense.id);
}

// =======================================================================
// Read
// =======================================================================
async function listExpenses({
  categoryId = null,
  paymentMethod = null,
  search = null,
  from = null,
  to = null,
  limit = 50,
  offset = 0,
}) {
  const parts = [];
  const params = [];
  let i = 1;
  if (categoryId) {
    parts.push(`e.category_id = $${i++}`);
    params.push(categoryId);
  }
  if (paymentMethod) {
    parts.push(`e.payment_method = $${i++}`);
    params.push(paymentMethod);
  }
  if (from) {
    parts.push(`e.expense_date >= $${i++}::date`);
    params.push(from);
  }
  if (to) {
    parts.push(`e.expense_date <= $${i++}::date`);
    params.push(to);
  }
  if (search) {
    parts.push(`e.description ILIKE $${i++}`);
    params.push(`%${search}%`);
  }
  const where = parts.length ? `WHERE ${parts.join(' AND ')}` : '';

  const { rows } = await query(
    `SELECT e.*, c.name AS category_name, c.icon AS category_icon,
            ba.bank_name, u.username AS paid_by_username
       FROM one_time_expenses e
       LEFT JOIN expense_categories c ON c.id = e.category_id
       LEFT JOIN bank_accounts ba ON ba.id = e.bank_account_id
       LEFT JOIN users u ON u.id = e.paid_by
       ${where}
       ORDER BY e.expense_date DESC, e.created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset],
  );
  const { rows: tot } = await query(
    `SELECT COUNT(*)::int AS total, COALESCE(SUM(amount),0)::float8 AS total_amount
       FROM one_time_expenses e ${where}`,
    params,
  );

  return {
    rows: rows.map(shapeExpense),
    total: tot[0].total,
    totalAmount: Number(tot[0].total_amount) || 0,
  };
}

async function getExpense(id) {
  const { rows } = await query(
    `SELECT e.*, c.name AS category_name, c.icon AS category_icon,
            ba.bank_name, u.username AS paid_by_username
       FROM one_time_expenses e
       LEFT JOIN expense_categories c ON c.id = e.category_id
       LEFT JOIN bank_accounts ba ON ba.id = e.bank_account_id
       LEFT JOIN users u ON u.id = e.paid_by
      WHERE e.id = $1`,
    [id],
  );
  if (!rows.length) {
    throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, { status: 404 });
  }
  return shapeExpense(rows[0]);
}

async function summary({ month, year }) {
  const now = new Date();
  const m = month || now.getMonth() + 1;
  const y = year || now.getFullYear();
  const start = `${y}-${String(m).padStart(2, '0')}-01`;

  const { rows: byCategory } = await query(
    `SELECT c.id AS category_id, c.name AS category_name, c.icon AS category_icon,
            COALESCE(SUM(e.amount),0)::float8 AS total,
            COUNT(e.id)::int AS count
       FROM expense_categories c
       LEFT JOIN one_time_expenses e
              ON e.category_id = c.id
             AND e.expense_date >= $1::date
             AND e.expense_date < ($1::date + INTERVAL '1 month')
      GROUP BY c.id, c.name, c.icon
      ORDER BY total DESC`,
    [start],
  );

  const { rows: monthTotal } = await query(
    `SELECT COALESCE(SUM(amount),0)::float8 AS total
       FROM one_time_expenses
      WHERE expense_date >= $1::date
        AND expense_date < ($1::date + INTERVAL '1 month')`,
    [start],
  );

  const { rows: yearTotal } = await query(
    `SELECT COALESCE(SUM(amount),0)::float8 AS total
       FROM one_time_expenses
      WHERE EXTRACT(YEAR FROM expense_date) = $1`,
    [y],
  );

  return {
    month: m,
    year: y,
    monthTotal: Number(monthTotal[0].total) || 0,
    yearTotal: Number(yearTotal[0].total) || 0,
    byCategory: byCategory.map((r) => ({
      categoryId: r.category_id,
      categoryName: r.category_name,
      categoryIcon: r.category_icon,
      total: Number(r.total) || 0,
      count: r.count,
    })),
  };
}

// =======================================================================
// Delete (same calendar day only)
// =======================================================================
async function deleteExpense({ id, userId }) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM one_time_expenses WHERE id = $1 FOR UPDATE`,
      [id],
    );
    if (!rows.length) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, { status: 404 });
    }
    const expense = rows[0];

    // Same-day enforcement uses created_at (the row's clock) so back-dated
    // entries can still be deleted within their actual entry window.
    const createdDay = new Date(expense.created_at).toISOString().slice(0, 10);
    if (createdDay !== todayIso()) {
      throw new AppError(ERROR_CODES.BIZ_EXPENSE_LOCKED, undefined, { status: 409 });
    }

    // Reverse the original treasury posting using the inverse direction +
    // the same reference, so the audit trail stays self-explanatory.
    const amt = Number(expense.amount) || 0;
    if (amt > 0) {
      if (expense.payment_method === 'cash') {
        await cashService.recordCashIn({
          client,
          transactionType: 'expense',
          amount: amt,
          referenceType: 'expense',
          referenceId: expense.id,
          employeeId: userId,
          notes: 'Reversal of deleted expense',
        });
      } else if (expense.payment_method === 'bank') {
        await bankService.recordBankIn({
          client,
          bankAccountId: expense.bank_account_id,
          transactionType: 'expense',
          amount: amt,
          referenceType: 'expense',
          referenceId: expense.id,
          employeeId: userId,
          description: 'Reversal of deleted expense',
        });
      }
    }

    if (expense.receipt_attachment) {
      try {
        deleteAttachmentFile(expense.receipt_attachment);
      } catch (_e) {
        // ignore
      }
    }

    await client.query(`DELETE FROM one_time_expenses WHERE id = $1`, [id]);

    await logActivity({
      entityType: 'expense',
      entityId: id,
      action: 'expense.deleted',
      performedBy: userId,
      oldValue: {
        amount: Number(expense.amount),
        method: expense.payment_method,
      },
    });
    return { deleted: true };
  });
}

// Update the receipt attachment field on an expense.
async function setExpenseReceipt(expenseId, relativePath) {
  await query(
    `UPDATE one_time_expenses SET receipt_attachment = $1 WHERE id = $2`,
    [relativePath, expenseId],
  );
}

module.exports = {
  createExpense,
  listExpenses,
  getExpense,
  deleteExpense,
  summary,
  setExpenseReceipt,
  shapeExpense,
};
