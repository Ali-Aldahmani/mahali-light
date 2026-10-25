const { query } = require('../db/postgres');
const { AppError, ERROR_CODES } = require('../../shared/errorCodes');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const relation = (permission, sql) => ({ permission, sql });

// SQL identifiers are server-owned and selected only through this allowlist.
// Entity type input is never interpolated into a table or column name.
const RECORD_TYPES = {
  invoice: { permission: 'invoice.view', table: 'invoices', label: 'Invoice', display: 'invoice_number', relations: [
    relation('return.request', `SELECT 'return_request', id, 'Return request' FROM return_requests WHERE reference_type='invoice' AND reference_id=$2`),
    relation('return.request', `SELECT 'return_order', id, 'Return order' FROM return_orders WHERE original_invoice_id=$2 OR replacement_invoice_id=$2`),
    relation('warranty.view', `SELECT 'warranty', id, 'Warranty' FROM warranties WHERE invoice_id=$2`),
    relation('warranty.view', `SELECT 'warranty_claim', id, 'Warranty claim' FROM warranty_claims WHERE replacement_invoice_id=$2 OR warranty_id IN (SELECT id FROM warranties WHERE invoice_id=$2)`),
  ]},
  customer: { permission: 'customer.view', table: 'customers', label: 'Customer', display: 'name', relations: [
    relation('invoice.view', `SELECT 'invoice', id, 'Invoice' FROM invoices WHERE customer_id=$2`),
    relation('return.request', `SELECT 'return_request', id, 'Return request' FROM return_requests WHERE customer_id=$2`),
    relation('return.request', `SELECT 'return_order', id, 'Return order' FROM return_orders WHERE customer_id=$2`),
    relation('warranty.view', `SELECT 'warranty', id, 'Warranty' FROM warranties WHERE customer_id=$2`),
    relation('warranty.view', `SELECT 'warranty_claim', id, 'Warranty claim' FROM warranty_claims WHERE customer_id=$2`),
  ]},
  product: { permission: 'product.view', table: 'products', label: 'Product', display: 'name', relations: [
    relation('product.view', `SELECT 'variant', id, 'Product variant' FROM product_variants WHERE product_id=$2`),
    relation('product.view', `SELECT 'product_variant', id, 'Product variant' FROM product_variants WHERE product_id=$2`),
    relation('stock.view', `SELECT 'stock_adjustment', id, 'Stock adjustment' FROM stock_adjustment_requests WHERE product_id=$2`),
    relation('supplier.view', `SELECT 'purchase_order', purchase_order_id, 'Purchase order' FROM purchase_order_items WHERE product_id=$2`),
    relation('return.request', `SELECT 'return_request', return_request_id, 'Return request' FROM return_request_items WHERE product_id=$2`),
    relation('warranty.view', `SELECT 'warranty', id, 'Warranty' FROM warranties WHERE product_id=$2`),
  ]},
  category: { permission: 'product.view', table: 'product_categories', label: 'Category', display: 'name', relations: [
    relation('product.view', `SELECT 'product', id, 'Product' FROM products WHERE category_id=$2`),
  ]},
  supplier: { permission: 'supplier.view', table: 'suppliers', label: 'Supplier', display: 'name', relations: [
    relation('supplier.view', `SELECT 'purchase_order', id, 'Purchase order' FROM purchase_orders WHERE supplier_id=$2`),
    relation('supplier.view', `SELECT 'supplier_payment', id, 'Supplier payment' FROM supplier_payments WHERE supplier_id=$2`),
    relation('supplier.view', `SELECT 'supplier_return', id, 'Supplier return' FROM supplier_returns WHERE supplier_id=$2`),
    relation('warranty.view', `SELECT 'warranty', id, 'Warranty' FROM warranties WHERE supplier_id=$2`),
  ]},
  purchase_order: { permission: 'supplier.view', table: 'purchase_orders', label: 'Purchase order', display: 'po_number', relations: [
    relation('supplier.view', `SELECT 'supplier_payment', id, 'Supplier payment' FROM supplier_payments WHERE purchase_order_id=$2`),
    relation('supplier.view', `SELECT 'supplier_return', id, 'Supplier return' FROM supplier_returns WHERE purchase_order_id=$2`),
    relation('warranty.view', `SELECT 'warranty', id, 'Warranty' FROM warranties WHERE purchase_order_id=$2`),
  ]},
  return_request: { permission: 'return.request', table: 'return_requests', label: 'Return request', display: 'request_number', relations: [
    relation('return.request', `SELECT 'return_order', id, 'Return order' FROM return_orders WHERE return_request_id=$2`),
  ]},
  return_order: { permission: 'return.request', table: 'return_orders', label: 'Return order', display: 'return_order_number', relations: [
    relation('return.request', `SELECT 'return_request', return_request_id, 'Return request' FROM return_orders WHERE id=$2 AND return_request_id IS NOT NULL`),
  ]},
  stock_count: { permission: 'stock.view', table: 'stock_counts', label: 'Stock count', display: "'Stock count ' || left(id::text,8)", relations: [] },
  bill: { permission: 'bills.view', table: 'bills', label: 'Bill', display: 'name', relations: [
    relation('bills.view', `SELECT 'bill_payment', id, 'Bill payment' FROM bill_payments WHERE bill_id=$2`),
  ]},
  journal_entry: { permission: 'finance.view_journal', table: 'journal_entries', label: 'Journal entry', display: 'entry_number', relations: [] },
  warranty: { permission: 'warranty.view', table: 'warranties', label: 'Warranty', display: 'warranty_number', relations: [
    relation('warranty.view', `SELECT 'warranty_claim', id, 'Warranty claim' FROM warranty_claims WHERE warranty_id=$2`),
  ]},
  warranty_claim: { permission: 'warranty.view', table: 'warranty_claims', label: 'Warranty claim', display: 'claim_number', relations: [
    relation('warranty.view', `SELECT 'warranty', warranty_id, 'Warranty' FROM warranty_claims WHERE id=$2`),
  ]},
};

