const { query, withTransaction } = require('../db/postgres');
const { AppError, ERROR_CODES } = require('../../shared/errorCodes');
const { logActivity } = require('../utils/activityLog');

const ALLOWED_TX_TYPES = new Set([
  'sale',
  'refund',
  'supplier_payment',
  'customer_payment',
  'expense',
  'bill_payment',
  'manual_deposit',
  'manual_withdrawal',
  'transfer',
]);

function money(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function shapeAccount(row, extra = {}) {
  if (!row) return null;
  return {
    id: row.id,
    bankName: row.bank_name,
    accountName: row.account_name,
    accountNumber: row.account_number,
    iban: row.iban,
    currency: row.currency,
    currentBalance: Number(row.current_balance || 0),
    openingBalance: Number(row.opening_balance || 0),
    isActive: row.is_active,
    isDefault: row.is_default,
    notes: row.notes,
    createdBy: row.created_by,
    createdByUsername: row.created_by_username || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...extra,
  };
}

function shapeTransaction(row) {
  return {
    id: row.id,
    bankAccountId: row.bank_account_id,
    bankName: row.bank_name || null,
    accountName: row.account_name || null,
    transactionType: row.transaction_type,
    direction: row.direction,
    amount: Number(row.amount),
    balanceBefore: Number(row.balance_before),
    balanceAfter: Number(row.balance_after),
    referenceType: row.reference_type,
    referenceId: row.reference_id,
    employeeId: row.employee_id,
    employeeUsername: row.employee_username || null,
    transactionDate: row.transaction_date,
    timestamp: row.timestamp,
    description: row.description,
    receiptAttachment: row.receipt_attachment,
    notes: row.notes,
  };
}

// =======================================================================
// Resolution helpers
// =======================================================================
async function resolveAccount(client, bankAccountId) {
  if (bankAccountId) {
    const { rows } = await client.query(
      `SELECT * FROM bank_accounts WHERE id = $1 FOR UPDATE`,
      [bankAccountId],
    );
    if (!rows.length) {
      throw new AppError(
        ERROR_CODES.RESOURCE_NOT_FOUND,
        'Bank account not found.',
        { status: 404 },
      );
    }
    return rows[0];
  }
  // Fall back to the default account (or first active) when the caller didn't
  // specify one. Cash collections and supplier payments use this when the
  // user just picks "Bank transfer" without nominating an account.
  const { rows } = await client.query(
    `SELECT * FROM bank_accounts
      WHERE is_active = true
      ORDER BY is_default DESC, created_at ASC
      LIMIT 1 FOR UPDATE`,
  );
  if (!rows.length) {
    throw new AppError(ERROR_CODES.BIZ_NO_DEFAULT_BANK, undefined, {
      status: 409,
    });
  }
  return rows[0];
}

// =======================================================================
// Internal: post a single bank transaction + bump the balance.
// =======================================================================
async function postTransactionWith(client, params) {
  const {
    bankAccountId = null,
    transactionType,
    direction,
    amount,
    referenceType = null,
    referenceId = null,
    employeeId = null,
    transactionDate = null,
    description = null,
    receiptAttachment = null,
    notes = null,
    allowOverdraft = false,
  } = params;

  if (!ALLOWED_TX_TYPES.has(transactionType)) {
    throw new AppError(
      ERROR_CODES.VALIDATION_FAILED,
      `Invalid bank transaction type ${transactionType}.`,
    );
  }
  if (direction !== 'in' && direction !== 'out') {
    throw new AppError(
      ERROR_CODES.VALIDATION_FAILED,
      'Bank direction must be "in" or "out".',
    );
  }
  const amt = money(amount);
  if (!Number.isFinite(amt) || amt <= 0) {
    throw new AppError(
      ERROR_CODES.VALIDATION_FAILED,
      'Bank amount must be greater than zero.',
    );
  }

  const account = await resolveAccount(client, bankAccountId);
  const before = money(account.current_balance);
  const delta = direction === 'in' ? amt : -amt;
  const after = money(before + delta);

  if (direction === 'out' && after < -0.0001 && !allowOverdraft) {
    throw new AppError(
      ERROR_CODES.BIZ_INSUFFICIENT_BANK_BALANCE,
      `Bank account ${account.bank_name} would go to ${after.toFixed(2)} AED.`,
      {
        status: 409,
        details: { available: before, requested: amt, accountId: account.id },
      },
    );
  }

  const txDate =
    transactionDate || new Date().toISOString().slice(0, 10);

  const { rows: txRows } = await client.query(
    `INSERT INTO bank_transactions
       (bank_account_id, transaction_type, direction, amount,
        balance_before, balance_after, reference_type, reference_id,
        employee_id, transaction_date, description, receipt_attachment, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING *`,
    [
      account.id,
      transactionType,
      direction,
      amt,
      before,
      after,
      referenceType,
      referenceId,
      employeeId,
      txDate,
      description,
      receiptAttachment,
      notes,
    ],
  );

  await client.query(
    `UPDATE bank_accounts
        SET current_balance = $1,
            updated_at = NOW()
      WHERE id = $2`,
    [after, account.id],
  );

  return {
    transaction: txRows[0],
    accountId: account.id,
    bankName: account.bank_name,
    balanceBefore: before,
    balanceAfter: after,
    delta,
  };
}

async function recordBank(params) {
  const { client, io = null, ...rest } = params;
  if (client) {
    return postTransactionWith(client, rest);
  }
  const result = await withTransaction((c) => postTransactionWith(c, rest));
  if (io) {
    const payload = {
      bankAccountId: result.accountId,
      bankName: result.bankName,
      newBalance: result.balanceAfter,
      delta: result.delta,
      transactionType: rest.transactionType,
      changedBy: rest.employeeId || null,
      at: new Date().toISOString(),
    };
    io.to('role:Manager').emit('bank_balance_updated', payload);
    io.to('role:Admin').emit('bank_balance_updated', payload);
  }
  return result;
}

async function recordBankIn(params) {
  return recordBank({ ...params, direction: 'in' });
}

async function recordBankOut(params) {
  return recordBank({ ...params, direction: 'out' });
}

// =======================================================================
// CRUD
// =======================================================================
async function listAccounts({ includeInactive = false } = {}) {
  const { rows } = await query(
    `SELECT b.*, u.username AS created_by_username,
            (SELECT MAX(t.timestamp) FROM bank_transactions t WHERE t.bank_account_id = b.id) AS last_activity_at
       FROM bank_accounts b
       LEFT JOIN users u ON u.id = b.created_by
      ${includeInactive ? '' : 'WHERE b.is_active = true'}
      ORDER BY b.is_default DESC, b.bank_name ASC`,
  );
  return rows.map((r) => shapeAccount(r, { lastActivityAt: r.last_activity_at }));
}

async function getAccount(id) {
  const { rows } = await query(
    `SELECT b.*, u.username AS created_by_username
       FROM bank_accounts b
       LEFT JOIN users u ON u.id = b.created_by
      WHERE b.id = $1`,
    [id],
  );
  if (!rows.length) {
    throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, {
      status: 404,
    });
  }
  return shapeAccount(rows[0]);
}

