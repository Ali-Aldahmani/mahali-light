const { z } = require('zod');
const { ok, created } = require('../utils/response');
const { AppError, ERROR_CODES } = require('../../shared/errorCodes');
const { requestKeyFrom } = require('../utils/operations');
const payroll = require('../services/payrollService');

const uuid = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Dates are YYYY-MM-DD.');
const amount = z.number().finite().min(0).max(10000000);

function fail(err) {
  if (err instanceof z.ZodError) {
    return new AppError(ERROR_CODES.VALIDATION_FAILED, err.errors[0]?.message || 'Invalid request.', { status: 400, details: err.errors });
  }
  return err;
}
function id(value) {
  if (!uuid.safeParse(value).success) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, { status: 404 });
  return value;
}
const overdraft = (req) => (req.user?.permissions || []).includes('bank.overdraft');
const wrap = (fn) => async (req, res, next) => { try { await fn(req, res); } catch (err) { next(fail(err)); } };

const paySchema = z.object({
  salaryType: z.enum(['monthly', 'daily', 'hourly']).optional(),
  baseSalary: amount.optional(),
  monthlyAllowance: amount.optional(),
  employerContributionRate: z.number().min(0).max(100).optional(),
  overtimeMultiplier: z.number().min(0).max(5).optional(),
}).strict();

const runSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  month: z.number().int().min(1).max(12),
  notes: z.string().max(1000).optional().nullable(),
});

const lineSchema = z.object({
  allowances: amount.optional(),
  overtimePay: amount.optional(),
  otherDeductions: amount.optional(),
  advanceRecovery: amount.optional(),
  notes: z.string().max(500).optional().nullable(),
}).strict();

const paymentSchema = z.object({
  lineIds: z.array(uuid).max(500).optional().nullable(),
  method: z.enum(['cash', 'bank']),
  bankAccountId: uuid.optional().nullable(),
  paidDate: date.optional(),
});

const advanceSchema = z.object({
  employeeId: uuid,
  amount: z.number().positive().max(10000000),
  method: z.enum(['cash', 'bank']),
  bankAccountId: uuid.optional().nullable(),
  issuedDate: date.optional(),
  notes: z.string().max(500).optional().nullable(),
});

module.exports = {
  listPay: wrap(async (req, res) => ok(res, await payroll.listPaySettings())),
  setPay: wrap(async (req, res) => ok(res, await payroll.setPaySettings(id(req.params.id), paySchema.parse(req.body || {}), { userId: req.user.id }))),
  listRuns: wrap(async (req, res) => ok(res, await payroll.listRuns())),
  getRun: wrap(async (req, res) => ok(res, await payroll.loadRun(id(req.params.id)))),
  createRun: wrap(async (req, res) => created(res, await payroll.createRun(runSchema.parse(req.body || {}), {
    userId: req.user.id, requestKey: requestKeyFrom(req),
  }))),
  updateLine: wrap(async (req, res) => ok(res, await payroll.updateLine(id(req.params.id), id(req.params.lineId),
    lineSchema.parse(req.body || {}), { userId: req.user.id }))),
  deleteDraft: wrap(async (req, res) => ok(res, await payroll.deleteDraft(id(req.params.id), { userId: req.user.id }))),
  approve: wrap(async (req, res) => ok(res, await payroll.approveRun(id(req.params.id), { userId: req.user.id }))),
  pay: wrap(async (req, res) => ok(res, await payroll.payRun(id(req.params.id), {
    ...paymentSchema.parse(req.body || {}), allowOverdraft: overdraft(req),
  }, { userId: req.user.id, requestKey: requestKeyFrom(req) }))),
  voidRun: wrap(async (req, res) => ok(res, await payroll.voidRun(id(req.params.id), {
    reason: z.object({ reason: z.string().min(5).max(500) }).parse(req.body || {}).reason, userId: req.user.id,
  }))),
  listAdvances: wrap(async (req, res) => ok(res, await payroll.listAdvances())),
  issueAdvance: wrap(async (req, res) => created(res, await payroll.issueAdvance({
    ...advanceSchema.parse(req.body || {}), allowOverdraft: overdraft(req),
  }, { userId: req.user.id, requestKey: requestKeyFrom(req) }))),
};
