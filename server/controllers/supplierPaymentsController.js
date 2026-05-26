const { z } = require('zod');
const { query } = require('../db/postgres');
const { ok, created } = require('../utils/response');
const { AppError, ERROR_CODES } = require('../../shared/errorCodes');
const { logActivity } = require('../utils/activityLog');
const {
  addPayment,
  deletePayment,
} = require('../services/supplierPaymentService');
const {
  saveSupplierPaymentReceipt,
  deleteAttachmentFile,
} = require('../utils/upload');

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
  };
}

const PAYMENT_SELECT = `
  SELECT p.*, u.username AS employee_username,
         po.po_number, s.name AS supplier_name
    FROM supplier_payments p
    LEFT JOIN users u ON u.id = p.employee_id
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

    const { payment, po } = await addPayment({
      poId,
      amount: body.amount,
      method: body.paymentMethod,
      paymentDate: body.paymentDate || null,
      bankAccountId: body.bankAccountId || null,
      notes: body.notes || null,
      employeeId: req.user.id,
    });

    await logActivity({
      entityType: 'supplier_payment',
      entityId: payment.id,
      action: 'purchase_order.payment_added',
      performedBy: req.user.id,
      notes: `${Number(payment.amount).toFixed(2)} via ${payment.payment_method} on ${po.po_number}`,
    });

    const io = req.app.get('io');
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
      io.to('role:Manager').emit('po_payment_added', payload);
      io.to('role:Admin').emit('po_payment_added', payload);
    }

    const { rows } = await query(`${PAYMENT_SELECT} WHERE p.id = $1`, [payment.id]);
    return created(res, {
      payment: shape(rows[0]),
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

    const { payment, po } = await deletePayment({ paymentId: id });

    if (existing[0].receipt_attachment) {
      deleteAttachmentFile(existing[0].receipt_attachment);
    }

    await logActivity({
      entityType: 'supplier_payment',
      entityId: id,
      action: 'purchase_order.payment_deleted',
      performedBy: req.user.id,
      notes: `Reversed ${Number(payment.amount).toFixed(2)} on PO ${po.po_number}`,
    });

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
