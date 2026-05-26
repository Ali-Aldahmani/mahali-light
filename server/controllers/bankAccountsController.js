const { z } = require('zod');
const { withTransaction } = require('../db/postgres');
const { ok, created, parsePagination } = require('../utils/response');
const { AppError, ERROR_CODES } = require('../../shared/errorCodes');
const { logActivity } = require('../utils/activityLog');
const bankService = require('../services/bankService');
const cashService = require('../services/cashService');

const createSchema = z.object({
  bankName: z.string().min(1).max(100),
  accountName: z.string().min(1).max(200),
  accountNumber: z.string().max(50).optional().nullable(),
  iban: z.string().max(50).optional().nullable(),
  currency: z.string().max(10).optional().default('AED'),
  openingBalance: z.number().nonnegative().optional().default(0),
  isActive: z.boolean().optional().default(true),
  isDefault: z.boolean().optional().default(false),
  notes: z.string().max(2000).optional().nullable(),
});

const updateSchema = createSchema.partial();

async function list(req, res, next) {
  try {
    const accounts = await bankService.listAccounts({
      includeInactive: req.query.include_inactive === 'true',
    });
    return ok(res, accounts);
  } catch (err) {
    next(err);
  }
}

async function getOne(req, res, next) {
  try {
    const account = await bankService.getAccount(req.params.id);
    return ok(res, account);
  } catch (err) {
    next(err);
  }
}

