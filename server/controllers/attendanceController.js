const { z } = require('zod');
const { ok, created, parsePagination } = require('../utils/response');
const { AppError, ERROR_CODES } = require('../../shared/errorCodes');
const attendanceService = require('../services/attendanceService');

function zodFail(err) {
  return new AppError(
    ERROR_CODES.VALIDATION_FAILED,
    err.errors[0]?.message || 'Invalid request.',
    { status: 400, details: err.errors },
  );
}

const listSchema = z.object({
  employeeId: z.string().uuid().optional(),
  status: z.enum(['present', 'late', 'absent', 'half_day', 'leave']).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
});

async function list(req, res, next) {
  try {
    const filters = listSchema.parse(req.query || {});
    const { limit, offset, page } = parsePagination(req);
    const { rows, total } = await attendanceService.listAttendance({
      ...filters,
      limit,
      offset,
    });
    return ok(res, rows, { page, limit, total });
  } catch (err) {
    if (err instanceof z.ZodError) return next(zodFail(err));
    next(err);
  }
}

async function today(_req, res, next) {
  try {
    const snapshot = await attendanceService.getTodaySnapshot();
    return ok(res, snapshot);
  } catch (err) {
    next(err);
  }
}

const historySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  status: z.string().optional(),
});

async function employeeHistory(req, res, next) {
  try {
    const filters = historySchema.parse(req.query || {});
    const { limit, offset, page } = parsePagination(req);
    const { rows, total } = await attendanceService.listAttendance({
      ...filters,
      employeeId: req.params.employeeId,
      limit,
      offset,
    });
    return ok(res, rows, { page, limit, total });
  } catch (err) {
    if (err instanceof z.ZodError) return next(zodFail(err));
    next(err);
  }
}

const summarySchema = z.object({
  month: z.coerce.number().int().min(1).max(12),
  year: z.coerce.number().int().min(2000).max(2100),
});

async function employeeSummary(req, res, next) {
  try {
    const { month, year } = summarySchema.parse(req.query || {});
    const summary = await attendanceService.getEmployeeSummary({
      employeeId: req.params.employeeId,
      month,
      year,
    });
    return ok(res, summary || null);
  } catch (err) {
    if (err instanceof z.ZodError) return next(zodFail(err));
    next(err);
  }
}

const monthlySchema = z.object({
  month: z.coerce.number().int().min(1).max(12),
  year: z.coerce.number().int().min(2000).max(2100),
  employeeId: z.string().uuid().optional(),
});

async function monthlySheet(req, res, next) {
  try {
    const params = monthlySchema.parse(req.query || {});
    const sheet = await attendanceService.getMonthlySheet(params);
    return ok(res, sheet);
  } catch (err) {
    if (err instanceof z.ZodError) return next(zodFail(err));
    next(err);
  }
}

const manualSchema = z.object({
  employeeId: z.string().uuid(),
  date: z.string(),
  checkIn: z.string().nullable().optional(),
  checkOut: z.string().nullable().optional(),
  status: z.enum(['present', 'late', 'absent', 'half_day', 'leave']).optional(),
  notes: z.string().max(1000).optional().nullable(),
});

async function manualEntry(req, res, next) {
  try {
    const body = manualSchema.parse(req.body || {});
    const record = await attendanceService.upsertManualAttendance({
      ...body,
      userId: req.user.id,
    });
    return created(res, record);
  } catch (err) {
    if (err instanceof z.ZodError) return next(zodFail(err));
    next(err);
  }
}

const updateSchema = manualSchema.partial({ employeeId: true, date: true });

async function update(req, res, next) {
  try {
    const body = updateSchema.parse(req.body || {});
    // The service is upsert-by-(employee,date) so we need both. If the caller
    // omitted them, look up the existing row.
    const { query } = require('../db/postgres');
    const { rows } = await query(
      `SELECT employee_id, date FROM attendance WHERE id = $1`,
      [req.params.id],
    );
    if (!rows.length) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, { status: 404 });
    }
    const record = await attendanceService.upsertManualAttendance({
      employeeId: body.employeeId || rows[0].employee_id,
      date: body.date || rows[0].date,
      checkIn: body.checkIn ?? undefined,
      checkOut: body.checkOut ?? undefined,
      status: body.status || 'present',
      notes: body.notes ?? null,
      userId: req.user.id,
    });
    return ok(res, record);
  } catch (err) {
    if (err instanceof z.ZodError) return next(zodFail(err));
    next(err);
  }
}