const SENSITIVE = /(password|passcode|secret|token|credential|private.?key|card.?number|cvv|cvc|pin)/i;
const COST = /(^|_)(cost|cost_price|cost_price_at_time|unit_cost)(_|$)/i;

function redact(value, canViewCost = false) {
  if (Array.isArray(value)) return value.map((item) => redact(item, canViewCost));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [
    key,
    SENSITIVE.test(key) || (!canViewCost && COST.test(key)) ? '[REDACTED]' : redact(child, canViewCost),
  ]));
}
function redactText(value) {
  if (!value) return value;
  return String(value).replace(/\b(password|passcode|secret|token|cvv|cvc|pin)\s*[:=]\s*\S+/gi, '$1=[REDACTED]');
}

function has(user, permission) {
  const permissions = user?.permissions || [];
  return permissions.includes('*') || permissions.includes(permission);
}

function decodeCursor(raw) {
  if (!raw) return null;
  try {
    const value = JSON.parse(Buffer.from(String(raw), 'base64url').toString());
    if (!Array.isArray(value) || Number.isNaN(Date.parse(value[0])) || !UUID_RE.test(value[1])) throw new Error();
    return value;
  } catch {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'Invalid audit cursor.', { status: 400 });
  }
}

function encodeCursor(row) {
  return Buffer.from(JSON.stringify([new Date(row.timestamp).toISOString(), row.id])).toString('base64url');
}

async function getRecordAudit({ entityType, entityId, user, limit, cursor, scope, action, actorId, from, to, search }) {
  const config = RECORD_TYPES[entityType];
  if (!config || !UUID_RE.test(entityId)) throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'Unsupported record type or identifier.', { status: 400 });
  if (!has(user, config.permission)) throw new AppError(ERROR_CODES.AUTH_NO_PERMISSION, undefined, { status: 403, details: { missing: [config.permission] } });

  const { rows: records } = await query(`SELECT id, ${config.display} AS display FROM ${config.table} WHERE id=$1`, [entityId]);
  if (!records.length) throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND);

  const permittedRelations = config.relations.filter((item) => has(user, item.permission));
  const scopeParts = [
    `SELECT $1::text entity_type, $2::uuid entity_id, 'Direct change'::text relationship, true direct`,
    ...permittedRelations.map((item) => `SELECT r.entity_type, r.entity_id, r.relationship, false FROM (${item.sql}) r(entity_type,entity_id,relationship)`),
  ];
  const values = [entityType, entityId];
  const where = [];
  if (scope === 'direct') where.push('s.direct');
  if (scope === 'related') where.push('NOT s.direct');
  if (action) { values.push(action); where.push(`a.action ILIKE $${values.length}`); }
  if (actorId) { values.push(actorId); where.push(`a.performed_by=$${values.length}::uuid`); }
  if (from) { values.push(from); where.push(`a.timestamp >= $${values.length}::date`); }
  if (to) { values.push(to); where.push(`a.timestamp < $${values.length}::date + interval '1 day'`); }
  if (search) { values.push(`%${search}%`); where.push(`(a.action ILIKE $${values.length} OR coalesce(a.notes,'') ILIKE $${values.length} OR coalesce(a.performed_by_name,u.username,'') ILIKE $${values.length})`); }
  const before = decodeCursor(cursor);
  if (before) { values.push(before[0], before[1]); where.push(`(a.timestamp,a.id) < ($${values.length - 1}::timestamptz,$${values.length}::uuid)`); }
  const pageSize = Math.min(100, Math.max(1, Number(limit) || 50));
  values.push(pageSize + 1);

  const { rows } = await query(`
    WITH raw_scope AS (${scopeParts.join(' UNION ALL ')}),
    scope AS (
      SELECT entity_type, entity_id, bool_or(direct) direct, min(relationship) relationship
        FROM raw_scope WHERE entity_id IS NOT NULL GROUP BY entity_type, entity_id
    )
    SELECT a.id,a.entity_type,a.entity_id,a.action,a.performed_by,
           coalesce(a.performed_by_name,u.username,'system') actor,a.timestamp,
           a.old_value,a.new_value,a.notes,s.direct,s.relationship
      FROM scope s JOIN activity_log a USING (entity_type,entity_id)
      LEFT JOIN users u ON u.id=a.performed_by
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY a.timestamp DESC,a.id DESC LIMIT $${values.length}`, values);

  const page = rows.slice(0, pageSize);
  const canViewCost = has(user, 'product.view_cost');
  return {
    record: { entityType, entityId, typeLabel: config.label, display: records[0].display },
    events: page.map((row) => ({
      id: row.id, entityType: row.entity_type, entityId: row.entity_id,
      action: row.action, actorId: row.performed_by, actor: row.actor, at: row.timestamp,
      oldValue: redact(row.old_value, canViewCost), newValue: redact(row.new_value, canViewCost),
      notes: redactText(row.notes), scope: row.direct ? 'direct' : 'related', relationship: row.relationship,
    })),
    nextCursor: rows.length > pageSize ? encodeCursor(page[page.length - 1]) : null,
  };
}

module.exports = { RECORD_TYPES, getRecordAudit, redact, redactText, decodeCursor };
