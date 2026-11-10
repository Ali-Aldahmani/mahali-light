const { z } = require('zod');
const { ok } = require('../utils/response');
const { AppError, ERROR_CODES } = require('../../shared/errorCodes');
const lifecycle = require('../services/productLifecycleService');
const { getSettings } = require('../services/appSettingsService');

// Field-level access, enforced here for every lifecycle response:
//  - quantities, dates and events: product.view (the route)
//  - cost, COGS, profit, fees, book and batch values: product.view_cost
//  - revenue: report.sales, analytics.view or product.view_cost
//  - suppliers and purchase orders: supplier.view
const COST_KEYS = new Set([
  'unitCost', 'groupCost', 'cogs', 'bookCogs', 'physicalCost', 'grossProfit', 'physicalGrossProfit',
  'grossMarginPct', 'contribution', 'fees', 'paymentFees', 'inventoryValue', 'remainingValue', 'valueChange',
  'physicalValue', 'bookValue', 'book_value', 'average_cost', 'last_purchase_cost', 'openingValue',
  'closingValue', 'averageValue', 'netCogs', 'turnover', 'oldValue', 'newValue',
]);
const REVENUE_KEYS = new Set(['revenue']);
const SUPPLIER_KEYS = new Set(['supplierId', 'supplierName', 'poNumber', 'purchaseOrderId']);

function access(req) {
  const owned = new Set(req.user?.permissions || []);
  const all = owned.has('*');
  const cost = all || owned.has('product.view_cost');
  return {
    cost,
    revenue: cost || all || owned.has('report.sales') || owned.has('analytics.view'),
    supplier: all || owned.has('supplier.view'),
  };
}

function redact(value, can) {
  if (Array.isArray(value)) return value.map((v) => redact(v, can));
  if (!value || typeof value !== 'object' || value instanceof Date) return value;
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (!can.cost && COST_KEYS.has(k)) continue;
    if (!can.revenue && REVENUE_KEYS.has(k)) continue;
    if (!can.supplier && SUPPLIER_KEYS.has(k)) continue;
    out[k] = redact(v, can);
  }
  return out;
}

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Dates are YYYY-MM-DD.').optional();
const pageSchema = z.object({
  page: z.coerce.number().int().min(1).max(10000).optional().default(1),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  start_date: date,
  end_date: date,
  types: z.string().max(200).optional(),
});

function parse(req) {
  if (!z.string().uuid().safeParse(req.params.id).success) {
    throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, { status: 404 });
  }
  const q = pageSchema.parse(req.query);
  if (q.start_date && q.end_date && q.start_date > q.end_date) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'The start date is after the end date.', { status: 400 });
  }
  return q;
}

function handler(load) {
  return async (req, res, next) => {
    try {
      const q = parse(req);
      const data = await load(req.params.id, q);
      if (!data) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, 'Product not found.', { status: 404 });
      ok(res, redact(data, access(req)));
    } catch (err) {
      next(err.errors ? new AppError(ERROR_CODES.VALIDATION_FAILED, err.errors[0]?.message, { status: 400 }) : err);
    }
  };
}

const overview = handler(async (id, q) => {
  const settings = await getSettings().catch(() => null);
  return lifecycle.getLifecycle(id, {
    startDate: q.start_date || null, endDate: q.end_date || null,
    deadStockDays: Number(settings?.dead_stock_days) || 30,
  });
});
const receipts = handler((id, q) => lifecycle.getReceipts(id, q));
const sales = handler((id, q) => lifecycle.getSales(id, {
  startDate: q.start_date || null, endDate: q.end_date || null, page: q.page, limit: q.limit,
}));
const timeline = handler((id, q) => lifecycle.getTimeline(id, {
  types: q.types ? q.types.split(',').map((t) => t.trim()).filter(Boolean) : null,
  startDate: q.start_date || null, endDate: q.end_date || null, page: q.page, limit: q.limit,
}));

module.exports = { overview, receipts, sales, timeline, redact, access };
