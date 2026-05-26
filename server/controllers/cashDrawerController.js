const { z } = require('zod');
const { query, withTransaction } = require('../db/postgres');
const { ok, created, parsePagination } = require('../utils/response');
const { AppError, ERROR_CODES } = require('../../shared/errorCodes');
const { logActivity } = require('../utils/activityLog');
const cashService = require('../services/cashService');
const { postTransactionWith: postBankWith } = require('../services/bankService');

async function getState(_req, res, next) {
  try {
    const state = await cashService.getDrawerState();
    return ok(res, state);
  } catch (err) {
    next(err);
  }
}

const openSchema = z.object({
  openingBalance: z.number().nonnegative(),
  notes: z.string().max(2000).optional().nullable(),
});

async function open(req, res, next) {
  try {
    const body = openSchema.parse(req.body || {});
    const io = req.app.get('io');
    await cashService.openDrawer({
      openingBalance: body.openingBalance,
      employeeId: req.user.id,
      notes: body.notes || null,
      io,
    });
    const state = await cashService.getDrawerState();
    return created(res, state);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return next(
        new AppError(
          ERROR_CODES.VALIDATION_FAILED,
          err.errors[0]?.message || 'Invalid request.',
          { status: 400, details: err.errors },
        ),
      );
    }
    next(err);
  }
}

const closeSchema = z.object({
  closingBalance: z.number().nonnegative(),
  notes: z.string().max(2000).optional().nullable(),
  force: z.boolean().optional().default(false),
});

async function close(req, res, next) {
  try {
    const body = closeSchema.parse(req.body || {});
    const io = req.app.get('io');
    const result = await cashService.closeDrawer({
      closingBalance: body.closingBalance,
      employeeId: req.user.id,
      notes: body.notes || null,
      force: body.force,
      io,
    });
    const state = await cashService.getDrawerState();
    return ok(res, {
      state,
      reconciliation: {
        sessionId: result.session.id,
        expectedBalance: result.expected,
        countedBalance: result.counted,
        discrepancy: result.discrepancy,
      },
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return next(
        new AppError(
          ERROR_CODES.VALIDATION_FAILED,
          err.errors[0]?.message || 'Invalid request.',
          { status: 400, details: err.errors },
        ),
      );
    }
    next(err);
  }
}

const adjustSchema = z.object({
  amount: z.number().positive(),
  direction: z.enum(['in', 'out']),
  reason: z.string().min(3).max(2000),
});

async function adjust(req, res, next) {
  try {
    const body = adjustSchema.parse(req.body || {});
    const io = req.app.get('io');
    await cashService.recordManualAdjustment({
      amount: body.amount,
      direction: body.direction,
      reason: body.reason,
      employeeId: req.user.id,
      io,
    });
    const state = await cashService.getDrawerState();
    return ok(res, state);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return next(
        new AppError(
          ERROR_CODES.VALIDATION_FAILED,
          err.errors[0]?.message || 'Invalid request.',
          { status: 400, details: err.errors },
        ),
      );
    }
    next(err);
  }
}