async function create(req, res, next) {
  try {
    const body = createSchema.parse(req.body || {});
    const account = await bankService.createAccount(body, req.user.id);
    return created(res, account);
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

async function update(req, res, next) {
  try {
    const body = updateSchema.parse(req.body || {});
    const account = await bankService.updateAccount(req.params.id, body, req.user.id);
    return ok(res, account);
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

async function deactivate(req, res, next) {
  try {
    await bankService.deactivateAccount(req.params.id, req.user.id);
    return ok(res, { id: req.params.id });
  } catch (err) {
    next(err);
  }
}

async function listTransactions(req, res, next) {
  try {
    const { limit, offset, page } = parsePagination(req);
    const { rows, total } = await bankService.listTransactions({
      bankAccountId: req.params.id,
      limit,
      offset,
      type: req.query.type || null,
      direction: req.query.direction || null,
      from: req.query.from || null,
      to: req.query.to || null,
    });
    return ok(res, rows, { total, page, limit });
  } catch (err) {
    next(err);
  }
}

const depositSchema = z.object({
  amount: z.number().positive(),
  transactionDate: z.string().optional().nullable(),
  description: z.string().max(500).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  referenceType: z.string().max(30).optional().nullable(),
  referenceId: z.string().uuid().optional().nullable(),
});

async function deposit(req, res, next) {
  try {
    const body = depositSchema.parse(req.body || {});
    const io = req.app.get('io');
    const result = await bankService.recordBankIn({
      bankAccountId: req.params.id,
      transactionType: 'manual_deposit',
      amount: body.amount,
      employeeId: req.user.id,
      transactionDate: body.transactionDate || null,
      description: body.description || null,
      referenceType: body.referenceType || null,
      referenceId: body.referenceId || null,
      notes: body.notes || null,
      io,
    });
    await logActivity({
      entityType: 'bank_account',
      entityId: req.params.id,
      action: 'bank_account.deposit',
      performedBy: req.user.id,
      newValue: { amount: body.amount },
      notes: body.description,
    });
    return created(res, bankService.shapeTransaction(result.transaction));
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

const withdrawalSchema = depositSchema.extend({
  allowOverdraft: z.boolean().optional().default(false),
});

async function withdrawal(req, res, next) {
  try {
    const body = withdrawalSchema.parse(req.body || {});
    const io = req.app.get('io');
    const result = await bankService.recordBankOut({
      bankAccountId: req.params.id,
      transactionType: 'manual_withdrawal',
      amount: body.amount,
      employeeId: req.user.id,
      transactionDate: body.transactionDate || null,
      description: body.description || null,
      referenceType: body.referenceType || null,
      referenceId: body.referenceId || null,
      notes: body.notes || null,
      allowOverdraft: body.allowOverdraft,
      io,
    });
    await logActivity({
      entityType: 'bank_account',
      entityId: req.params.id,
      action: 'bank_account.withdrawal',
      performedBy: req.user.id,
      newValue: { amount: body.amount },
      notes: body.description,
    });
    return created(res, bankService.shapeTransaction(result.transaction));
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

const transferSchema = z.object({
  toType: z.enum(['cash_drawer', 'bank_account']),
  toId: z.string().uuid().optional().nullable(),
  amount: z.number().positive(),
  transferDate: z.string().optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  allowOverdraft: z.boolean().optional().default(false),
});

async function transfer(req, res, next) {
  try {
    const body = transferSchema.parse(req.body || {});
    const io = req.app.get('io');
    const fromId = req.params.id;
    if (body.toType === 'bank_account' && body.toId === fromId) {
      throw new AppError(ERROR_CODES.BIZ_TRANSFER_SAME_ACCOUNT, undefined, {
        status: 409,
      });
    }
    const result = await withTransaction(async (client) => {
      const out = await bankService.postTransactionWith(client, {
        bankAccountId: fromId,
        transactionType: 'transfer',
        direction: 'out',
        amount: body.amount,
        referenceType: body.toType,
        referenceId: body.toId || null,
        employeeId: req.user.id,
        transactionDate: body.transferDate || null,
        description: 'Outgoing transfer',
        notes: body.notes || null,
        allowOverdraft: body.allowOverdraft,
      });
      let inn = null;
      let drawerId = null;
      if (body.toType === 'bank_account') {
        inn = await bankService.postTransactionWith(client, {
          bankAccountId: body.toId,
          transactionType: 'transfer',
          direction: 'in',
          amount: body.amount,
          referenceType: 'bank_account',
          referenceId: fromId,
          employeeId: req.user.id,
          transactionDate: body.transferDate || null,
          description: 'Incoming transfer',
          notes: body.notes || null,
        });
      } else {
        const drwState = await cashService.postTransactionWith(client, {
          transactionType: 'transfer',
          direction: 'in',
          amount: body.amount,
          referenceType: 'bank_account',
          referenceId: fromId,
          employeeId: req.user.id,
          notes: body.notes || 'Transfer from bank',
          allowAutoOpen: true,
        });
        drawerId = drwState.drawerId;
        inn = drwState;
      }
      const { rows: trRows } = await client.query(
        `INSERT INTO cash_transfers
           (from_type, from_id, to_type, to_id, amount, transfer_date, employee_id, notes)
         VALUES ('bank_account',$1,$2,$3,$4,$5,$6,$7)
         RETURNING *`,
        [
          fromId,
          body.toType,
          body.toType === 'cash_drawer' ? drawerId : body.toId,
          body.amount,
          body.transferDate || new Date().toISOString().slice(0, 10),
          req.user.id,
          body.notes || null,
        ],
      );
      return { out, in: inn, transfer: trRows[0] };
    });

    await logActivity({
      entityType: 'cash_transfer',
      entityId: result.transfer.id,
      action: 'treasury.transfer',
      performedBy: req.user.id,
      newValue: {
        from: 'bank_account',
        to: body.toType,
        amount: body.amount,
        fromId,
        toId: body.toId || null,
      },
      notes: body.notes,
    });
    if (io) {
      const at = new Date().toISOString();
      io.to('role:Manager').emit('bank_balance_updated', {
        bankAccountId: result.out.accountId,
        bankName: result.out.bankName,
        newBalance: result.out.balanceAfter,
        delta: result.out.delta,
        transactionType: 'transfer',
        changedBy: req.user.id,
        at,
      });
      if (body.toType === 'bank_account' && result.in?.accountId) {
        io.to('role:Manager').emit('bank_balance_updated', {
          bankAccountId: result.in.accountId,
          bankName: result.in.bankName,
          newBalance: result.in.balanceAfter,
          delta: result.in.delta,
          transactionType: 'transfer',
          changedBy: req.user.id,
          at,
        });
      } else {
        io.to('role:Manager').emit('cash_balance_updated', {
          newBalance: result.in.balanceAfter,
          delta: result.in.delta,
          transactionType: 'transfer',
          changedBy: req.user.id,
          at,
        });
      }
    }

    return created(res, { transferId: result.transfer.id });
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

module.exports = {
  list,
  getOne,
  create,
  update,
  deactivate,
  listTransactions,
  deposit,
  withdrawal,
  transfer,
};
