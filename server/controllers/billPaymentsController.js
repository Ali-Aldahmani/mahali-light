const { z } = require('zod');
const { ok, parsePagination } = require('../utils/response');
const { AppError, ERROR_CODES } = require('../../shared/errorCodes');
const billService = require('../services/billService');
const { query } = require('../db/postgres');
const { saveBillPaymentReceipt } = require('../utils/upload');

function zodFail(err) {
  return new AppError(
    ERROR_CODES.VALIDATION_FAILED,
    err.errors[0]?.message || 'Invalid request.',
    { status: 400, details: err.errors },
  );
}

const listSchema = z.object({
  status: z.enum(['upcoming', 'due', 'overdue', 'paid']).optional(),
  billId: z.string().uuid().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

async function list(req, res, next) {
  try {
    const filters = listSchema.parse(req.query || {});
    const { limit, offset, page } = parsePagination(req);
    const rows = await billService.listPayments({ ...filters, limit, offset });
    return ok(res, rows, { page, limit });
  } catch (err) {
    if (err instanceof z.ZodError) return next(zodFail(err));
    next(err);
  }
}

async function upcoming(_req, res, next) {
  try {
    const data = await billService.getUpcomingGrouped();
    return ok(res, data);
  } catch (err) {
    next(err);
  }
}

// Multipart: amount_paid, payment_method, bank_account_id, paid_date, notes,
// receipt (optional file). Service layer handles all the heavy lifting.
const paySchema = z.object({
  amountPaid: z.coerce.number().positive(),
  paymentMethod: z.enum(['cash', 'bank']),
  bankAccountId: z.string().uuid().nullable().optional(),
  paidDate: z.string().optional(),
  notes: z.string().max(1000).nullable().optional(),
});

async function pay(req, res, next) {
  try {
    // Multipart form fields arrive as strings — Zod's coerce handles amount.
    const body = paySchema.parse(req.body || {});
    const io = req.app.get('io');

    let receiptRel = null;
    if (req.file) {
      const saved = await saveBillPaymentReceipt({
        billPaymentId: req.params.id,
        file: req.file,
      });
      receiptRel = saved.relativePath;
    }

    const result = await billService.payBillPayment({
      billPaymentId: req.params.id,
      amountPaid: body.amountPaid,
      paymentMethod: body.paymentMethod,
      bankAccountId: body.bankAccountId || null,
      paidDate: body.paidDate || null,
      notes: body.notes || null,
      receiptAttachment: receiptRel,
      userId: req.user.id,
      io,
    });
    return ok(res, result);
  } catch (err) {
    if (err instanceof z.ZodError) return next(zodFail(err));
    next(err);
  }
}

// Stand-alone receipt upload (e.g. attaching a receipt after the fact).
async function uploadReceipt(req, res, next) {
  try {
    if (!req.file) {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'No file uploaded.');
    }
    const saved = await saveBillPaymentReceipt({
      billPaymentId: req.params.id,
      file: req.file,
    });
    await query(
      `UPDATE bill_payments SET receipt_attachment = $1 WHERE id = $2`,
      [saved.relativePath, req.params.id],
    );
    return ok(res, { receiptAttachment: saved.relativePath });
  } catch (err) {
    next(err);
  }
}

module.exports = { list, upcoming, pay, uploadReceipt };
