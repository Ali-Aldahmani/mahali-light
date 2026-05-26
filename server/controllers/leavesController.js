const { z } = require('zod');
const { ok, created, parsePagination } = require('../utils/response');
const { AppError, ERROR_CODES } = require('../../shared/errorCodes');
const leaveService = require('../services/leaveService');

function zodFail(err) {
  return new AppError(
    ERROR_CODES.VALIDATION_FAILED,
    err.errors[0]?.message || 'Invalid request.',
    { status: 400, details: err.errors },
  );
}

const listSchema = z.object({
  employeeId: z.string().uuid().optional(),
  status: z.enum(['pending', 'approved', 'rejected', 'cancelled']).optional(),
  leaveType: z.enum(['annual', 'sick', 'unpaid', 'emergency']).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

async function list(req, res, next) {
  try {
    const filters = listSchema.parse(req.query || {});
    // Scope to "own" if the caller can't view everyone. Managers and admins
    // (attendance.view_all) see whatever filter they pass.
    const perms = req.user?.permissions || [];
    if (!perms.includes('attendance.view_all')) {
      filters.employeeId = req.user.employee_id || '__none__';
    }
    const { limit, offset, page } = parsePagination(req);
    const { rows, total } = await leaveService.listLeaves({
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

const submitSchema = z.object({
  employeeId: z.string().uuid(),
  leaveType: z.enum(['annual', 'sick', 'unpaid', 'emergency']),
  startDate: z.string(),
  endDate: z.string(),
  reason: z.string().min(5).max(1000),
});

async function submit(req, res, next) {
  try {
    const body = submitSchema.parse(req.body || {});
    // Only managers/admins (view_all) can submit a leave on behalf of others.
    const perms = req.user?.permissions || [];
    if (
      !perms.includes('attendance.view_all') &&
      body.employeeId !== req.user.employee_id
    ) {
      throw new AppError(
        ERROR_CODES.AUTH_NO_PERMISSION,
        'You can only submit leave for yourself.',
        { status: 403 },
      );
    }
    const io = req.app.get('io');
    const leave = await leaveService.submitLeave({
      ...body,
      requestedBy: req.user.id,
      io,
    });
    return created(res, leave);
  } catch (err) {
    if (err instanceof z.ZodError) return next(zodFail(err));
    next(err);
  }
}

async function detail(req, res, next) {
  try {
    const leave = await leaveService.getLeave(req.params.id);
    return ok(res, leave);
  } catch (err) {
    next(err);
  }
}

async function approve(req, res, next) {
  try {
    const io = req.app.get('io');
    const leave = await leaveService.approveLeave({
      leaveId: req.params.id,
      managerId: req.user.id,
      io,
    });
    return ok(res, leave);
  } catch (err) {
    next(err);
  }
}

const rejectSchema = z.object({
  rejectionReason: z.string().min(3).max(500),
});

async function reject(req, res, next) {
  try {
    const body = rejectSchema.parse(req.body || {});
    const io = req.app.get('io');
    const leave = await leaveService.rejectLeave({
      leaveId: req.params.id,
      managerId: req.user.id,
      reason: body.rejectionReason,
      io,
    });
    return ok(res, leave);
  } catch (err) {
    if (err instanceof z.ZodError) return next(zodFail(err));
    next(err);
  }
}

async function cancel(req, res, next) {
  try {
    const io = req.app.get('io');
    const leave = await leaveService.cancelLeave({
      leaveId: req.params.id,
      requesterId: req.user.id,
      io,
    });
    return ok(res, leave);
  } catch (err) {
    next(err);
  }
}

const calcSchema = z.object({
  startDate: z.string(),
  endDate: z.string(),
});

async function calculateDays(req, res, next) {
  try {
    const { startDate, endDate } = calcSchema.parse(req.query || {});
    const days = await leaveService.calculateWorkingDays(startDate, endDate);
    return ok(res, { startDate, endDate, workingDays: days });
  } catch (err) {
    if (err instanceof z.ZodError) return next(zodFail(err));
    next(err);
  }
}

module.exports = {
  list,
  submit,
  detail,
  approve,
  reject,
  cancel,
  calculateDays,
};
