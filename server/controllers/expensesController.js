const { z } = require('zod');
const { ok, created, parsePagination } = require('../utils/response');
const { AppError, ERROR_CODES } = require('../../shared/errorCodes');
const expenseService = require('../services/expenseService');
const { saveExpenseReceipt } = require('../utils/upload');

function zodFail(err) {
  return new AppError(
    ERROR_CODES.VALIDATION_FAILED,
    err.errors[0]?.message || 'Invalid request.',
    { status: 400, details: err.errors },
  );
}

const listSchema = z.object({
  categoryId: z.string().uuid().optional(),
  paymentMethod: z.enum(['cash', 'bank']).optional(),
  search: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

async function list(req, res, next) {
  try {
    const filters = listSchema.parse(req.query || {});
    const { limit, offset, page } = parsePagination(req, { defaultLimit: 50 });
    const result = await expenseService.listExpenses({
      ...filters,
      limit,
      offset,
    });
    return ok(res, result.rows, {
      page,
      limit,
      total: result.total,
      totalAmount: result.totalAmount,
    });
  } catch (err) {
    if (err instanceof z.ZodError) return next(zodFail(err));
    next(err);
  }
}

const createSchema = z.object({
  categoryId: z.string().uuid().nullable().optional(),
  description: z.string().min(1).max(500),
  amount: z.coerce.number().positive(),
  expenseDate: z.string().optional(),
  paymentMethod: z.enum(['cash', 'bank']),
  bankAccountId: z.string().uuid().nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
});

async function create(req, res, next) {
  try {
    const body = createSchema.parse(req.body || {});
    const io = req.app.get('io');
    const expense = await expenseService.createExpense({
      ...body,
      userId: req.user.id,
      io,
    });

    // Optional receipt file under the same multipart request.
    if (req.file) {
      const saved = await saveExpenseReceipt({
        expenseId: expense.id,
        file: req.file,
      });
      await expenseService.setExpenseReceipt(expense.id, saved.relativePath);
      expense.receiptAttachment = saved.relativePath;
    }

    return created(res, expense);
  } catch (err) {
    if (err instanceof z.ZodError) return next(zodFail(err));
    next(err);
  }
}

async function detail(req, res, next) {
  try {
    const exp = await expenseService.getExpense(req.params.id);
    return ok(res, exp);
  } catch (err) {
    next(err);
  }
}

async function remove(req, res, next) {
  try {
    await expenseService.deleteExpense({
      id: req.params.id,
      userId: req.user.id,
    });
    return ok(res, { deleted: true });
  } catch (err) {
    next(err);
  }
}

async function summary(req, res, next) {
  try {
    const month = req.query.month ? Number(req.query.month) : null;
    const year = req.query.year ? Number(req.query.year) : null;
    const data = await expenseService.summary({ month, year });
    return ok(res, data);
  } catch (err) {
    next(err);
  }
}

async function uploadReceipt(req, res, next) {
  try {
    if (!req.file) {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'No file uploaded.');
    }
    const saved = await saveExpenseReceipt({
      expenseId: req.params.id,
      file: req.file,
    });
    await expenseService.setExpenseReceipt(req.params.id, saved.relativePath);
    return ok(res, { receiptAttachment: saved.relativePath });
  } catch (err) {
    next(err);
  }
}

module.exports = { list, create, detail, remove, summary, uploadReceipt };