async function listTransactions(req, res, next) {
  try {
    const { limit, offset, page } = parsePagination(req);
    const parts = [];
    const params = [];
    let i = 1;
    if (req.query.type) {
      parts.push(`t.transaction_type = $${i++}`);
      params.push(req.query.type);
    }
    if (req.query.direction) {
      parts.push(`t.direction = $${i++}`);
      params.push(req.query.direction);
    }
    if (req.query.session_id) {
      parts.push(`t.session_id = $${i++}`);
      params.push(req.query.session_id);
    }
    if (req.query.from) {
      parts.push(`t.timestamp >= $${i++}`);
      params.push(req.query.from);
    }
    if (req.query.to) {
      parts.push(`t.timestamp <= $${i++}`);
      params.push(req.query.to);
    }
    const where = parts.length ? `WHERE ${parts.join(' AND ')}` : '';

    const { rows } = await query(
      `SELECT t.*, u.username AS employee_username
         FROM cash_drawer_transactions t
         LEFT JOIN users u ON u.id = t.employee_id
         ${where}
         ORDER BY t.timestamp DESC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset],
    );
    const { rows: totals } = await query(
      `SELECT COUNT(*)::int AS total FROM cash_drawer_transactions t ${where}`,
      params,
    );
    return ok(res, rows.map(cashService.shapeTransaction), {
      total: totals[0].total,
      page,
      limit,
    });
  } catch (err) {
    next(err);
  }
}

async function listSessions(req, res, next) {
  try {
    const { limit, offset, page } = parsePagination(req);
    const { rows } = await query(
      `SELECT s.*, ou.username AS opened_by_username,
              cu.username AS closed_by_username
         FROM cash_drawer_sessions s
         LEFT JOIN users ou ON ou.id = s.opened_by
         LEFT JOIN users cu ON cu.id = s.closed_by
        ORDER BY s.opened_at DESC
        LIMIT $1 OFFSET $2`,
      [limit, offset],
    );
    const { rows: totals } = await query(
      `SELECT COUNT(*)::int AS total FROM cash_drawer_sessions`,
    );
    return ok(res, rows.map(cashService.shapeSession), {
      total: totals[0].total,
      page,
      limit,
    });
  } catch (err) {
    next(err);
  }
}

async function getSession(req, res, next) {
  try {
    const summary = await cashService.sessionSummary(req.params.id);
    const transactions = await cashService.listSessionTransactions(req.params.id, {
      limit: 500,
    });
    return ok(res, { ...summary, transactions });
  } catch (err) {
    next(err);
  }
}

const transferSchema = z.object({
  toType: z.enum(['bank_account']),
  toId: z.string().uuid(),
  amount: z.number().positive(),
  transferDate: z.string().optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});

// Cash → Bank transfer. Bank → Cash uses the bank route's /transfer endpoint.
async function transferToBank(req, res, next) {
  try {
    const body = transferSchema.parse(req.body || {});
    const io = req.app.get('io');
    const result = await withTransaction(async (client) => {
      // Pull out cash first.
      const out = await cashService.postTransactionWith(client, {
        transactionType: 'transfer',
        direction: 'out',
        amount: body.amount,
        referenceType: 'bank_account',
        referenceId: body.toId,
        employeeId: req.user.id,
        notes: body.notes || 'Transfer to bank',
        allowAutoOpen: true,
      });
      // Deposit into the chosen bank account.
      const inn = await postBankWith(client, {
        bankAccountId: body.toId,
        transactionType: 'transfer',
        direction: 'in',
        amount: body.amount,
        referenceType: 'cash_drawer',
        referenceId: out.drawerId,
        employeeId: req.user.id,
        transactionDate: body.transferDate || null,
        description: body.notes || 'Transfer from cash drawer',
        notes: body.notes || null,
      });
      const { rows: transferRows } = await client.query(
        `INSERT INTO cash_transfers
           (from_type, from_id, to_type, to_id, amount, transfer_date, employee_id, notes)
         VALUES ('cash_drawer',$1,'bank_account',$2,$3,$4,$5,$6)
         RETURNING *`,
        [
          out.drawerId,
          body.toId,
          body.amount,
          body.transferDate || new Date().toISOString().slice(0, 10),
          req.user.id,
          body.notes || null,
        ],
      );
      return { out, in: inn, transfer: transferRows[0] };
    });
    await logActivity({
      entityType: 'cash_transfer',
      entityId: result.transfer.id,
      action: 'treasury.transfer',
      performedBy: req.user.id,
      newValue: {
        from: 'cash_drawer',
        to: 'bank_account',
        amount: body.amount,
        toId: body.toId,
      },
      notes: body.notes,
    });
    if (io) {
      const at = new Date().toISOString();
      io.to('role:Manager').emit('cash_balance_updated', {
        newBalance: result.out.balanceAfter,
        delta: result.out.delta,
        transactionType: 'transfer',
        changedBy: req.user.id,
        at,
      });
      io.to('role:Manager').emit('bank_balance_updated', {
        bankAccountId: result.in.accountId,
        bankName: result.in.bankName,
        newBalance: result.in.balanceAfter,
        delta: result.in.delta,
        transactionType: 'transfer',
        changedBy: req.user.id,
        at,
      });
    }
    const state = await cashService.getDrawerState();
    return created(res, { state, transferId: result.transfer.id });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return next(
        new AppError(
          ERROR_CODES.VALIDATION_FAILED,
          err.errors[0]?.message || 'Invalid request.',
          { status: 400, details: err.errors },
        ),
      );
    }
    next(err);
  }
}

async function listTransfers(req, res, next) {
  try {
    const { limit, offset, page } = parsePagination(req);
    const { rows } = await query(
      `SELECT t.*, u.username AS employee_username
         FROM cash_transfers t
         LEFT JOIN users u ON u.id = t.employee_id
        ORDER BY t.transfer_date DESC, t.created_at DESC
        LIMIT $1 OFFSET $2`,
      [limit, offset],
    );
    const { rows: totals } = await query(
      `SELECT COUNT(*)::int AS total FROM cash_transfers`,
    );

    // Annotate from/to with human-readable labels.
    const accountIds = new Set();
    const drawerIds = new Set();
    for (const r of rows) {
      if (r.from_type === 'bank_account') accountIds.add(r.from_id);
      else if (r.from_type === 'cash_drawer') drawerIds.add(r.from_id);
      if (r.to_type === 'bank_account') accountIds.add(r.to_id);
      else if (r.to_type === 'cash_drawer') drawerIds.add(r.to_id);
    }
    const accountLabels = new Map();
    if (accountIds.size) {
      const { rows: accRows } = await query(
        `SELECT id, bank_name, account_name FROM bank_accounts WHERE id = ANY($1)`,
        [[...accountIds]],
      );
      for (const a of accRows)
        accountLabels.set(a.id, `${a.bank_name} (${a.account_name})`);
    }
    const drawerLabels = new Map();
    if (drawerIds.size) {
      const { rows: drwRows } = await query(
        `SELECT id, name FROM cash_drawer WHERE id = ANY($1)`,
        [[...drawerIds]],
      );
      for (const d of drwRows) drawerLabels.set(d.id, d.name);
    }
    function labelFor(type, id) {
      if (type === 'bank_account') return accountLabels.get(id) || 'Bank';
      if (type === 'cash_drawer') return drawerLabels.get(id) || 'Cash drawer';
      return type;
    }

    return ok(
      res,
      rows.map((r) => ({
        id: r.id,
        fromType: r.from_type,
        fromId: r.from_id,
        fromLabel: labelFor(r.from_type, r.from_id),
        toType: r.to_type,
        toId: r.to_id,
        toLabel: labelFor(r.to_type, r.to_id),
        amount: Number(r.amount),
        transferDate: r.transfer_date,
        employeeId: r.employee_id,
        employeeUsername: r.employee_username,
        notes: r.notes,
        createdAt: r.created_at,
      })),
      { total: totals[0].total, page, limit },
    );
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getState,
  open,
  close,
  adjust,
  listTransactions,
  listSessions,
  getSession,
  transferToBank,
  listTransfers,
};
