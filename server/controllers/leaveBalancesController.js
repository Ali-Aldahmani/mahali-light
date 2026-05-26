const { z } = require('zod');
const { ok } = require('../utils/response');
const { AppError, ERROR_CODES } = require('../../shared/errorCodes');
const leaveService = require('../services/leaveService');

function zodFail(err) {
  return new AppError(
    ERROR_CODES.VALIDATION_FAILED,
    err.errors[0]?.message || 'Invalid request.',
    { status: 400, details: err.errors },
  );
}

const querySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100).optional(),
});

async function getBalances(req, res, next) {
  try {
    const { year } = querySchema.parse(req.query || {});
    const y = year || new Date().getFullYear();
    const balances = await leaveService.getBalances(req.params.employeeId, y);
    return ok(res, { employeeId: req.params.employeeId, year: y, balances });
  } catch (err) {
    if (err instanceof z.ZodError) return next(zodFail(err));
    next(err);
  }
}

const updateSchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  payload: z.record(
    z.object({
      entitledDays: z.number().int().min(0).max(365).optional(),
      carriedOverDays: z.number().int().min(0).max(365).optional(),
    }),
  ),
});

async function updateBalances(req, res, next) {
  try {
    const { year, payload } = updateSchema.parse(req.body || {});
    const updated = await leaveService.updateEntitlements(
      req.params.employeeId,
      year,
      payload,
      req.user.id,
    );
    return ok(res, { employeeId: req.params.employeeId, year, balances: updated });
  } catch (err) {
    if (err instanceof z.ZodError) return next(zodFail(err));
    next(err);
  }
}

const carryOverSchema = z.object({
  fromYear: z.number().int().min(2000).max(2100),
  toYear: z.number().int().min(2000).max(2100),
});

async function carryOver(req, res, next) {
  try {
    const { fromYear, toYear } = carryOverSchema.parse(req.body || {});
    const result = await leaveService.carryOverAnnual({
      fromYear,
      toYear,
      userId: req.user.id,
    });
    return ok(res, result);
  } catch (err) {
    if (err instanceof z.ZodError) return next(zodFail(err));
    next(err);
  }
}

// List all balances for a year — used by the leave-balances admin page.
async function listAll(req, res, next) {
  try {
    const { year } = querySchema.parse(req.query || {});
    const y = year || new Date().getFullYear();
    const { query } = require('../db/postgres');
    const { rows } = await query(
      `SELECT lb.*, e.name AS employee_name, e.role_title
         FROM leave_balances lb
         JOIN employees e ON e.id = lb.employee_id
        WHERE lb.year = $1 AND e.is_active = true
        ORDER BY e.name ASC, lb.leave_type ASC`,
      [y],
    );

    // Group by employee.
    const byEmployee = new Map();
    for (const r of rows) {
      if (!byEmployee.has(r.employee_id)) {
        byEmployee.set(r.employee_id, {
          employeeId: r.employee_id,
          employeeName: r.employee_name,
          roleTitle: r.role_title,
          year: y,
          balances: {},
        });
      }
      byEmployee.get(r.employee_id).balances[r.leave_type] = {
        entitledDays: r.entitled_days,
        usedDays: r.used_days,
        remainingDays: r.remaining_days,
        carriedOverDays: r.carried_over_days,
      };
    }

    return ok(res, { year: y, rows: [...byEmployee.values()] });
  } catch (err) {
    if (err instanceof z.ZodError) return next(zodFail(err));
    next(err);
  }
}

module.exports = {
  getBalances,
  updateBalances,
  carryOver,
  listAll,
};
