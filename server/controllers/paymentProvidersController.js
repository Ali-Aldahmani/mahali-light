const { z } = require('zod');
const { ok, created } = require('../utils/response');
const { AppError, ERROR_CODES } = require('../../shared/errorCodes');
const { requestKeyFrom } = require('../utils/operations');
const paymentFeeService = require('../services/paymentFeeService');

const METHOD = z.enum(['percent', 'fixed', 'percent_fixed']);
const CHARGE_METHOD = z.enum(['none', 'percent', 'fixed', 'percent_fixed']);
const percent = z.number().finite().min(0).max(100);
const amount = z.number().finite().min(0).max(100000).multipleOf(0.01);

const fields = {
  name: z.string().trim().min(1).max(100),
  bankAccountId: z.string().uuid().nullable(),
  feeMethod: METHOD,
  feePercent: percent,
  feeFixed: amount,
  refundFeePolicy: z.enum(['none', 'proportional']),
  refundChargeMethod: CHARGE_METHOD,
  refundChargePercent: percent,
  refundChargeFixed: amount,
  isDefault: z.boolean(),
  isActive: z.boolean(),
};

const createSchema = z.object(fields).partial().required({ name: true, feeMethod: true }).strict();
const updateSchema = z.object(fields).partial().strict();

function zodFail(err) {
  return new AppError(ERROR_CODES.VALIDATION_FAILED, err.errors?.[0]?.message || 'Invalid request.', {
    status: 400, details: err.errors,
  });
}

function canManage(req) {
  const owned = req.user?.permissions || [];
  return owned.includes('finance.manage_payment_fees') || owned.includes('*');
}

// Cashiers list providers to pick one at the till; only fee managers see the
// rates and refund rules.
async function list(req, res, next) {
  try {
    const manager = canManage(req);
    const providers = await paymentFeeService.listProviders({ includeInactive: manager && req.query.all === 'true' });
    ok(res, manager ? providers : providers.map((p) => ({ id: p.id, name: p.name, isDefault: p.isDefault })));
  } catch (err) {
    next(err);
  }
}

async function create(req, res, next) {
  try {
    const body = createSchema.parse(req.body || {});
    const provider = await paymentFeeService.createProvider(body, {
      userId: req.user.id, requestKey: requestKeyFrom(req),
    });
    created(res, provider);
  } catch (err) {
    next(err.errors ? zodFail(err) : err);
  }
}

async function update(req, res, next) {
  try {
    const body = updateSchema.parse(req.body || {});
    if (!z.string().uuid().safeParse(req.params.id).success) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, { status: 404 });
    }
    ok(res, await paymentFeeService.updateProvider(req.params.id, body, { userId: req.user.id }));
  } catch (err) {
    next(err.errors ? zodFail(err) : err);
  }
}

// GET /api/invoices/:id/payment-fees — the card fee events of one sale.
async function invoiceFees(req, res, next) {
  try {
    if (!z.string().uuid().safeParse(req.params.id).success) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, { status: 404 });
    }
    ok(res, await paymentFeeService.feesForInvoice(req.params.id));
  } catch (err) {
    next(err);
  }
}

module.exports = { list, create, update, invoiceFees };
