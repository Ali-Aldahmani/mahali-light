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

  if (can('product.view')) {
    const { rows } = await query(
      `SELECT p.id, p.name, v.sku, v.barcode, v.id AS variant_id
         FROM products p
         JOIN product_variants v ON v.product_id = p.id
        WHERE p.is_active = true
          AND (p.name ILIKE $1 OR v.sku ILIKE $1 OR v.barcode ILIKE $1)
        ORDER BY p.name
        LIMIT ${LIMIT_PER_TYPE}`,
      [q],
    );
    out.products = rows;
  }

  if (can('customer.view')) {
    const { rows } = await query(
      `SELECT id, name, phone
         FROM customers
        WHERE is_active = true AND (name ILIKE $1 OR phone ILIKE $1)
        ORDER BY name
        LIMIT ${LIMIT_PER_TYPE}`,
      [q],
    );
    out.customers = rows;
  }

  if (can('invoice.view')) {
    const { rows } = await query(
      `SELECT i.id, i.invoice_number, c.name AS customer_name
         FROM invoices i
         LEFT JOIN customers c ON c.id = i.customer_id
        WHERE i.invoice_number ILIKE $1
        ORDER BY i.created_at DESC
        LIMIT ${LIMIT_PER_TYPE}`,
      [q],
    );
    out.invoices = rows;
  }

  if (can('supplier.view')) {
    const { rows } = await query(
      `SELECT id, name FROM suppliers
        WHERE is_active = true AND name ILIKE $1
        ORDER BY name LIMIT ${LIMIT_PER_TYPE}`,
      [q],
    );
    out.suppliers = rows;
  }

  if (can('employee.view')) {
    const { rows } = await query(
      `SELECT id, name FROM employees
        WHERE is_active = true AND name ILIKE $1
        ORDER BY name LIMIT ${LIMIT_PER_TYPE}`,
      [q],
    );
    out.employees = rows;
  }

  if (can('supplier.view')) {
    const { rows } = await query(
      `SELECT id, po_number, supplier_id
         FROM purchase_orders
        WHERE po_number ILIKE $1
        ORDER BY created_at DESC
        LIMIT ${LIMIT_PER_TYPE}`,
      [q],
    );
    out.purchase_orders = rows;
  }

  if (can('warranty.view')) {
    const { rows } = await query(
      `SELECT id, warranty_number, serial_number
         FROM warranties
        WHERE warranty_number ILIKE $1 OR serial_number ILIKE $1
        ORDER BY created_at DESC
        LIMIT ${LIMIT_PER_TYPE}`,
      [q],
    );
    out.warranties = rows;
  }

  if (can('return.request') || can('return.approve')) {
    const { rows } = await query(
      `SELECT id, request_number
         FROM return_requests
        WHERE request_number ILIKE $1
        ORDER BY created_at DESC
        LIMIT ${LIMIT_PER_TYPE}`,
      [q],
    );
    out.returns = rows;
  }

  return out;
}

module.exports = { globalSearch };
