const { z } = require('zod');
const { ok, created, parsePagination } = require('../utils/response');
const { AppError, ERROR_CODES } = require('../../shared/errorCodes');
const journalService = require('../services/journalService');
const reports = require('../services/financialReportService');

function zodFail(err) {
  return new AppError(
    ERROR_CODES.VALIDATION_FAILED,
    err.errors[0]?.message || 'Invalid request.',
    { status: 400, details: err.errors },
  );
}

// =======================================================================
// Reports
// =======================================================================
const periodQuery = z.object({
  start_date: z.string(),
  end_date: z.string(),
  compare: z
    .union([z.literal('true'), z.literal('false'), z.boolean()])
    .optional(),
});

async function pl(req, res, next) {
  try {
    const q = periodQuery.parse(req.query || {});
    const compare = q.compare === true || q.compare === 'true';
    const result = await reports.getProfitAndLoss({
      startDate: q.start_date,
      endDate: q.end_date,
      compare,
    });
    return ok(res, result);
  } catch (err) {
    if (err instanceof z.ZodError) return next(zodFail(err));
    next(err);
  }
}

async function balanceSheet(req, res, next) {
  try {
    const q = z.object({ as_of_date: z.string() }).parse(req.query || {});
    const result = await reports.getBalanceSheet({ asOfDate: q.as_of_date });
    return ok(res, result);
  } catch (err) {
    if (err instanceof z.ZodError) return next(zodFail(err));
    next(err);
  }
}

async function cashFlow(req, res, next) {
  try {
    const q = z
      .object({ start_date: z.string(), end_date: z.string() })
      .parse(req.query || {});
    const result = await reports.getCashFlowStatement({
      startDate: q.start_date,
      endDate: q.end_date,
    });
    return ok(res, result);
  } catch (err) {
    if (err instanceof z.ZodError) return next(zodFail(err));
    next(err);
  }
}

async function vat(req, res, next) {
  try {
    const q = z
      .object({ start_date: z.string(), end_date: z.string() })
      .parse(req.query || {});
    const result = await reports.getVATReport({
      startDate: q.start_date,
      endDate: q.end_date,
    });
    return ok(res, result);
  } catch (err) {
    if (err instanceof z.ZodError) return next(zodFail(err));
    next(err);
  }
}

async function dashboard(req, res, next) {
  try {
    const result = await reports.getDashboardSnapshot();
    return ok(res, result);
  } catch (err) {
    next(err);
  }
}

// =======================================================================
// Journal
// =======================================================================
const journalQuery = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  referenceType: z.string().optional(),
  accountId: z.string().uuid().optional(),
  isManual: z.union([z.literal('true'), z.literal('false')]).optional(),
});

async function listJournal(req, res, next) {
  try {
    const filters = journalQuery.parse(req.query || {});
    const { limit, offset, page } = parsePagination(req);
    const result = await journalService.listEntries({
      from: filters.from || null,
      to: filters.to || null,
      referenceType: filters.referenceType || null,
      accountId: filters.accountId || null,
      isManual:
        filters.isManual === undefined
          ? null
          : filters.isManual === 'true',
      limit,
      offset,
    });
    return ok(res, result.rows, { page, limit, total: result.total });
  } catch (err) {
    if (err instanceof z.ZodError) return next(zodFail(err));
    next(err);
  }
}

async function getJournalEntry(req, res, next) {
  try {
    const entry = await journalService.getEntry(req.params.id);
    return ok(res, entry);
  } catch (err) {
    next(err);
  }
}

const manualEntrySchema = z.object({
  date: z.string(),
  description: z.string().min(3).max(500),
  referenceType: z.string().max(50).optional(),
  referenceId: z.string().uuid().optional(),
  lines: z
    .array(
      z.object({
        accountId: z.string().uuid(),
        debit: z.number().nonnegative().optional(),
        credit: z.number().nonnegative().optional(),
        notes: z.string().max(300).optional(),
      }),
    )
    .min(2),
});

