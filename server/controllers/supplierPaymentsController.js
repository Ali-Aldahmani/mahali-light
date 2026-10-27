const { z } = require('zod');
const { query } = require('../db/postgres');
const { ok, created } = require('../utils/response');
const { AppError, ERROR_CODES } = require('../../shared/errorCodes');
const { requestKeyFrom } = require('../utils/operations');
const {
  addPayment,
  deletePayment,
} = require('../services/supplierPaymentService');
const {
  saveSupplierPaymentReceipt,
  deleteAttachmentFile,
} = require('../utils/upload');
const { emitEvent } = require('../socket/events');

const createSchema = z.object({
  amount: z.number().positive(),
  paymentMethod: z.enum(['cash', 'bank_transfer', 'cheque']),
  paymentDate: z.string().optional().nullable(),
  bankAccountId: z.string().uuid().optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});

function shape(row) {
  return {
    id: row.id,
    purchaseOrderId: row.purchase_order_id,
    poNumber: row.po_number,
    supplierId: row.supplier_id,
    supplierName: row.supplier_name,
    amount: Number(row.amount),
    paymentMethod: row.payment_method,
    paymentDate: row.payment_date,
    bankAccountId: row.bank_account_id,
    employeeId: row.employee_id,
    employeeUsername: row.employee_username,
    receiptAttachment: row.receipt_attachment,
    notes: row.notes,
    createdAt: row.created_at,
    reversedAt: row.reversed_at || null,
    reversedByUsername: row.reversed_by_username || null,
    reversalReason: row.reversal_reason || null,
  };
}

const PAYMENT_SELECT = `
  SELECT p.*, u.username AS employee_username, ru.username AS reversed_by_username,
         po.po_number, s.name AS supplier_name
    FROM supplier_payments p
    LEFT JOIN users u ON u.id = p.employee_id
    LEFT JOIN users ru ON ru.id = p.reversed_by
    LEFT JOIN purchase_orders po ON po.id = p.purchase_order_id
    LEFT JOIN suppliers s ON s.id = p.supplier_id
`;

async function listForPo(req, res, next) {
  try {
    const { rows } = await query(
      `${PAYMENT_SELECT}
        WHERE p.purchase_order_id = $1
        ORDER BY p.payment_date DESC, p.created_at DESC`,
      [req.params.id],
    );
    return ok(res, rows.map(shape));
  } catch (err) {
    next(err);
  }
}

async function createForPo(req, res, next) {
  try {
    const { id: poId } = req.params;
    const body = createSchema.parse(req.body || {});

    const { payment, po, treasury, replayed } = await addPayment({
      poId,
      amount: body.amount,
      method: body.paymentMethod,
      paymentDate: body.paymentDate || null,
      bankAccountId: body.bankAccountId || null,
      notes: body.notes || null,
      employeeId: req.user.id,
      requestKey: requestKeyFrom(req, { required: true }),
    });

    // A replayed retry changed nothing, so there is nothing to announce.
    const io = replayed ? null : req.app.get('io');
    if (io) {
      const payload = {
        paymentId: payment.id,
        poId,
        poNumber: po.po_number,
        amount: Number(payment.amount),
        method: payment.payment_method,
        balanceDue: Number(po.balance_due),
        paymentStatus: po.payment_status,
        paidBy: req.user.id,
        paidByUsername: req.user.username,
      };
      emitEvent(io, 'po_payment_added', payload);
      if (treasury) {
        const at = new Date().toISOString();
        if (treasury.method === 'cash') {
          const p = {
            newBalance: treasury.balanceAfter,
            delta: treasury.delta,
            transactionType: 'supplier_payment',
            changedBy: req.user.id,
            at,
          };
          emitEvent(io, 'cash_balance_updated', p);
        } else if (treasury.method === 'bank_transfer') {
          const p = {
            bankAccountId: treasury.accountId,
            bankName: treasury.bankName,
            newBalance: treasury.balanceAfter,
            delta: treasury.delta,
            transactionType: 'supplier_payment',
            changedBy: req.user.id,
            at,
          };
          emitEvent(io, 'bank_balance_updated', p);
        }
      }
    }

    const { rows } = await query(`${PAYMENT_SELECT} WHERE p.id = $1`, [payment.id]);
    const respond = replayed ? ok : created;
    return respond(res, {
      // A replay of a payment deleted since then has no live row left.
      payment: rows[0] ? shape(rows[0]) : payment,
      purchaseOrder: {
        id: po.id,
        amountPaid: Number(po.amount_paid),
        balanceDue: Number(po.balance_due),
        paymentStatus: po.payment_status,
      },
    });
  } catch (err) {
    next(err);
  }
}

async function remove(req, res, next) {
  try {
    const { id } = req.params;

    const { rows: existing } = await query(
      `SELECT receipt_attachment FROM supplier_payments WHERE id = $1`,
      [id],
    );
    if (!existing.length) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, { status: 404 });
    }

    // The payment is kept, marked reversed, and so is its receipt file.
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 500) || null : null;
    const { payment, po, treasury } = await deletePayment({ paymentId: id, userId: req.user.id, reason });

    const io = req.app.get('io');
    if (io && treasury) {
      const at = new Date().toISOString();
      if (treasury.method === 'cash') {
        const p = {
          newBalance: treasury.balanceAfter,
          delta: treasury.delta,
          transactionType: 'supplier_payment',
          changedBy: req.user.id,
          at,
        };
        emitEvent(io, 'cash_balance_updated', p);
      } else if (treasury.method === 'bank_transfer') {
        const p = {
          bankAccountId: treasury.accountId,
          bankName: treasury.bankName,
          newBalance: treasury.balanceAfter,
          delta: treasury.delta,
          transactionType: 'supplier_payment',
          changedBy: req.user.id,
          at,
        };
        emitEvent(io, 'bank_balance_updated', p);
      }
    }

    return ok(res, {
      id,
      purchaseOrder: {
        id: po.id,
        amountPaid: Number(po.amount_paid),
        balanceDue: Number(po.balance_due),
        paymentStatus: po.payment_status,
      },
    });
  } catch (err) {
    next(err);
  }
}

async function uploadReceipt(req, res, next) {
  try {
    const { id } = req.params;

    if (!req.file) {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'No file uploaded.', {
        status: 400,
      });
    }

    const { rows } = await query(
      `SELECT id, receipt_attachment FROM supplier_payments WHERE id = $1`,
      [id],
    );
    if (!rows.length) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, { status: 404 });
    }
    if (rows[0].receipt_attachment) {
      deleteAttachmentFile(rows[0].receipt_attachment);
    }

    const saved = await saveSupplierPaymentReceipt({
      paymentId: id,
      file: req.file,
    });

    await query(
      `UPDATE supplier_payments SET receipt_attachment = $1 WHERE id = $2`,
      [saved.relativePath, id],
    );

    return ok(res, {
      receiptAttachment: saved.relativePath,
      originalName: saved.originalName,
      size: saved.size,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { listForPo, createForPo, remove, uploadReceipt };