async function createAccount(body, employeeId) {
  return withTransaction(async (client) => {
    if (body.isDefault) {
      // Only one default allowed — flip the others off first.
      await client.query(
        `UPDATE bank_accounts SET is_default = false WHERE is_default = true`,
      );
    }
    const opening = money(body.openingBalance || 0);
    const { rows } = await client.query(
      `INSERT INTO bank_accounts
         (bank_name, account_name, account_number, iban, currency,
          opening_balance, current_balance, is_active, is_default,
          notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$6,$7,$8,$9,$10)
       RETURNING *`,
      [
        body.bankName,
        body.accountName,
        body.accountNumber || null,
        body.iban || null,
        body.currency || 'AED',
        opening,
        body.isActive !== false,
        !!body.isDefault,
        body.notes || null,
        employeeId,
      ],
    );
    const account = rows[0];

    if (opening > 0) {
      // Capture the opening balance as a synthetic deposit so the ledger
      // history is self-consistent.
      await client.query(
        `INSERT INTO bank_transactions
           (bank_account_id, transaction_type, direction, amount,
            balance_before, balance_after, employee_id, description, notes)
         VALUES ($1,'manual_deposit','in',$2,0,$2,$3,$4,$5)`,
        [
          account.id,
          opening,
          employeeId,
          'Opening balance',
          'Recorded automatically on account creation',
        ],
      );
    }

    await logActivity({
      entityType: 'bank_account',
      entityId: account.id,
      action: 'bank_account.created',
      performedBy: employeeId,
      newValue: { bankName: account.bank_name, opening },
    });

    return account;
  }).then((row) => shapeAccount(row));
}

