const { query } = require('../db/postgres');

const LIMIT_PER_TYPE = 5;

async function globalSearch(term, { userId, permissions = [] } = {}) {
  const q = `%${term.trim()}%`;
  if (!term.trim()) {
    return { products: [], customers: [], invoices: [], suppliers: [], employees: [], purchase_orders: [], warranties: [], returns: [] };
  }

  const can = (p) => permissions.includes('*') || permissions.includes(p);

  const out = {
    products: [],
    customers: [],
    invoices: [],
    suppliers: [],
    employees: [],
    purchase_orders: [],
    warranties: [],
    returns: [],
  };

  // Build the set of queries gated by the caller's permissions, then fire them
  // all in parallel with Promise.all instead of sequentially.  Each independent
  // query can use a separate pool connection; the total latency becomes the
  // latency of the slowest single query rather than the sum of all queries.
  const tasks = [];

  if (can('product.view')) {
    tasks.push(['products', query(
      `SELECT p.id, p.name, v.sku, v.barcode, v.id AS variant_id
         FROM products p
         JOIN product_variants v ON v.product_id = p.id
        WHERE p.is_active = true
          AND (p.name ILIKE $1 OR v.sku ILIKE $1 OR v.barcode ILIKE $1)
        ORDER BY p.name
        LIMIT ${LIMIT_PER_TYPE}`,
      [q],
    )]);
  }

  if (can('customer.view')) {
    tasks.push(['customers', query(
      `SELECT id, name, phone
         FROM customers
        WHERE is_active = true AND (name ILIKE $1 OR phone ILIKE $1)
        ORDER BY name
        LIMIT ${LIMIT_PER_TYPE}`,
      [q],
    )]);
  }

  if (can('invoice.view')) {
    tasks.push(['invoices', query(
      `SELECT i.id, i.invoice_number, c.name AS customer_name
         FROM invoices i
         LEFT JOIN customers c ON c.id = i.customer_id
        WHERE i.invoice_number ILIKE $1
        ORDER BY i.created_at DESC
        LIMIT ${LIMIT_PER_TYPE}`,
      [q],
    )]);
  }

  if (can('supplier.view')) {
    tasks.push(['suppliers', query(
      `SELECT id, name FROM suppliers
        WHERE is_active = true AND name ILIKE $1
        ORDER BY name LIMIT ${LIMIT_PER_TYPE}`,
      [q],
    )]);
    tasks.push(['purchase_orders', query(
      `SELECT id, po_number, supplier_id
         FROM purchase_orders
        WHERE po_number ILIKE $1
        ORDER BY created_at DESC
        LIMIT ${LIMIT_PER_TYPE}`,
      [q],
    )]);
  }

  if (can('employee.view')) {
    tasks.push(['employees', query(
      `SELECT id, name FROM employees
        WHERE is_active = true AND name ILIKE $1
        ORDER BY name LIMIT ${LIMIT_PER_TYPE}`,
      [q],
    )]);
  }

  if (can('warranty.view')) {
    tasks.push(['warranties', query(
      `SELECT id, warranty_number, serial_number
         FROM warranties
        WHERE warranty_number ILIKE $1 OR serial_number ILIKE $1
        ORDER BY created_at DESC
        LIMIT ${LIMIT_PER_TYPE}`,
      [q],
    )]);
  }

  if (can('return.request') || can('return.approve')) {
    tasks.push(['returns', query(
      `SELECT id, request_number
         FROM return_requests
        WHERE request_number ILIKE $1
        ORDER BY created_at DESC
        LIMIT ${LIMIT_PER_TYPE}`,
      [q],
    )]);
  }

  const results = await Promise.all(tasks.map(([, p]) => p));
  tasks.forEach(([key], i) => { out[key] = results[i].rows; });

  return out;
}

module.exports = { globalSearch };
