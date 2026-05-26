const { z } = require('zod');
const { ok, created, parsePagination } = require('../utils/response');
const { AppError, ERROR_CODES } = require('../../shared/errorCodes');
const billService = require('../services/billService');

function zodFail(err) {
  return new AppError(
    ERROR_CODES.VALIDATION_FAILED,
    err.errors[0]?.message || 'Invalid request.',
    { status: 400, details: err.errors },
  );
}

const listSchema = z.object({
  status: z.enum(['active', 'paused', 'cancelled']).optional(),
  frequency: z.enum(['monthly', 'quarterly', 'yearly']).optional(),
  categoryId: z.string().uuid().optional(),
});

async function list(req, res, next) {
  try {
    const filters = listSchema.parse(req.query || {});
    const { limit, offset, page } = parsePagination(req);
    const rows = await billService.listBills({ ...filters, limit, offset });
    return ok(res, rows, { page, limit });
  } catch (err) {
    if (err instanceof z.ZodError) return next(zodFail(err));
    next(err);
  }
}

const createSchema = z.object({
  name: z.string().min(1).max(200),
  categoryId: z.string().uuid().nullable().optional(),
  vendorName: z.string().max(200).nullable().optional(),
  amount: z.number().nonnegative().optional(),
  isVariableAmount: z.boolean().optional(),
  frequency: z.enum(['monthly', 'quarterly', 'yearly']),
  startDate: z.string(),
  firstDueDate: z.string().optional(),
  reminderDaysBefore: z.number().int().min(0).max(60).optional(),
  paymentMethod: z.enum(['cash', 'bank']).optional(),
  bankAccountId: z.string().uuid().nullable().optional(),
  autoRecurring: z.boolean().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

async function create(req, res, next) {
  try {
    const body = createSchema.parse(req.body || {});
    const bill = await billService.createBill(body, req.user.id);
    return created(res, bill);
  } catch (err) {
    if (err instanceof z.ZodError) return next(zodFail(err));
    next(err);
  }
}

async function detail(req, res, next) {
  try {
    const bill = await billService.getBill(req.params.id);
    return ok(res, bill);
  } catch (err) {
    next(err);
  }
}

const updateSchema = createSchema.partial().extend({
  nextDueDate: z.string().optional(),
});

async function update(req, res, next) {
  try {
    const body = updateSchema.parse(req.body || {});
    const bill = await billService.updateBill(req.params.id, body, req.user.id);
    return ok(res, bill);
  } catch (err) {
    if (err instanceof z.ZodError) return next(zodFail(err));
    next(err);
  }
}

async function cancel(req, res, next) {
  try {
    const bill = await billService.setStatus({
      id: req.params.id,
      status: 'cancelled',
      userId: req.user.id,
    });
    return ok(res, bill);
  } catch (err) {
    next(err);
  }
}

async function pause(req, res, next) {
  try {
    const bill = await billService.setStatus({
      id: req.params.id,
      status: 'paused',
      userId: req.user.id,
    });
    return ok(res, bill);
  } catch (err) {
    next(err);
  }
}

async function resume(req, res, next) {
  try {
    const bill = await billService.setStatus({
      id: req.params.id,
      status: 'active',
      userId: req.user.id,
    });
    return ok(res, bill);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  list,
  create,
  detail,
  update,
  cancel,
  pause,
  resume,
};