async function updateAccount(id, body, employeeId) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM bank_accounts WHERE id = $1 FOR UPDATE`,
      [id],
    );
    if (!rows.length) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, {
        status: 404,
      });
    }
    if (body.isDefault) {
      await client.query(
        `UPDATE bank_accounts SET is_default = false WHERE is_default = true AND id <> $1`,
        [id],
      );
    }
    const fields = [];
    const params = [];
    let i = 1;
    const set = (k, v) => {
      fields.push(`${k} = $${i++}`);
      params.push(v);
    };
    if (body.bankName !== undefined) set('bank_name', body.bankName);
    if (body.accountName !== undefined) set('account_name', body.accountName);
    if (body.accountNumber !== undefined) set('account_number', body.accountNumber);
    if (body.iban !== undefined) set('iban', body.iban);
    if (body.currency !== undefined) set('currency', body.currency);
    if (body.isActive !== undefined) set('is_active', !!body.isActive);
    if (body.isDefault !== undefined) set('is_default', !!body.isDefault);
    if (body.notes !== undefined) set('notes', body.notes);
    fields.push(`updated_at = NOW()`);
    params.push(id);

    const { rows: upd } = await client.query(
      `UPDATE bank_accounts SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`,
      params,
    );

    await logActivity({
      entityType: 'bank_account',
      entityId: id,
      action: 'bank_account.updated',
      performedBy: employeeId,
      newValue: body,
    });
    return upd[0];
  }).then((row) => shapeAccount(row));
}

async function deactivateAccount(id, employeeId) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM bank_accounts WHERE id = $1 FOR UPDATE`,
      [id],
    );
    if (!rows.length) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, {
        status: 404,
      });
    }
    if (Math.abs(Number(rows[0].current_balance)) > 0.001) {
      throw new AppError(ERROR_CODES.BIZ_BANK_HAS_BALANCE, undefined, {
        status: 409,
      });
    }
    await client.query(
      `UPDATE bank_accounts
          SET is_active = false,
              is_default = false,
              updated_at = NOW()
        WHERE id = $1`,
      [id],
    );
    await logActivity({
      entityType: 'bank_account',
      entityId: id,
      action: 'bank_account.deactivated',
      performedBy: employeeId,
    });
    return { id };
  });
}

async function listTransactions({
  bankAccountId = null,
  limit = 25,
  offset = 0,
  type = null,
  direction = null,
  from = null,
  to = null,
}) {
  const parts = [];
  const params = [];
  let i = 1;
  if (bankAccountId) {
    parts.push(`t.bank_account_id = $${i++}`);
    params.push(bankAccountId);
  }
  if (type) {
    parts.push(`t.transaction_type = $${i++}`);
    params.push(type);
  }
  if (direction) {
    parts.push(`t.direction = $${i++}`);
    params.push(direction);
  }
  if (from) {
    parts.push(`t.transaction_date >= $${i++}`);
    params.push(from);
  }
  if (to) {
    parts.push(`t.transaction_date <= $${i++}`);
    params.push(to);
  }
  const where = parts.length ? `WHERE ${parts.join(' AND ')}` : '';

  const { rows } = await query(
    `SELECT t.*, b.bank_name, b.account_name, u.username AS employee_username
       FROM bank_transactions t
       LEFT JOIN bank_accounts b ON b.id = t.bank_account_id
       LEFT JOIN users u ON u.id = t.employee_id
       ${where}
       ORDER BY t.timestamp DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset],
  );
  const { rows: totals } = await query(
    `SELECT COUNT(*)::int AS total FROM bank_transactions t ${where}`,
    params,
  );
  return { rows: rows.map(shapeTransaction), total: totals[0].total };
}

module.exports = {
  // posting
  recordBankIn,
  recordBankOut,
  postTransactionWith,
  // CRUD
  listAccounts,
  getAccount,
  createAccount,
  updateAccount,
  deactivateAccount,
  listTransactions,
  // shapers
  shapeAccount,
  shapeTransaction,
};