async function postManualEntry(req, res, next) {
  try {
    const body = manualEntrySchema.parse(req.body || {});
    const result = await journalService.postJournalEntry({
      date: body.date,
      description: body.description,
      referenceType: body.referenceType || 'manual',
      referenceId: body.referenceId || null,
      lines: body.lines.map((l) => ({
        accountId: l.accountId,
        debit: l.debit || 0,
        credit: l.credit || 0,
        notes: l.notes || null,
      })),
      isManual: true,
      userId: req.user?.id || null,
    });
    return created(res, await journalService.getEntry(result.entry.id));
  } catch (err) {
    if (err instanceof z.ZodError) return next(zodFail(err));
    next(err);
  }
}

// =======================================================================
// Chart of accounts
// =======================================================================
async function listAccounts(_req, res, next) {
  try {
    const rows = await journalService.listAccounts();
    return ok(res, rows);
  } catch (err) {
    next(err);
  }
}

const accountSchema = z.object({
  code: z.string().min(1).max(20),
  name: z.string().min(1).max(200),
  type: z.enum(['asset', 'liability', 'equity', 'revenue', 'expense']),
  parentId: z.string().uuid().nullable().optional(),
  description: z.string().max(500).optional(),
});

async function addAccount(req, res, next) {
  try {
    const body = accountSchema.parse(req.body || {});
    const row = await journalService.addAccount({
      ...body,
      parentId: body.parentId || null,
      description: body.description || null,
      userId: req.user?.id || null,
    });
    return created(res, row);
  } catch (err) {
    if (err instanceof z.ZodError) return next(zodFail(err));
    next(err);
  }
}

async function updateAccount(req, res, next) {
  try {
    const body = z
      .object({
        name: z.string().min(1).max(200).optional(),
        description: z.string().max(500).optional(),
        isActive: z.boolean().optional(),
      })
      .parse(req.body || {});
    const row = await journalService.updateAccount({
      id: req.params.id,
      ...body,
      userId: req.user?.id || null,
    });
    return ok(res, row);
  } catch (err) {
    if (err instanceof z.ZodError) return next(zodFail(err));
    next(err);
  }
}

async function deleteAccount(req, res, next) {
  try {
    await journalService.deleteAccount({
      id: req.params.id,
      userId: req.user?.id || null,
    });
    return ok(res, { deleted: true });
  } catch (err) {
    next(err);
  }
}

// =======================================================================
// Periods
// =======================================================================
async function listPeriods(req, res, next) {
  try {
    const q = z
      .object({ status: z.enum(['open', 'closed']).optional() })
      .parse(req.query || {});
    const rows = await journalService.listPeriods({ status: q.status || null });
    return ok(res, rows);
  } catch (err) {
    if (err instanceof z.ZodError) return next(zodFail(err));
    next(err);
  }
}

async function periodChecklist(req, res, next) {
  try {
    const { rows } = await require('../db/postgres').query(
      `SELECT * FROM financial_periods WHERE id = $1`,
      [req.params.id],
    );
    if (!rows.length) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, { status: 404 });
    }
    const checklist = await journalService.periodCloseChecklist(rows[0]);
    return ok(res, { period: { id: rows[0].id, name: rows[0].name }, checklist });
  } catch (err) {
    next(err);
  }
}

async function closePeriod(req, res, next) {
  try {
    const body = z
      .object({
        force: z.boolean().optional(),
        notes: z.string().max(500).optional(),
      })
      .parse(req.body || {});
    const row = await journalService.closePeriod({
      periodId: req.params.id,
      userId: req.user?.id || null,
      force: body.force || false,
      notes: body.notes || null,
    });
    return ok(res, row);
  } catch (err) {
    if (err instanceof z.ZodError) return next(zodFail(err));
    next(err);
  }
}

module.exports = {
  // Reports
  pl,
  balanceSheet,
  cashFlow,
  vat,
  dashboard,
  // Journal
  listJournal,
  getJournalEntry,
  postManualEntry,
  // Accounts
  listAccounts,
  addAccount,
  updateAccount,
  deleteAccount,
  // Periods
  listPeriods,
  periodChecklist,
  closePeriod,
};