// =======================================================================
// Corrections
// =======================================================================
const correctionsListSchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected']).optional(),
  employeeId: z.string().uuid().optional(),
});

async function listCorrections(req, res, next) {
  try {
    const filters = correctionsListSchema.parse(req.query || {});
    // Non-managers see only their own corrections.
    const perms = req.user?.permissions || [];
    if (!perms.includes('attendance.correction_approve')) {
      filters.employeeId = req.user.employee_id || '__none__';
    }
    const { limit, offset, page } = parsePagination(req);
    const { rows, total } = await attendanceService.listCorrections({
      ...filters,
      limit,
      offset,
    });
    return ok(res, rows, { page, limit, total });
  } catch (err) {
    if (err instanceof z.ZodError) return next(zodFail(err));
    next(err);
  }
}

const submitCorrectionSchema = z.object({
  attendanceId: z.string().uuid(),
  reason: z.enum(['forgot_checkout', 'wrong_time', 'system_error', 'other']),
  requestNote: z.string().min(5).max(1000),
  newCheckIn: z.string().nullable().optional(),
  newCheckOut: z.string().nullable().optional(),
});

async function submitCorrection(req, res, next) {
  try {
    const body = submitCorrectionSchema.parse(req.body || {});
    const io = req.app.get('io');
    const record = await attendanceService.submitCorrection({
      ...body,
      requestedBy: req.user.id,
      io,
    });
    return created(res, record);
  } catch (err) {
    if (err instanceof z.ZodError) return next(zodFail(err));
    next(err);
  }
}

async function approveCorrection(req, res, next) {
  try {
    const io = req.app.get('io');
    const result = await attendanceService.reviewCorrection({
      correctionId: req.params.id,
      decision: 'approved',
      reviewerId: req.user.id,
      io,
    });
    return ok(res, result);
  } catch (err) {
    next(err);
  }
}

const rejectCorrectionSchema = z.object({
  rejectionReason: z.string().min(3).max(500),
});

async function rejectCorrection(req, res, next) {
  try {
    const body = rejectCorrectionSchema.parse(req.body || {});
    const io = req.app.get('io');
    const result = await attendanceService.reviewCorrection({
      correctionId: req.params.id,
      decision: 'rejected',
      reviewerId: req.user.id,
      rejectionReason: body.rejectionReason,
      io,
    });
    return ok(res, result);
  } catch (err) {
    if (err instanceof z.ZodError) return next(zodFail(err));
    next(err);
  }
}

// =======================================================================
// Reports preview endpoints
// =======================================================================
async function reportMonthly(req, res, next) {
  try {
    const { month, year, employeeId } = monthlySchema.parse(req.query || {});
    const sheet = await attendanceService.getMonthlySheet({ month, year, employeeId });
    return ok(res, sheet);
  } catch (err) {
    if (err instanceof z.ZodError) return next(zodFail(err));
    next(err);
  }
}

const yearlySummarySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  employeeId: z.string().uuid().optional(),
});

async function reportSummary(req, res, next) {
  try {
    const { year, employeeId } = yearlySummarySchema.parse(req.query || {});
    const months = [];
    for (let m = 1; m <= 12; m += 1) {
      const sheet = await attendanceService.getMonthlySheet({ month: m, year, employeeId });
      months.push({ month: m, rows: sheet.rows });
    }
    return ok(res, { year, employeeId: employeeId || null, months });
  } catch (err) {
    if (err instanceof z.ZodError) return next(zodFail(err));
    next(err);
  }
}

module.exports = {
  list,
  today,
  employeeHistory,
  employeeSummary,
  monthlySheet,
  manualEntry,
  update,
  listCorrections,
  submitCorrection,
  approveCorrection,
  rejectCorrection,
  reportMonthly,
  reportSummary,
};
