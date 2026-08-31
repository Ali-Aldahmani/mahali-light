import { initialMockData } from './mockData.js';

// Deep clone helper
function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

// In-memory persistent state for the active demo session
let db = clone(initialMockData);

export function resetMockDb() {
  db = clone(initialMockData);
}

export function getMockDb() {
  return db;
}

// URL query parser
function parseQuery(url) {
  const queryIndex = url.indexOf('?');
  if (queryIndex === -1) return { path: url, params: {} };
  const path = url.slice(0, queryIndex);
  const queryStr = url.slice(queryIndex + 1);
  const params = {};
  new URLSearchParams(queryStr).forEach((val, key) => {
    params[key] = val;
  });
  return { path, params };
}

// Async delay simulation (instant / 15ms so UI shows smooth transitions without lagging)
const delay = (ms = 15) => new Promise((resolve) => setTimeout(resolve, ms));

function stockRowStatus(qty, threshold) {
  if (qty <= 0) return 'out_of_stock';
  if (threshold > 0 && qty <= threshold) return 'low_stock';
  return 'in_stock';
}

// Flattens products (+ variants) into one stock row per sellable unit —
// shared by /stock/summary and stock-count seeding so both agree on shape.
function flattenStockRows() {
  const rows = [];
  db.products.forEach((p) => {
    const threshold = p.min_stock_level || 0;
    const units = p.variants && p.variants.length > 0 ? p.variants : [null];
    units.forEach((v) => {
      const stockQty = v ? v.stock_quantity || 0 : p.stock_quantity || 0;
      const costPrice = (v ? v.cost_price : null) ?? p.cost_price ?? 0;
      rows.push({
        productId: p.id,
        variantId: v ? v.id : p.id,
        productName: p.name,
        variantName: v ? v.name : null,
        categoryName: p.category_name,
        sku: v ? v.sku : p.sku,
        barcode: v ? v.barcode : p.barcode,
        productImage: p.image || null,
        unitLabel: p.unit,
        stockQty,
        quarantineQty: 0,
        reorderThreshold: threshold,
        costPrice,
        stockValue: stockQty * costPrice,
        status: stockRowStatus(stockQty, threshold),
      });
    });
  });
  return rows;
}

function mapCountListRow(c) {
  const counted = c.items.filter((it) => it.counted_quantity != null);
  const discrepancies = counted.filter((it) => it.counted_quantity !== it.system_quantity);
  const netValueImpact = counted.reduce(
    (acc, it) => acc + (it.counted_quantity - it.system_quantity) * (it.cost_price || 0),
    0,
  );
  return {
    id: c.id,
    countNumber: c.count_number,
    countType: c.count_type,
    categoryName: c.category_name,
    status: c.status,
    initiatedByUsername: c.initiated_by_username,
    initiatedAt: c.initiated_at,
    totalProducts: c.items.length,
    matchedCount: counted.length - discrepancies.length,
    discrepancyCount: discrepancies.length,
    netValueImpact,
  };
}

function mapCountDetail(c) {
  return {
    ...mapCountListRow(c),
    approvedByUsername: c.approved_by_username,
    approvedAt: c.approved_at,
    rejectionReason: c.rejection_reason,
    notes: c.notes,
    items: c.items.map((it) => ({
      id: it.id,
      productId: it.product_id,
      variantId: it.variant_id,
      productName: it.product_name,
      sku: it.sku,
      systemQty: it.system_quantity,
      countedQty: it.counted_quantity,
      unitLabel: it.unit_label,
      costPrice: it.cost_price,
    })),
  };
}

// Finds the product (and variant, if any) that owns a given variantId.
// For products without variants, flattenStockRows treats the product's own
// id as its "variantId", so we check that case too.
function findProductAndVariant(variantId) {
  const vid = Number(variantId);
  for (const p of db.products) {
    if (p.variants && p.variants.length > 0) {
      const v = p.variants.find((vv) => vv.id === vid);
      if (v) return { product: p, variant: v };
    } else if (p.id === vid) {
      return { product: p, variant: null };
    }
  }
  return { product: null, variant: null };
}

function mapInvoiceListRow(inv) {
  return {
    id: inv.id,
    invoiceNumber: inv.invoice_number,
    customerId: inv.customer_id || null,
    customerName: inv.customer_name,
    customerCompany: null,
    createdAt: inv.date,
    itemCount: (inv.items || []).length,
    total: inv.grand_total,
    amountPaid: inv.paid_amount,
    balanceDue: inv.balance_due,
    paymentStatus: inv.payment_status,
    status: inv.status,
    createdByUsername: inv.cashier_name,
    pcIdentifier: inv.pc_identifier || null,
  };
}

function mapInvoiceDetail(inv) {
  const customer = inv.customer_id ? db.customers.find((c) => c.id === inv.customer_id) : null;
  const items = (inv.items || []).map((it) => {
    const { product, variant } = findProductAndVariant(it.variant_id ?? it.product_id);
    return {
      id: it.id,
      productId: it.product_id ?? product?.id ?? null,
      variantId: it.variant_id ?? null,
      productName: it.product_name,
      variantAttributes: variant?.attributes || {},
      sku: variant?.sku || product?.sku || null,
      quantity: it.quantity,
      unitLabel: product?.unit || 'pcs',
      unitPrice: it.unit_price,
      discountAmount: it.discount || 0,
      lineTotal: it.line_total,
      costPriceAtTime: (variant ? variant.cost_price : product?.cost_price) || 0,
    };
  });
  const payments = (inv.payments || []).map((p) => ({
    id: p.id,
    method: p.method,
    amount: p.amount,
    timestamp: p.date,
    employeeUsername: inv.cashier_name,
    notes: p.notes || null,
  }));
  const hasReturn = db.returnRequests.some(
    (r) => r.referenceId === inv.id && r.status !== 'rejected' && r.status !== 'cancelled',
  );
  return {
    invoice: {
      id: inv.id,
      invoiceNumber: inv.invoice_number,
      status: inv.status,
      paymentStatus: inv.payment_status,
      createdByUsername: inv.cashier_name,
      createdAt: inv.date,
      pcIdentifier: inv.pc_identifier || null,
      confirmedAt: inv.status === 'confirmed' ? (inv.confirmed_at || inv.date) : null,
      confirmedByUsername: inv.status === 'confirmed' ? inv.cashier_name : null,
      customerId: inv.customer_id || null,
      customerName: inv.customer_name,
      customerCompany: null,
      customerPhone: customer?.phone || null,
      customerCreditBalance: customer ? customer.outstanding_balance : null,
      hasReturn,
      subtotal: inv.subtotal,
      discountAmount: inv.discount_total,
      invoiceDiscount: inv.invoice_discount ?? 0,
      taxableAmount: inv.taxable_amount,
      taxRate: 5,
      taxAmount: inv.vat_total,
      total: inv.grand_total,
      amountPaid: inv.paid_amount,
      balanceDue: inv.balance_due,
      notes: inv.notes || null,
    },
    items,
    payments,
    editRequests: db.invoiceEditRequests.filter((r) => r.invoiceId === inv.id),
    history: inv.history || [],
    warranties: [],
  };
}

function mapCustomer(c) {
  const custInvoices = db.invoices.filter((inv) => inv.customer_id === c.id && inv.status !== 'cancelled');
  const totalSpent = custInvoices.reduce((acc, inv) => acc + (inv.grand_total || 0), 0);
  const invoiceCount = custInvoices.length;
  const lastPurchaseDate = custInvoices.length
    ? custInvoices.reduce((latest, inv) => (new Date(inv.date) > new Date(latest) ? inv.date : latest), custInvoices[0].date)
    : null;
  const custPayments = db.customerPayments.filter((p) => p.customer_id === c.id);
  const lastPaymentDate = custPayments.length
    ? custPayments.reduce((latest, p) => (new Date(p.payment_date) > new Date(latest) ? p.payment_date : latest), custPayments[0].payment_date)
    : null;
  return {
    id: c.id,
    name: c.name,
    phone: c.phone,
    email: c.email || null,
    companyName: c.company_name || null,
    trnNumber: c.trn || null,
    address: c.address || null,
    notes: c.notes || null,
    creditLimit: c.credit_limit || 0,
    creditDays: c.credit_days || 0,
    creditBalance: c.outstanding_balance || 0,
    totalSpent: totalSpent || c.total_purchases || 0,
    invoiceCount,
    avgOrderValue: invoiceCount > 0 ? totalSpent / invoiceCount : 0,
    lastPurchaseDate,
    lastPaymentDate,
    isActive: c.is_active,
    createdAt: c.created_at,
  };
}

function customerInputToRow(payload, existing = {}) {
  const row = { ...existing };
  if (payload.name !== undefined) row.name = payload.name;
  if (payload.phone !== undefined) row.phone = payload.phone;
  if (payload.email !== undefined) row.email = payload.email;
  if (payload.companyName !== undefined) row.company_name = payload.companyName;
  if (payload.trnNumber !== undefined) row.trn = payload.trnNumber;
  if (payload.address !== undefined) row.address = payload.address;
  if (payload.creditLimit !== undefined) row.credit_limit = Number(payload.creditLimit) || 0;
  if (payload.notes !== undefined) row.notes = payload.notes;
  if (payload.isActive !== undefined) row.is_active = !!payload.isActive;
  return row;
}

function mapWarranty(w) {
  const now = new Date();
  const end = new Date(w.end_date);
  const daysRemaining = Math.ceil((end - now) / (1000 * 60 * 60 * 24));
  const status = w.status === 'active' && daysRemaining < 0 ? 'expired' : w.status;
  const expiringSoon = status === 'active' && daysRemaining <= 30;
  return {
    id: w.id,
    warrantyNumber: w.warranty_code,
    invoiceId: w.invoice_id,
    invoiceNumber: w.invoice_number,
    customerId: w.customer_id ?? null,
    customerName: w.customer_name,
    customerPhone: w.customer_phone,
    productId: w.product_id,
    productName: w.product_name,
    serialNumber: w.serial_number,
    startDate: w.start_date,
    endDate: w.end_date,
    durationMonths: w.duration_months,
    status,
    expiringSoon,
    daysRemaining,
    claimsCount: w.claims_count || 0,
  };
}

function mapWarrantyClaim(c) {
  return {
    id: c.id,
    claimNumber: c.claim_number,
    warrantyId: c.warranty_id,
    productName: c.product_name,
    serialNumber: c.serial_number,
    customerName: c.customer_name,
    customerPhone: c.customer_phone,
    issueDescription: c.issue_description,
    status: c.status,
    createdAt: c.created_at,
    resolution: c.resolution,
  };
}

function recalcInvoicePaymentStatus(inv) {
  inv.paid_amount = (inv.payments || []).reduce((acc, p) => acc + (Number(p.amount) || 0), 0);
  inv.balance_due = Math.max(0, (inv.grand_total || 0) - inv.paid_amount);
  inv.payment_status = inv.balance_due <= 0.001 ? 'paid' : inv.paid_amount > 0 ? 'partial' : 'unpaid';
}

export async function handleMockRequest(method, rawUrl, body = {}) {
  await delay(15);
  const { path, params } = parseQuery(rawUrl);
  const normPath = path.startsWith('/api') ? path.slice(4) : path;
  const m = method.toUpperCase();

  // 1. Auth & Current User
  if (normPath === '/auth/login') {
    return { data: { token: 'demo-token-12345', user: db.currentUser } };
  }
  if (normPath === '/auth/logout') {
    return { data: { success: true } };
  }
  if (normPath === '/auth/me') {
    return { data: db.currentUser };
  }
  if (normPath === '/presence') {
    return { data: [{ id: 1, username: 'admin', role: 'Admin', online: true, last_seen: new Date().toISOString() }] };
  }

  // 2. Settings & Setup
  if (
    normPath === '/app-settings' ||
    normPath === '/app-settings/public' ||
    normPath === '/settings/public' ||
    normPath === '/settings/app' ||
    normPath === '/settings'
  ) {
    if (m === 'PUT' || m === 'POST') {
      db.appSettings = { ...db.appSettings, ...body };
      return { data: db.appSettings };
    }
    return { data: db.appSettings };
  }

  if (normPath === '/setup/status' || normPath === '/setup') {
    return { data: { setup_completed: true, has_admin: true, server_port: 5174 } };
  }

  // 3. Analytics & Dashboard KPIs
  if (normPath === '/analytics/kpis' || normPath === '/dashboard/kpi') {
    return { data: db.finance.kpis };
  }
  if (normPath === '/analytics/daily-snapshot') {
    return { data: db.finance.snapshot };
  }
  if (normPath === '/analytics/sparkline') {
    return { data: db.finance.sparkline };
  }
  if (normPath === '/analytics/sales-timeline') {
    return { data: db.finance.timeline };
  }
  if (normPath === '/analytics/top-products') {
    return { data: db.finance.topProducts };
  }
  if (normPath === '/analytics/worst-products') {
    return { data: db.finance.topProducts.slice(3) };
  }
  if (normPath === '/analytics/top-suppliers') {
    return { data: db.suppliers.map((s) => ({ id: s.id, name: s.name, total_purchases: s.total_purchases })) };
  }
  if (normPath === '/analytics/worst-suppliers') {
    return { data: db.suppliers.slice(2) };
  }
  if (normPath === '/analytics/top-customers') {
    return { data: db.customers.map((c) => ({ id: c.id, name: c.name, total_purchases: c.total_purchases, outstanding: c.outstanding_balance })) };
  }
  if (normPath === '/analytics/at-risk-customers') {
    return { data: db.customers.filter((c) => c.outstanding_balance > 0) };
  }
  if (normPath === '/analytics/employee-performance') {
    return { data: db.finance.employeePerformance };
  }
  if (normPath === '/analytics/category-breakdown') {
    return { data: db.finance.categoryBreakdown };
  }
  if (normPath === '/analytics/peak-heatmap' || normPath === '/analytics/peak-hours') {
    return { data: db.finance.peakHours };
  }
  if (normPath === '/analytics/peak-days') {
    return { data: [{ day: 'Monday', revenue: 32000 }, { day: 'Tuesday', revenue: 29000 }, { day: 'Wednesday', revenue: 35000 }, { day: 'Thursday', revenue: 41000 }, { day: 'Saturday', revenue: 45000 }, { day: 'Sunday', revenue: 26000 }] };
  }
  if (normPath === '/analytics/peak-months') {
    return { data: [{ month: 'Aug', revenue: 184500 }, { month: 'Jul', revenue: 168000 }, { month: 'Jun', revenue: 154000 }] };
  }
  if (normPath === '/analytics/net-profit-trends') {
    return { data: db.finance.timeline };
  }
  if (normPath.startsWith('/analytics/product-seasonality/')) {
    return { data: { product_id: 1, months: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], sales: [12, 14, 18, 22, 35, 45, 60, 55, 40, 30, 25, 20] } };
  }
  if (normPath === '/forecast/reorder') {
    return { data: db.products.filter((p) => p.stock_quantity <= p.min_stock_level).map((p) => ({ variant_id: p.id, product_name: p.name, sku: p.sku, suggested_qty: p.reorder_quantity, urgency: 'high' })) };
  }
  if (normPath === '/forecast/annual-plan') {
    return { data: { months: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], target_sales: [150000, 160000, 175000, 180000, 190000, 210000, 185000, 195000, 220000, 240000, 250000, 280000] } };
  }
  if (normPath === '/forecast/recalculate') {
    return { data: { success: true } };
  }

  // 4. Products, Categories & Attributes
  if (normPath === '/products') {
    if (m === 'POST') {
      const newProd = {
        id: Date.now(),
        sku: body.sku || `SKU-${Date.now().toString().slice(-4)}`,
        name: body.name || 'New Product',
        brand: body.brand || 'General',
        category_id: Number(body.category_id) || 1,
        category_name: db.categories.find((c) => c.id === Number(body.category_id))?.name || 'General',
        cost_price: Number(body.cost_price) || 0,
        selling_price: Number(body.selling_price) || 0,
        stock_quantity: Number(body.stock_quantity) || 0,
        min_stock_level: Number(body.min_stock_level) || 10,
        unit: body.unit || 'pcs',
        is_active: true,
        variants: body.variants || [],
        ...body,
      };
      db.products.unshift(newProd);
      return { data: newProd };
    }
    let list = [...db.products];
    if (params.search || params.q) {
      const q = (params.search || params.q).toLowerCase();
      list = list.filter((p) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q));
    }
    if (params.category_id) {
      list = list.filter((p) => p.category_id === Number(params.category_id));
    }
    return { data: list, meta: { total: list.length, page: 1, limit: 50 } };
  }

  if (normPath === '/products/search') {
    let list = [];
    db.products.forEach((p) => {
      if (p.variants && p.variants.length > 0) {
        p.variants.forEach((v) => {
          list.push({
            productId: p.id,
            variantId: v.id,
            productName: p.name,
            variantName: v.name,
            sku: v.sku,
            barcode: v.barcode,
            sellingPrice: v.selling_price || p.selling_price,
            stockQty: v.stock_quantity || p.stock_quantity,
            unitLabel: p.unit,
            categoryName: p.category_name,
            attributes: Object.entries(v.attributes || {}).map(([k, val]) => ({ attributeName: k, value: val })),
          });
        });
      } else {
        list.push({
          productId: p.id,
          variantId: p.id,
          productName: p.name,
          variantName: null,
          sku: p.sku,
          barcode: p.barcode,
          sellingPrice: p.selling_price,
          stockQty: p.stock_quantity,
          unitLabel: p.unit,
          categoryName: p.category_name,
          attributes: [],
        });
      }
    });
    if (params.q) {
      const q = params.q.toLowerCase();
      list = list.filter((p) =>
        p.productName.toLowerCase().includes(q) ||
        (p.variantName && p.variantName.toLowerCase().includes(q)) ||
        p.sku.toLowerCase().includes(q) ||
        (p.barcode && p.barcode.includes(q))
      );
    }
    if (params.categoryId) {
      list = list.filter((p) => p.categoryName === db.categories.find((c) => c.id === Number(params.categoryId))?.name);
    }
    return { data: list };
  }

  if (normPath.startsWith('/products/') && !normPath.endsWith('/variants')) {
    const id = Number(normPath.split('/')[2]);
    const idx = db.products.findIndex((p) => p.id === id);
    if (m === 'DELETE') {
      if (idx !== -1) db.products.splice(idx, 1);
      return { data: { success: true } };
    }
    if (m === 'PUT') {
      if (idx !== -1) db.products[idx] = { ...db.products[idx], ...body };
      return { data: db.products[idx] || body };
    }
    const prod = db.products.find((p) => p.id === id) || db.products[0];
    return { data: prod };
  }

  if (normPath === '/categories' || normPath === '/categories/flat' || normPath === '/categories/tree') {
    if (m === 'POST') {
      const newCat = { id: Date.now(), product_count: 0, ...body };
      db.categories.push(newCat);
      return { data: newCat };
    }
    return { data: db.categories, meta: { total: db.categories.length } };
  }

  if (normPath.startsWith('/products/') && normPath.endsWith('/variants')) {
    const id = Number(normPath.split('/')[2]);
    const prod = db.products.find((p) => p.id === id) || db.products[0];
    return { data: prod?.variants || [] };
  }

  if (normPath.startsWith('/variants/barcode/') || normPath.startsWith('/variants/sku/')) {
    const code = decodeURIComponent(normPath.split('/').pop()).toLowerCase();
    for (const p of db.products) {
      if (p.barcode?.toLowerCase() === code || p.sku?.toLowerCase() === code) {
        return { data: { ...p, product: p, siblings: p.variants || [] } };
      }
      for (const v of p.variants || []) {
        if (v.barcode?.toLowerCase() === code || v.sku?.toLowerCase() === code) {
          return { data: { ...v, product: p, siblings: p.variants || [] } };
        }
      }
    }
    const defaultP = db.products[0];
    return { data: { ...defaultP, product: defaultP, siblings: defaultP.variants || [] } };
  }

  if (normPath.startsWith('/categories/')) {
    const id = Number(normPath.split('/')[2]);
    const idx = db.categories.findIndex((c) => c.id === id);
    if (m === 'PUT' && idx !== -1) {
      db.categories[idx] = { ...db.categories[idx], ...body };
      return { data: db.categories[idx] };
    }
    if (m === 'DELETE' && idx !== -1) {
      db.categories.splice(idx, 1);
      return { data: { success: true } };
    }
    return { data: db.categories.find((c) => c.id === id) || db.categories[0] };
  }

  if (normPath === '/attributes') {
    if (m === 'POST') {
      const newAttr = { id: Date.now(), options: [], ...body };
      db.attributes.push(newAttr);
      return { data: newAttr };
    }
    return { data: db.attributes, meta: { total: db.attributes.length } };
  }

  if (normPath.startsWith('/attributes/')) {
    const id = Number(normPath.split('/')[2]);
    const idx = db.attributes.findIndex((a) => a.id === id);
    if (m === 'PUT' && idx !== -1) {
      db.attributes[idx] = { ...db.attributes[idx], ...body };
      return { data: db.attributes[idx] };
    }
    if (m === 'DELETE' && idx !== -1) {
      db.attributes.splice(idx, 1);
      return { data: { success: true } };
    }
    return { data: db.attributes.find((a) => a.id === id) || db.attributes[0] };
  }

  // 5. Inventory & Stock
  if (normPath === '/stock/summary' || normPath === '/inventory/summary') {
    let rows = flattenStockRows();

    if (params.search) {
      const q = params.search.toLowerCase();
      rows = rows.filter(
        (r) =>
          r.productName.toLowerCase().includes(q) ||
          r.sku?.toLowerCase().includes(q) ||
          r.barcode?.toLowerCase().includes(q),
      );
    }
    if (params.categoryId) {
      const cat = db.categories.find((c) => c.id === Number(params.categoryId));
      if (cat) rows = rows.filter((r) => r.categoryName === cat.name);
    }
    if (params.status && params.status !== 'all') {
      rows = rows.filter((r) => r.status === params.status);
    }

    const totals = {
      totalProducts: db.products.length,
      lowStock: db.products.filter((p) => p.stock_quantity > 0 && p.stock_quantity <= p.min_stock_level).length,
      outOfStock: db.products.filter((p) => p.stock_quantity === 0).length,
      inQuarantine: 0,
      totalValueAtCost: db.products.reduce((acc, p) => acc + (p.stock_quantity || 0) * (p.cost_price || 0), 0),
    };

    const page = Number(params.page) || 1;
    const limit = Number(params.limit) || 25;
    const total = rows.length;
    const start = (page - 1) * limit;
    const pageRows = rows.slice(start, start + limit);

    return { data: pageRows, meta: { total, page, limit, totals } };
  }

  if (normPath === '/stock/movements' || normPath === '/inventory/movements') {
    return { data: db.stockMovements, meta: { total: db.stockMovements.length, page: 1, limit: 50 } };
  }

  if (normPath === '/stock/reorder-alerts' || normPath === '/inventory/alerts') {
    const alerts = db.products
      .filter((p) => p.stock_quantity <= p.min_stock_level)
      .map((p) => ({
        id: p.id,
        product_id: p.id,
        product_name: p.name,
        sku: p.sku,
        stock_quantity: p.stock_quantity,
        min_stock_level: p.min_stock_level,
        suggested_reorder: p.reorder_quantity || 50,
        status: 'pending',
      }));
    return { data: alerts, meta: { total: alerts.length } };
  }

  if (normPath === '/stock/adjustments' || normPath === '/inventory/adjustments') {
    if (m === 'POST') {
      const adj = { id: Date.now(), date: new Date().toISOString(), user: 'Admin', ...body };
      db.stockMovements.unshift({
        id: Date.now(),
        date: new Date().toISOString(),
        product_name: body.product_name || 'Manual Adjustment',
        type: 'adjustment',
        quantity: Number(body.quantity) || 0,
        reference: `ADJ-${Date.now().toString().slice(-4)} (${body.reason || 'Manual'})`,
        user: 'Admin',
      });
      return { data: adj };
    }
    return { data: [], meta: { total: 0 } };
  }

  if (normPath === '/stock/counts' || normPath === '/inventory/counts') {
    if (m === 'POST') {
      let stockRows = flattenStockRows();
      let categoryName = null;
      if (body.countType === 'category' && body.categoryId) {
        const cat = db.categories.find((c) => c.id === Number(body.categoryId));
        categoryName = cat?.name || null;
        if (cat) stockRows = stockRows.filter((r) => r.categoryName === cat.name);
      }
      const count = {
        id: Date.now(),
        count_number: `SC-2025-${String(db.stockCounts.length + 1).padStart(3, '0')}`,
        count_type: body.countType || 'full',
        category_id: body.countType === 'category' ? Number(body.categoryId) : null,
        category_name: categoryName,
        status: 'in_progress',
        initiated_by_username: db.currentUser?.full_name || 'Admin',
        initiated_at: new Date().toISOString(),
        approved_by_username: null,
        approved_at: null,
        rejection_reason: null,
        notes: body.notes || null,
        items: stockRows.map((r, i) => ({
          id: Date.now() + i,
          product_id: r.productId,
          variant_id: r.variantId,
          product_name: r.productName,
          sku: r.sku,
          system_quantity: r.stockQty,
          counted_quantity: null,
          unit_label: r.unitLabel,
          cost_price: r.costPrice,
        })),
      };
      db.stockCounts.unshift(count);
      return { data: mapCountDetail(count) };
    }

    let list = [...db.stockCounts];
    if (params.status && params.status !== 'all') {
      list = list.filter((c) => c.status === params.status);
    }
    const active = list.find((c) => c.status === 'in_progress' || c.status === 'pending_approval') || null;
    return {
      data: list.map(mapCountListRow),
      meta: { total: list.length, active: active ? mapCountListRow(active) : null },
    };
  }

  if (normPath.startsWith('/stock/counts/')) {
    const parts = normPath.split('/');
    const id = Number(parts[3]);
    const action = parts[4];
    const idx = db.stockCounts.findIndex((c) => c.id === id);
    const count = idx !== -1 ? db.stockCounts[idx] : null;

    if (action === 'items' && m === 'PUT' && count) {
      const updates = body.items || [];
      updates.forEach((u) => {
        const item = count.items.find((it) => String(it.id) === String(u.id));
        if (item) {
          item.counted_quantity = u.countedQty === '' || u.countedQty == null ? null : Number(u.countedQty);
        }
      });
      return { data: mapCountDetail(count) };
    }
    if (action === 'submit' && m === 'POST' && count) {
      count.status = 'pending_approval';
      return { data: mapCountDetail(count) };
    }
    if (action === 'approve' && m === 'PUT' && count) {
      count.status = 'approved';
      count.approved_by_username = db.currentUser?.full_name || 'Admin';
      count.approved_at = new Date().toISOString();
      count.items.forEach((it) => {
        if (it.counted_quantity == null) return;
        const product = db.products.find((p) => p.id === it.product_id);
        if (!product) return;
        if (product.variants && product.variants.length > 0) {
          const variant = product.variants.find((v) => v.id === it.variant_id);
          if (variant) variant.stock_quantity = it.counted_quantity;
          product.stock_quantity = product.variants.reduce((acc, v) => acc + (v.stock_quantity || 0), 0);
        } else {
          product.stock_quantity = it.counted_quantity;
        }
      });
      return { data: mapCountDetail(count) };
    }
    if (action === 'reject' && m === 'PUT' && count) {
      count.status = 'rejected';
      count.approved_by_username = db.currentUser?.full_name || 'Admin';
      count.rejection_reason = body.rejectionReason || 'Rejected';
      return { data: mapCountDetail(count) };
    }

    return { data: count ? mapCountDetail(count) : null };
  }

  // 6. Suppliers & Purchase Orders
  if (normPath === '/suppliers') {
    if (m === 'POST') {
      const newSup = { id: Date.now(), outstanding_balance: 0, total_purchases: 0, is_active: true, ...body };
      db.suppliers.unshift(newSup);
      return { data: newSup };
    }
    return { data: db.suppliers, meta: { total: db.suppliers.length } };
  }

  if (normPath.startsWith('/suppliers/')) {
    const parts = normPath.split('/');
    const id = Number(parts[2]);
    const subRoute = parts[3];
    const sup = db.suppliers.find((s) => s.id === id) || db.suppliers[0];

    if (subRoute === 'purchase-orders') {
      return { data: db.purchaseOrders.filter((po) => po.supplier_id === id) };
    }
    if (subRoute === 'payments') {
      return { data: [{ id: 1, date: '2025-08-25', amount: 20000, reference: 'ENBD-TXN-8819', method: 'Bank Transfer' }] };
    }
    if (subRoute === 'products') {
      return { data: db.products.slice(0, 3) };
    }
    if (subRoute === 'returns') {
      return { data: [] };
    }
    if (subRoute === 'timeline') {
      return { data: [{ date: '2025-08-28', action: 'Purchase Order Approved', reference: 'PO-2025-0035' }] };
    }

    if (m === 'PUT') {
      const idx = db.suppliers.findIndex((s) => s.id === id);
      if (idx !== -1) db.suppliers[idx] = { ...db.suppliers[idx], ...body };
      return { data: db.suppliers[idx] };
    }
    if (m === 'DELETE') {
      const idx = db.suppliers.findIndex((s) => s.id === id);
      if (idx !== -1) db.suppliers.splice(idx, 1);
      return { data: { success: true } };
    }
    return { data: sup };
  }

  if (normPath === '/purchase-orders') {
    if (m === 'POST') {
      const newPo = {
        id: Date.now(),
        po_number: `PO-2025-${Date.now().toString().slice(-4)}`,
        status: 'draft',
        payment_status: 'unpaid',
        order_date: new Date().toISOString().slice(0, 10),
        paid_amount: 0,
        balance_due: Number(body.grand_total) || 0,
        items: body.items || [],
        ...body,
      };
      db.purchaseOrders.unshift(newPo);
      return { data: newPo };
    }
    return { data: db.purchaseOrders, meta: { total: db.purchaseOrders.length } };
  }

  if (normPath.startsWith('/purchase-orders/')) {
    const id = Number(normPath.split('/')[2]);
    const po = db.purchaseOrders.find((p) => p.id === id) || db.purchaseOrders[0];
    if (m === 'PUT') {
      const idx = db.purchaseOrders.findIndex((p) => p.id === id);
      if (idx !== -1) db.purchaseOrders[idx] = { ...db.purchaseOrders[idx], ...body };
      return { data: db.purchaseOrders[idx] };
    }
    return { data: po };
  }

  // 7. Customers & Receivables
  if (normPath === '/customers/search') {
    const q = (params.q || '').toLowerCase().trim();
    let list = [...db.customers];
    if (q) {
      list = list.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          (c.phone && c.phone.includes(q)) ||
          (c.company_name && c.company_name.toLowerCase().includes(q)),
      );
    }
    const limit = Number(params.limit) || 10;
    return { data: list.slice(0, limit).map(mapCustomer) };
  }

  if (normPath === '/customers') {
    if (m === 'POST') {
      const row = customerInputToRow(body, {
        id: Date.now(),
        outstanding_balance: 0,
        total_purchases: 0,
        credit_days: 30,
        is_active: true,
        created_at: new Date().toISOString().slice(0, 10),
      });
      db.customers.unshift(row);
      return { data: mapCustomer(row) };
    }
    let list = [...db.customers];
    if (params.search || params.q) {
      const q = (params.search || params.q).toLowerCase();
      list = list.filter((c) => c.name.toLowerCase().includes(q) || (c.phone && c.phone.includes(q)));
    }
    if (params.isActive) {
      const wantActive = params.isActive === 'true';
      list = list.filter((c) => !!c.is_active === wantActive);
    }
    if (params.hasBalance === 'true') {
      list = list.filter((c) => (c.outstanding_balance || 0) > 0);
    }
    const now = new Date();
    const totals = {
      totalCustomers: db.customers.length,
      totalOutstanding: db.customers.reduce((acc, c) => acc + (c.outstanding_balance || 0), 0),
      customersWithBalance: db.customers.filter((c) => (c.outstanding_balance || 0) > 0).length,
      newThisMonth: db.customers.filter(
        (c) => c.created_at && new Date(c.created_at).getMonth() === now.getMonth() && new Date(c.created_at).getFullYear() === now.getFullYear(),
      ).length,
    };
    const page = Number(params.page) || 1;
    const limit = Number(params.limit) || 25;
    const total = list.length;
    const pageRows = list.slice((page - 1) * limit, (page - 1) * limit + limit).map(mapCustomer);
    return { data: pageRows, meta: { total, page, limit, totals } };
  }

  if (normPath === '/customers/outstanding' || normPath === '/receivables') {
    const outstanding = db.customers.filter((c) => c.outstanding_balance > 0).map(mapCustomer);
    return { data: outstanding, meta: { total: outstanding.length } };
  }

  if (normPath.startsWith('/customers/')) {
    const parts = normPath.split('/');
    const id = Number(parts[2]);
    const subRoute = parts[3];
    const idx = db.customers.findIndex((c) => c.id === id);
    const cust = idx !== -1 ? db.customers[idx] : db.customers[0];

    if (subRoute === 'invoices') {
      return { data: db.invoices.filter((inv) => inv.customer_id === id).map(mapInvoiceListRow) };
    }
    if (subRoute === 'payments') {
      const rows = db.customerPayments
        .filter((p) => p.customer_id === id)
        .map((p) => ({
          id: p.id,
          amount: p.amount,
          paymentMethod: p.payment_method,
          paymentDate: p.payment_date,
          employeeUsername: p.employee_username,
          notes: p.notes || null,
          createdAt: p.created_at,
        }))
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      if (m === 'POST') {
        const payment = {
          id: Date.now(),
          customer_id: id,
          amount: Number(body.amount) || 0,
          payment_method: body.paymentMethod || 'cash',
          payment_date: body.paymentDate || new Date().toISOString().slice(0, 10),
          employee_username: db.currentUser?.full_name || 'Admin',
          notes: body.notes || null,
          created_at: new Date().toISOString(),
        };
        db.customerPayments.unshift(payment);
        if (cust) cust.outstanding_balance = Math.max(0, (cust.outstanding_balance || 0) - payment.amount);
        return { data: { id: payment.id, amount: payment.amount, paymentMethod: payment.payment_method, paymentDate: payment.payment_date, employeeUsername: payment.employee_username, notes: payment.notes, createdAt: payment.created_at } };
      }
      const totalCollected = rows.reduce((acc, r) => acc + r.amount, 0);
      return { data: rows, meta: { total: rows.length, totals: { totalCollected } } };
    }
    if (subRoute === 'warranties') {
      return { data: db.warranties.filter((w) => w.customer_name === cust.name).map(mapWarranty) };
    }
    if (subRoute === 'returns') {
      const orders = db.returnOrders.filter((o) => o.customerId === id);
      const totalSpent = db.invoices.filter((inv) => inv.customer_id === id && inv.status !== 'cancelled').reduce((acc, inv) => acc + (inv.grand_total || 0), 0);
      const totalReturned = orders.reduce((acc, o) => acc + (o.totalValue || 0), 0);
      return {
        data: {
          items: orders.map((o) => ({
            id: o.returnRequestId || o.id,
            requestNumber: o.requestNumber,
            returnType: o.returnType,
            itemCount: o.items?.length || 0,
            totalValue: o.totalValue,
            invoiceNumber: o.originalInvoiceNumber,
            noInvoiceReturn: !o.originalInvoiceId,
            status: 'approved',
            requestedAt: o.createdAt,
          })),
          stats: {
            totalSpent,
            totalReturned,
            returnRate: totalSpent > 0 ? (totalReturned / totalSpent) * 100 : 0,
          },
        },
      };
    }
    if (subRoute === 'timeline') {
      const events = [];
      db.invoices.filter((inv) => inv.customer_id === id).forEach((inv) => {
        events.push({ event: 'invoice_created', at: inv.date, referenceId: inv.id, label: inv.invoice_number, amount: inv.grand_total, employeeUsername: inv.cashier_name, status: inv.status });
      });
      db.customerPayments.filter((p) => p.customer_id === id).forEach((p) => {
        events.push({ event: 'payment_collected', at: p.created_at, referenceId: p.id, label: p.payment_method, amount: p.amount, employeeUsername: p.employee_username });
      });
      db.returnOrders.filter((o) => o.customerId === id).forEach((o) => {
        events.push({ event: 'return_processed', at: o.createdAt, referenceId: o.id, label: o.returnOrderNumber, amount: o.refundTotal, employeeUsername: o.employeeUsername });
      });
      db.warranties.filter((w) => w.customer_name === cust.name).forEach((w) => {
        events.push({ event: 'warranty_created', at: w.start_date, referenceId: w.id, label: w.product_name });
      });
      events.sort((a, b) => new Date(b.at) - new Date(a.at));
      return { data: events };
    }
    if (subRoute === 'statement') {
      return { data: { customer: mapCustomer(cust), transactions: db.invoices.filter((inv) => inv.customer_id === id).map(mapInvoiceListRow) } };
    }

    if (m === 'PUT') {
      if (idx !== -1) db.customers[idx] = customerInputToRow(body, db.customers[idx]);
      return { data: mapCustomer(db.customers[idx] || cust) };
    }
    if (m === 'DELETE') {
      if (idx !== -1) db.customers[idx].is_active = false;
      return { data: { success: true } };
    }
    return { data: mapCustomer(cust) };
  }

  if (normPath.startsWith('/customer-payments/')) {
    const id = Number(normPath.split('/')[2]);
    if (m === 'DELETE') {
      const idx = db.customerPayments.findIndex((p) => p.id === id);
      if (idx !== -1) {
        const [payment] = db.customerPayments.splice(idx, 1);
        const cust = db.customers.find((c) => c.id === payment.customer_id);
        if (cust) cust.outstanding_balance = (cust.outstanding_balance || 0) + payment.amount;
      }
      return { data: { success: true } };
    }
    return { data: { success: true } };
  }

  // 8. Invoices & POS
  if (normPath === '/invoices') {
    if (m === 'POST') {
      const customer = body.customerId ? db.customers.find((c) => c.id === Number(body.customerId)) : null;
      const items = (body.items || []).map((it, i) => {
        const { product, variant } = findProductAndVariant(it.variantId);
        const qty = Number(it.quantity) || 0;
        const unitPrice = Number(it.unitPrice) || 0;
        const discount = Number(it.discountAmount) || 0;
        return {
          id: Date.now() + i,
          product_id: product?.id ?? null,
          variant_id: it.variantId ?? null,
          product_name: variant?.name ? `${product.name} — ${variant.name}` : product?.name || 'Item',
          quantity: qty,
          unit_price: unitPrice,
          discount,
          vat_rate: 5,
          line_total: qty * unitPrice - discount,
          serial_number: it.serialNumber || null,
        };
      });
      const subtotal = items.reduce((acc, it) => acc + it.quantity * it.unit_price, 0);
      const invoiceDiscount = Number(body.invoiceDiscount) || 0;
      const discountTotal = items.reduce((acc, it) => acc + it.discount, 0) + invoiceDiscount;
      const taxableAmount = Math.max(0, subtotal - discountTotal);
      const vatTotal = Math.round(taxableAmount * 0.05 * 100) / 100;
      const grandTotal = Math.round((taxableAmount + vatTotal) * 100) / 100;

      const newInv = {
        id: Date.now(),
        invoice_number: `INV-2025-${(db.invoices.length + 90).toString().padStart(4, '0')}`,
        date: new Date().toISOString(),
        user_id: db.currentUser.id,
        cashier_name: db.currentUser.full_name,
        customer_id: customer?.id || null,
        customer_name: customer?.name || 'Walk-in Cash Customer',
        pc_identifier: body.pcIdentifier || null,
        subtotal,
        discount_total: discountTotal,
        invoice_discount: invoiceDiscount,
        taxable_amount: taxableAmount,
        vat_total: vatTotal,
        grand_total: grandTotal,
        paid_amount: 0,
        balance_due: grandTotal,
        payment_status: 'unpaid',
        payment_method: null,
        status: 'draft',
        notes: body.notes || null,
        items,
        payments: [],
        history: [
          { id: Date.now() + 999, action: 'created', timestamp: new Date().toISOString(), performedByUsername: db.currentUser?.full_name || 'Admin', notes: null },
        ],
      };
      db.invoices.unshift(newInv);

      // Decrement stock in memory
      items.forEach((item) => {
        const { product, variant } = findProductAndVariant(item.variant_id);
        if (variant) {
          variant.stock_quantity = Math.max(0, (variant.stock_quantity || 0) - item.quantity);
          if (product?.variants) {
            product.stock_quantity = product.variants.reduce((acc, v) => acc + (v.stock_quantity || 0), 0);
          }
        } else if (product) {
          product.stock_quantity = Math.max(0, (product.stock_quantity || 0) - item.quantity);
        }
      });

      return { data: { id: newInv.id, invoiceNumber: newInv.invoice_number, ...mapInvoiceDetail(newInv).invoice } };
    }

    let list = [...db.invoices];
    if (params.search) {
      const q = params.search.toLowerCase();
      list = list.filter(
        (inv) =>
          inv.invoice_number.toLowerCase().includes(q) ||
          (inv.customer_name || '').toLowerCase().includes(q),
      );
    }
    if (params.status) list = list.filter((inv) => inv.status === params.status);
    if (params.paymentStatus) list = list.filter((inv) => inv.payment_status === params.paymentStatus);
    if (params.dateFrom) list = list.filter((inv) => inv.date.slice(0, 10) >= params.dateFrom);
    if (params.dateTo) list = list.filter((inv) => inv.date.slice(0, 10) <= params.dateTo);
    list.sort((a, b) => new Date(b.date) - new Date(a.date));

    const today = new Date().toISOString().slice(0, 10);
    const now = new Date();
    const todayInvoices = db.invoices.filter((inv) => inv.date.slice(0, 10) === today && inv.status !== 'cancelled');
    const monthInvoices = db.invoices.filter(
      (inv) => new Date(inv.date).getMonth() === now.getMonth() && new Date(inv.date).getFullYear() === now.getFullYear() && inv.status !== 'cancelled',
    );
    const totals = {
      revenueToday: todayInvoices.reduce((acc, inv) => acc + (inv.grand_total || 0), 0),
      invoicesToday: todayInvoices.length,
      outstanding: db.invoices.reduce((acc, inv) => acc + (inv.balance_due || 0), 0),
      revenueMonth: monthInvoices.reduce((acc, inv) => acc + (inv.grand_total || 0), 0),
    };

    const page = Number(params.page) || 1;
    const limit = Number(params.limit) || 25;
    const total = list.length;
    const pageRows = list.slice((page - 1) * limit, (page - 1) * limit + limit).map(mapInvoiceListRow);
    return { data: pageRows, meta: { total, page, limit, totals } };
  }

  if (normPath === '/invoices/next-number') {
    const n = db.invoices.length + 91;
    return { data: { invoiceNumber: `INV-2025-${String(n).padStart(4, '0')}` } };
  }

  if (normPath.startsWith('/invoices/')) {
    const parts = normPath.split('/');
    const id = Number(parts[2]);
    const action = parts[3];
    const inv = db.invoices.find((i) => i.id === id) || db.invoices[0];

    if (action === 'confirm' && m === 'POST') {
      inv.status = 'confirmed';
      inv.confirmed_at = new Date().toISOString();
      inv.history = inv.history || [];
      inv.history.push({ id: Date.now(), action: 'confirmed', timestamp: inv.confirmed_at, performedByUsername: db.currentUser?.full_name || 'Admin', notes: null });
      return { data: mapInvoiceDetail(inv) };
    }

    if (action === 'cancel' && m === 'POST') {
      if (inv.status !== 'cancelled') {
        // Return items to stock.
        (inv.items || []).forEach((item) => {
          const { product, variant } = findProductAndVariant(item.variant_id);
          if (variant) {
            variant.stock_quantity = (variant.stock_quantity || 0) + item.quantity;
            if (product?.variants) {
              product.stock_quantity = product.variants.reduce((acc, v) => acc + (v.stock_quantity || 0), 0);
            }
          } else if (product) {
            product.stock_quantity = (product.stock_quantity || 0) + item.quantity;
          }
        });
        if (inv.customer_id) {
          const cust = db.customers.find((c) => c.id === inv.customer_id);
          if (cust) cust.outstanding_balance = Math.max(0, (cust.outstanding_balance || 0) - (inv.balance_due || 0));
        }
      }
      inv.status = 'cancelled';
      inv.history = inv.history || [];
      inv.history.push({ id: Date.now(), action: 'cancelled', timestamp: new Date().toISOString(), performedByUsername: db.currentUser?.full_name || 'Admin', notes: body?.reason || null });
      return { data: mapInvoiceDetail(inv) };
    }

    if (action === 'payments' && m === 'POST') {
      const payment = {
        id: Date.now(),
        amount: Number(body.amount) || 0,
        method: body.method || 'cash',
        reference: body.reference || null,
        notes: body.notes || null,
        date: new Date().toISOString(),
      };
      inv.payments = inv.payments || [];
      inv.payments.push(payment);
      recalcInvoicePaymentStatus(inv);
      inv.history = inv.history || [];
      inv.history.push({ id: Date.now() + 1, action: 'payment_added', timestamp: payment.date, performedByUsername: db.currentUser?.full_name || 'Admin', notes: `${payment.method}: ${payment.amount}` });
      return { data: mapInvoiceDetail(inv) };
    }
    if (action === 'payments' && m === 'GET') {
      return { data: mapInvoiceDetail(inv).payments };
    }

    if (action === 'items' && m === 'PUT') {
      return { data: mapInvoiceDetail(inv) };
    }

    if (action === 'edit-request' && m === 'POST') {
      const req = {
        id: Date.now(),
        invoiceId: id,
        invoiceNumber: inv.invoice_number,
        customerName: inv.customer_name,
        status: 'pending',
        requestNote: body.requestNote || '',
        changes: body.changes || {},
        requestedByUsername: db.currentUser?.full_name || 'Admin',
        requestedAt: new Date().toISOString(),
        reviewedByUsername: null,
        reviewedAt: null,
        rejectionReason: null,
      };
      db.invoiceEditRequests.unshift(req);
      return { data: req };
    }
    if (action === 'edit-requests' && m === 'GET') {
      return { data: db.invoiceEditRequests.filter((r) => r.invoiceId === id) };
    }

    if (action === 'edit-request' && parts[4] && parts[5] === 'approve' && m === 'PUT') {
      const reqId = Number(parts[4]);
      const req = db.invoiceEditRequests.find((r) => r.id === reqId);
      if (req) {
        req.status = 'approved';
        req.reviewedByUsername = db.currentUser?.full_name || 'Admin';
        req.reviewedAt = new Date().toISOString();
        const changes = req.changes || {};
        if (Array.isArray(changes.items)) {
          changes.items.forEach((ch) => {
            const item = inv.items.find((it) => it.variant_id === ch.variant_id);
            if (item) {
              if (ch.quantity != null) item.quantity = Number(ch.quantity);
              if (ch.unit_price != null) item.unit_price = Number(ch.unit_price);
              if (ch.discount_amount != null) item.discount = Number(ch.discount_amount);
              item.line_total = item.quantity * item.unit_price - item.discount;
            }
          });
        }
        if (changes.invoiceDiscount != null) inv.invoice_discount = Number(changes.invoiceDiscount);
        inv.subtotal = inv.items.reduce((acc, it) => acc + it.quantity * it.unit_price, 0);
        inv.discount_total = inv.items.reduce((acc, it) => acc + (it.discount || 0), 0) + (inv.invoice_discount || 0);
        inv.taxable_amount = Math.max(0, inv.subtotal - inv.discount_total);
        inv.vat_total = Math.round(inv.taxable_amount * 0.05 * 100) / 100;
        inv.grand_total = Math.round((inv.taxable_amount + inv.vat_total) * 100) / 100;
        recalcInvoicePaymentStatus(inv);
      }
      return { data: req || null };
    }
    if (action === 'edit-request' && parts[4] && parts[5] === 'reject' && m === 'PUT') {
      const reqId = Number(parts[4]);
      const req = db.invoiceEditRequests.find((r) => r.id === reqId);
      if (req) {
        req.status = 'rejected';
        req.reviewedByUsername = db.currentUser?.full_name || 'Admin';
        req.reviewedAt = new Date().toISOString();
        req.rejectionReason = body.reason || 'Rejected';
      }
      return { data: req || null };
    }

    if (action === 'void' && m === 'POST') {
      inv.status = 'cancelled';
      return { data: { success: true, invoice: mapInvoiceDetail(inv).invoice } };
    }

    return { data: mapInvoiceDetail(inv) };
  }

  if (normPath === '/invoice-edit-requests' || normPath === '/invoices/edit-requests') {
    let list = [...db.invoiceEditRequests];
    if (params.status) list = list.filter((r) => r.status === params.status);
    list.sort((a, b) => new Date(b.requestedAt) - new Date(a.requestedAt));
    const pendingTotal = db.invoiceEditRequests.filter((r) => r.status === 'pending').length;
    return { data: list, meta: { total: list.length, totals: { pending: pendingTotal } } };
  }

  // 9. Warranties & Claims
  if (normPath === '/warranties') {
    if (m === 'POST') {
      const newWar = { id: Date.now(), warranty_code: `WAR-2025-${Date.now().toString().slice(-4)}`, status: 'active', ...body };
      db.warranties.unshift(newWar);
      return { data: newWar };
    }
    return { data: db.warranties, meta: { total: db.warranties.length } };
  }

  if (normPath === '/warranties/lookup') {
    const q = (params.q || '').toLowerCase();
    const match = db.warranties.filter((w) =>
      w.serial_number.toLowerCase().includes(q) ||
      w.warranty_code.toLowerCase().includes(q) ||
      w.customer_phone.includes(q)
    );
    return { data: match };
  }

  if (normPath.startsWith('/warranties/')) {
    const id = Number(normPath.split('/')[2]);
    return { data: db.warranties.find((w) => w.id === id) || db.warranties[0] };
  }

  if (normPath === '/warranty-claims') {
    if (m === 'POST') {
      const newClaim = { id: Date.now(), claim_number: `CLM-2025-${Date.now().toString().slice(-4)}`, status: 'under_inspection', created_at: new Date().toISOString(), ...body };
      db.warrantyClaims.unshift(newClaim);
      return { data: newClaim };
    }
    return { data: db.warrantyClaims, meta: { total: db.warrantyClaims.length } };
  }

  if (normPath.startsWith('/warranty-claims/')) {
    const id = Number(normPath.split('/')[2]);
    return { data: db.warrantyClaims.find((c) => c.id === id) || db.warrantyClaims[0] };
  }

  // 10. Returns
  if (normPath === '/return-requests') {
    if (m === 'POST') {
      const items = (body.items || []).map((it, i) => ({
        id: Date.now() + i,
        invoiceItemId: it.invoiceItemId ?? null,
        productId: it.productId ?? null,
        variantId: it.variantId ?? null,
        productName: it.productName || 'Item',
        unitLabel: it.unitLabel || 'pcs',
        unitPrice: Number(it.unitPrice) || 0,
        quantity: Number(it.quantity) || 0,
        condition: it.condition || 'good',
        serialNumber: it.serialNumber || null,
        totalValue: (Number(it.unitPrice) || 0) * (Number(it.quantity) || 0),
      }));
      const totalValue = items.reduce((acc, it) => acc + it.totalValue, 0);
      let customerName = null;
      let customerPhone = null;
      if (body.customerId) {
        const cust = db.customers.find((c) => c.id === Number(body.customerId));
        customerName = cust?.name || null;
        customerPhone = cust?.phone || null;
      }
      const invoice = body.referenceId ? db.invoices.find((i) => i.id === Number(body.referenceId)) : null;
      const now = new Date().toISOString();
      const req = {
        id: Date.now(),
        requestNumber: `RET-REQ-2025-${String(db.returnRequests.length + 31).padStart(4, '0')}`,
        returnType: body.returnType || 'customer_refund',
        status: 'pending',
        referenceType: body.referenceType || 'manual',
        referenceId: body.referenceId || null,
        invoiceNumber: invoice?.invoice_number || null,
        customerId: body.customerId || invoice?.customer_id || null,
        customerName: customerName || invoice?.customer_name || (body.noInvoiceReturn ? 'Walk-in customer (no invoice)' : null),
        customerPhone,
        supplierId: body.supplierId || null,
        supplierName: null,
        noInvoiceReturn: !!body.noInvoiceReturn,
        reason: body.reason || 'other',
        requestNote: body.requestNote || '',
        items,
        totalValue,
        itemCount: items.length,
        refundPlan: body.refundPlan || null,
        replacementPlan: body.replacementPlan || null,
        requestedAt: now,
        requestedBy: db.currentUser?.id || null,
        requestedByUsername: db.currentUser?.full_name || 'Admin',
        reviewedAt: null,
        reviewedByUsername: null,
        rejectionReason: null,
        approvedBy: body.approvedBy || null,
        history: [
          { id: Date.now() + 999, action: 'submitted', timestamp: now, performedByUsername: db.currentUser?.full_name || 'Admin', notes: null },
        ],
        order: null,
      };
      db.returnRequests.unshift(req);
      return { data: req };
    }

    let list = [...db.returnRequests];
    if (params.return_type) list = list.filter((r) => r.returnType === params.return_type);
    if (params.status) list = list.filter((r) => r.status === params.status);
    if (params.search) {
      const q = params.search.toLowerCase();
      list = list.filter(
        (r) =>
          r.requestNumber.toLowerCase().includes(q) ||
          r.invoiceNumber?.toLowerCase().includes(q) ||
          r.customerName?.toLowerCase().includes(q) ||
          r.supplierName?.toLowerCase().includes(q),
      );
    }
    list.sort((a, b) => new Date(b.requestedAt) - new Date(a.requestedAt));
    const page = Number(params.page) || 1;
    const limit = Number(params.limit) || 20;
    const total = list.length;
    const pageRows = list.slice((page - 1) * limit, (page - 1) * limit + limit);
    return { data: pageRows, meta: { total, page, limit } };
  }

  if (normPath === '/return-requests/summary') {
    const now = new Date();
    const pending = db.returnRequests.filter((r) => r.status === 'pending');
    return {
      data: {
        pending_count: pending.length,
        pending_no_invoice: pending.filter((r) => r.noInvoiceReturn).length,
        approved_this_month: db.returnRequests.filter(
          (r) =>
            r.status === 'approved' &&
            r.reviewedAt &&
            new Date(r.reviewedAt).getMonth() === now.getMonth() &&
            new Date(r.reviewedAt).getFullYear() === now.getFullYear(),
        ).length,
        rejected_count: db.returnRequests.filter((r) => r.status === 'rejected').length,
      },
    };
  }

  if (normPath === '/return-requests/lookup') {
    const q = (params.q || '').toLowerCase().trim();
    if (q.length < 2) return { data: [] };
    const results = db.invoices
      .filter((inv) => {
        const cust = db.customers.find((c) => c.id === inv.customer_id);
        return (
          inv.invoice_number.toLowerCase().includes(q) ||
          inv.customer_name.toLowerCase().includes(q) ||
          (cust?.phone || '').toLowerCase().includes(q) ||
          inv.items.some((it) => it.product_name.toLowerCase().includes(q))
        );
      })
      .map((inv) => {
        const cust = db.customers.find((c) => c.id === inv.customer_id);
        const hasReturn = db.returnRequests.some(
          (r) => r.referenceId === inv.id && r.status !== 'rejected' && r.status !== 'cancelled',
        );
        return {
          id: inv.id,
          invoiceNumber: inv.invoice_number,
          createdAt: inv.date,
          customerId: inv.customer_id,
          customerName: inv.customer_name,
          customerPhone: cust?.phone || null,
          total: inv.grand_total,
          hasReturn,
          items: inv.items.map((it) => ({
            id: it.id,
            productId: it.product_id,
            variantId: it.variant_id,
            productName: it.product_name,
            unitLabel: db.products.find((p) => p.id === it.product_id)?.unit || 'pcs',
            unitPrice: it.unit_price,
          })),
        };
      });
    return { data: results };
  }

  if (normPath.startsWith('/return-requests/')) {
    const parts = normPath.split('/');
    const id = Number(parts[2]);
    const action = parts[3];
    const idx = db.returnRequests.findIndex((r) => r.id === id);
    const reqRow = idx !== -1 ? db.returnRequests[idx] : null;

    if (action === 'approve' && m === 'PUT' && reqRow) {
      const now = new Date().toISOString();
      reqRow.status = 'approved';
      reqRow.reviewedAt = now;
      reqRow.reviewedByUsername = db.currentUser?.full_name || 'Admin';
      reqRow.history.push({
        id: Date.now(),
        action: 'approved',
        timestamp: now,
        performedByUsername: db.currentUser?.full_name || 'Admin',
        notes: body.notes || null,
      });

      const CONDITION_ACTION = { good: 'returned_to_stock', damaged: 'quarantined', defective: 'disposed' };
      const orderItems = reqRow.items.map((it) => {
        const stockAction = CONDITION_ACTION[it.condition] || 'quarantined';
        if (reqRow.returnType !== 'supplier_return') {
          const product = db.products.find((p) => p.id === it.productId);
          if (product && stockAction === 'returned_to_stock') {
            if (it.variantId && product.variants?.length) {
              const variant = product.variants.find((v) => v.id === it.variantId);
              if (variant) variant.stock_quantity = (variant.stock_quantity || 0) + it.quantity;
              product.stock_quantity = product.variants.reduce((acc, v) => acc + (v.stock_quantity || 0), 0);
            } else {
              product.stock_quantity = (product.stock_quantity || 0) + it.quantity;
            }
          }
        }
        return {
          id: Date.now() + it.id,
          productId: it.productId,
          variantId: it.variantId,
          productName: it.productName,
          unitLabel: it.unitLabel,
          quantity: it.quantity,
          unitPrice: it.unitPrice,
          condition: it.condition,
          stockAction,
          serialNumber: it.serialNumber,
          totalValue: it.totalValue,
        };
      });

      const refundTotal = (reqRow.refundPlan || []).reduce((acc, p) => acc + (Number(p.amount) || 0), 0);
      const order = {
        id: Date.now(),
        returnOrderNumber: `RO-2025-${String(db.returnOrders.length + 21).padStart(4, '0')}`,
        returnRequestId: reqRow.id,
        requestNumber: reqRow.requestNumber,
        returnType: reqRow.returnType,
        status: 'completed',
        customerId: reqRow.customerId,
        customerName: reqRow.customerName,
        supplierId: reqRow.supplierId,
        supplierName: reqRow.supplierName,
        originalInvoiceId: reqRow.referenceId,
        originalInvoiceNumber: reqRow.invoiceNumber,
        replacementInvoiceId: null,
        replacementInvoiceNumber: null,
        totalValue: reqRow.totalValue,
        refundTotal,
        items: orderItems,
        refundPayments: (reqRow.refundPlan || []).map((p, i) => ({ id: Date.now() + i, method: p.method, amount: Number(p.amount) || 0, notes: p.notes || null })),
        notes: reqRow.requestNote || null,
        createdAt: now,
        employeeUsername: db.currentUser?.full_name || 'Admin',
      };
      db.returnOrders.unshift(order);
      reqRow.order = { id: order.id, returnOrderNumber: order.returnOrderNumber, createdAt: order.createdAt, refundTotal: order.refundTotal, replacementInvoiceId: null };

      // Customer refunded via store credit gets it added to their balance.
      if (reqRow.customerId) {
        const cust = db.customers.find((c) => c.id === reqRow.customerId);
        const creditAmount = (reqRow.refundPlan || []).filter((p) => p.method === 'credit').reduce((acc, p) => acc + (Number(p.amount) || 0), 0);
        if (cust && creditAmount > 0) cust.outstanding_balance = (cust.outstanding_balance || 0) - creditAmount;
      }

      return { data: reqRow };
    }

    if (action === 'reject' && m === 'PUT' && reqRow) {
      const now = new Date().toISOString();
      reqRow.status = 'rejected';
      reqRow.reviewedAt = now;
      reqRow.reviewedByUsername = db.currentUser?.full_name || 'Admin';
      reqRow.rejectionReason = body.rejectionReason || 'Rejected';
      reqRow.history.push({
        id: Date.now(),
        action: 'rejected',
        timestamp: now,
        performedByUsername: db.currentUser?.full_name || 'Admin',
        notes: body.rejectionReason || null,
      });
      return { data: reqRow };
    }

    if (action === 'cancel' && m === 'PUT' && reqRow) {
      const now = new Date().toISOString();
      reqRow.status = 'cancelled';
      reqRow.history.push({
        id: Date.now(),
        action: 'cancelled',
        timestamp: now,
        performedByUsername: db.currentUser?.full_name || 'Admin',
        notes: null,
      });
      return { data: reqRow };
    }

    return { data: reqRow || null };
  }

  if (normPath === '/return-orders') {
    let list = [...db.returnOrders];
    if (params.return_type) list = list.filter((o) => o.returnType === params.return_type);
    if (params.search) {
      const q = params.search.toLowerCase();
      list = list.filter(
        (o) =>
          o.returnOrderNumber.toLowerCase().includes(q) ||
          o.originalInvoiceNumber?.toLowerCase().includes(q) ||
          o.customerName?.toLowerCase().includes(q) ||
          o.supplierName?.toLowerCase().includes(q),
      );
    }
    list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const page = Number(params.page) || 1;
    const limit = Number(params.limit) || 20;
    const total = list.length;
    const pageRows = list.slice((page - 1) * limit, (page - 1) * limit + limit);
    return { data: pageRows, meta: { total, page, limit } };
  }

  if (normPath === '/return-orders/summary') {
    const now = new Date();
    const thisMonth = db.returnOrders.filter(
      (o) => new Date(o.createdAt).getMonth() === now.getMonth() && new Date(o.createdAt).getFullYear() === now.getFullYear(),
    );
    return {
      data: {
        total: db.returnOrders.length,
        thisMonth: thisMonth.length,
        totalValue: db.returnOrders.reduce((acc, o) => acc + (o.totalValue || 0), 0),
        totalRefunded: db.returnOrders.reduce((acc, o) => acc + (o.refundTotal || 0), 0),
      },
    };
  }

  if (normPath.startsWith('/return-orders/')) {
    const id = Number(normPath.split('/')[2]);
    return { data: db.returnOrders.find((o) => o.id === id) || null };
  }

  if (normPath.startsWith('/customers/') && normPath.endsWith('/returns')) {
    const customerId = Number(normPath.split('/')[2]);
    return { data: db.returnOrders.filter((o) => o.customerId === customerId) };
  }

  if (normPath.startsWith('/suppliers/') && normPath.endsWith('/returns')) {
    const supplierId = Number(normPath.split('/')[2]);
    return { data: db.returnOrders.filter((o) => o.supplierId === supplierId) };
  }

  // 11. Treasury & Cash Drawer
  if (normPath === '/treasury/summary' || normPath === '/treasury') {
    return {
      data: {
        cash_in_drawer: db.treasury.cashDrawer.current_cash,
        bank_accounts_total: db.treasury.bankAccounts.reduce((acc, b) => acc + b.balance, 0),
        net_cash_position: db.treasury.cashDrawer.current_cash + db.treasury.bankAccounts.reduce((acc, b) => acc + b.balance, 0),
      }
    };
  }

  if (normPath === '/treasury/cash-drawer' || normPath === '/cash-drawer') {
    if (m === 'POST') {
      db.treasury.cashDrawer = { ...db.treasury.cashDrawer, ...body };
      return { data: db.treasury.cashDrawer };
    }
    return { data: db.treasury.cashDrawer };
  }

  if (normPath === '/treasury/transactions' || normPath === '/cash-drawer/transactions') {
    return { data: db.treasury.cashTransactions, meta: { total: db.treasury.cashTransactions.length } };
  }

  if (normPath === '/bank-accounts') {
    if (m === 'POST') {
      const newAcc = { id: Date.now(), balance: Number(body.balance) || 0, ...body };
      db.treasury.bankAccounts.push(newAcc);
      return { data: newAcc };
    }
    return { data: db.treasury.bankAccounts, meta: { total: db.treasury.bankAccounts.length } };
  }

  if (normPath.startsWith('/bank-accounts/')) {
    const id = Number(normPath.split('/')[2]);
    return { data: db.treasury.bankAccounts.find((b) => b.id === id) || db.treasury.bankAccounts[0] };
  }

  // 12. Attendance & HR
  if (normPath === '/attendance/today') {
    return { data: db.attendance.today };
  }
  if (normPath === '/attendance/corrections') {
    return {
      data: [
        { id: 1, employee_id: 3, employee_name: 'Zayd Khan', date: '2025-08-28', original_in: '08:30 AM', original_out: '05:00 PM', corrected_in: '08:00 AM', corrected_out: '05:00 PM', reason: 'Biometric device offline during morning rush', status: 'pending' }
      ],
      meta: { total: 1 }
    };
  }
  if (normPath === '/attendance/monthly') {
    return {
      data: {
        summary: { total_days: 26, present: 25, absent: 0, late: 1, total_hours: 198.5 },
        days: [
          { date: '2025-08-01', status: 'present', in: '08:00 AM', out: '05:00 PM', hours: 8 },
          { date: '2025-08-02', status: 'present', in: '08:00 AM', out: '05:00 PM', hours: 8 },
          { date: '2025-08-03', status: 'present', in: '08:15 AM', out: '05:00 PM', hours: 7.75 },
          { date: '2025-08-04', status: 'present', in: '08:00 AM', out: '05:00 PM', hours: 8 },
          { date: '2025-08-05', status: 'present', in: '08:00 AM', out: '05:00 PM', hours: 8 },
        ]
      }
    };
  }
  if (normPath === '/attendance') {
    return { data: db.attendance.today, meta: { total: db.attendance.today.length } };
  }
  if (normPath === '/leave-balances') {
    return {
      data: db.employees.map((e) => ({
        employee_id: e.id,
        employee_name: e.name,
        annual_total: e.annual_leave_days || 30,
        annual_used: 10,
        annual_remaining: (e.annual_leave_days || 30) - 10,
        sick_total: e.sick_leave_days || 15,
        sick_used: 2,
        sick_remaining: (e.sick_leave_days || 15) - 2,
      }))
    };
  }
  if (normPath === '/attendance/check-in' || normPath === '/attendance/check-out') {
    const rec = db.attendance.today.find((a) => a.employee_id === db.currentUser.id) || db.attendance.today[0];
    if (normPath.endsWith('check-in')) {
      rec.status = 'present';
      rec.check_in = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else {
      rec.check_out = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return { data: rec };
  }
  if (normPath === '/attendance/leaves' || normPath === '/leaves') {
    if (m === 'POST') {
      const newLeave = { id: Date.now(), status: 'pending', ...body };
      db.attendance.leaves.push(newLeave);
      return { data: newLeave };
    }
    return { data: db.attendance.leaves, meta: { total: db.attendance.leaves.length } };
  }
  if (normPath === '/attendance/holidays' || normPath === '/holidays') {
    if (m === 'POST') {
      const newHol = { id: Date.now(), ...body };
      db.attendance.holidays.push(newHol);
      return { data: newHol };
    }
    return { data: db.attendance.holidays };
  }

  // 13. Bills & Expenses
  if (normPath === '/bills') {
    if (m === 'POST') {
      const newBill = { id: Date.now(), bill_number: `BILL-2025-${Date.now().toString().slice(-4)}`, status: 'pending', ...body };
      db.bills.unshift(newBill);
      return { data: newBill };
    }
    return { data: db.bills, meta: { total: db.bills.length } };
  }
  if (normPath.startsWith('/bills/')) {
    const id = Number(normPath.split('/')[2]);
    return { data: db.bills.find((b) => b.id === id) || db.bills[0] };
  }
  if (normPath === '/expenses') {
    if (m === 'POST') {
      const newExp = { id: Date.now(), date: new Date().toISOString().slice(0, 10), user: db.currentUser.username, ...body };
      db.expenses.unshift(newExp);
      return { data: newExp };
    }
    return { data: db.expenses, meta: { total: db.expenses.length } };
  }
  if (normPath === '/expenses/summary') {
    return {
      data: {
        total_expenses: db.expenses.reduce((acc, e) => acc + (e.amount || 0), 0) + db.bills.reduce((acc, b) => acc + (b.amount || 0), 0),
        pending_bills: db.bills.filter((b) => b.status === 'pending').reduce((acc, b) => acc + (b.amount || 0), 0),
      }
    };
  }

  // 14. Finance & Accounting
  if (normPath === '/finance/dashboard' || normPath === '/finance/summary') {
    return {
      data: {
        periodStart: '2025-08-01',
        periodEnd: '2025-08-31',
        revenue: { mtd: 184500.0, delta: 12.4 },
        expenses: { mtd: 48800.0, delta: -3.2 },
        netProfit: { mtd: 34100.0, delta: 18.5 },
        cash: 352350.0,
        receivables: 51150.0,
        payables: 133950.0,
        vatPayable: 5015.0,
        vatDaysLeft: 20,
        kpis: db.finance.kpis,
      }
    };
  }

  if (normPath === '/finance/pl') {
    return {
      data: {
        revenue: {
          total: 184500.0,
          lines: [{ code: '4010', name: 'Sales Revenue - Electrical Wholesale & Retail', amount: 184500.0 }]
        },
        cogs: {
          total: 132200.0,
        },
        grossProfit: 52300.0,
        grossMargin: 28.3,
        expenses: {
          total: 18200.0,
          lines: [
            { code: '6010', name: 'Salaries & Staff Benefits', amount: 12500.0 },
            { code: '6020', name: 'Commercial Showroom Rent', amount: 3860.0 },
            { code: '6030', name: 'Utilities (DEWA Electricity & Water)', amount: 1840.0 }
          ]
        },
        netProfit: 34100.0,
        netMargin: 18.5,
      }
    };
  }

  if (normPath === '/finance/balance-sheet') {
    return {
      data: {
        asOfDate: '2025-08-31',
        assets: {
          cash: 2450.0,
          banks: [
            { id: 1, label: 'Emirates NBD Current Account', balance: 284500.0 },
            { id: 2, label: 'ADCB Escrow Account', balance: 65400.0 }
          ],
          receivables: 51150.0,
          inventory: 129400.0,
          total: 467500.0,
        },
        liabilities: {
          payables: 133950.0,
          vatPayable: 5015.0,
          total: 138965.0,
        },
        equity: {
          netEquity: 328535.0,
        }
      }
    };
  }

  if (normPath === '/finance/cash-flow') {
    return {
      data: {
        startDate: '2025-08-01',
        endDate: '2025-08-31',
        operating: {
          cashFromSales: 112000.0,
          cashFromCollections: 30000.0,
          paidToSuppliers: 65000.0,
          billsPaid: 14839.0,
          expensesPaid: 545.0,
          refundsPaid: 320.0,
          net: 61296.0,
        },
        financing: {
          manualDeposits: 0.0,
          manualWithdrawals: 0.0,
          net: 0.0,
        },
        netCashChange: 61296.0,
        openingCash: 291054.0,
        closingCash: 352350.0,
      }
    };
  }

  if (normPath === '/finance/vat' || normPath === '/finance/vat-return') {
    return { data: db.finance.vatReturn };
  }

  // 15. Reports
  if (normPath.startsWith('/reports/')) {
    return {
      data: {
        summary: { total_sales: 184500, total_profit: 52300, orders_count: 142, average_order: 1299 },
        rows: db.invoices.map((inv) => ({
          reference: inv.invoice_number,
          date: inv.date.slice(0, 10),
          customer: inv.customer_name,
          amount: inv.grand_total,
          vat: inv.vat_total,
          status: inv.status,
        }))
      }
    };
  }

  // 16. Approvals & Notifications
  if (normPath === '/approvals' || normPath === '/notifications/approvals/queue') {
    return { data: db.approvals, meta: { total: db.approvals.length } };
  }
  if (normPath === '/notifications/approvals/counts') {
    return { data: { total: db.approvals.length, discounts: 1, leaves: 1 } };
  }
  if (normPath === '/notifications') {
    return { data: db.notifications, meta: { total: db.notifications.length } };
  }
  if (normPath === '/notifications/unread-count') {
    return { data: { unread_count: db.notifications.filter((n) => !n.read).length } };
  }
  if (normPath.endsWith('/read') || normPath === '/notifications/read-all') {
    db.notifications.forEach((n) => { n.read = true; });
    return { data: { success: true } };
  }

  // 17. Users, Employees & Roles
  if (normPath === '/users') {
    if (m === 'POST') {
      const newUser = { id: Date.now(), is_active: true, created_at: new Date().toISOString(), ...body };
      db.users.push(newUser);
      return { data: newUser };
    }
    return { data: db.users, meta: { total: db.users.length } };
  }
  if (normPath.startsWith('/users/')) {
    const id = Number(normPath.split('/')[2]);
    const u = db.users.find((user) => user.id === id) || db.users[0];
    if (m === 'PUT') {
      const idx = db.users.findIndex((user) => user.id === id);
      if (idx !== -1) db.users[idx] = { ...db.users[idx], ...body };
      return { data: db.users[idx] };
    }
    return { data: u };
  }

  if (normPath === '/employees') {
    if (m === 'POST') {
      const newEmp = { id: Date.now(), status: 'active', ...body };
      db.employees.push(newEmp);
      return { data: newEmp };
    }
    return { data: db.employees, meta: { total: db.employees.length } };
  }
  if (normPath.startsWith('/employees/')) {
    const id = Number(normPath.split('/')[2]);
    return { data: db.employees.find((e) => e.id === id) || db.employees[0] };
  }

  if (normPath === '/roles') {
    if (m === 'POST') {
      const newRole = { id: Date.now(), user_count: 0, is_system: false, ...body };
      db.roles.push(newRole);
      return { data: newRole };
    }
    return { data: db.roles, meta: { total: db.roles.length } };
  }
  if (normPath.startsWith('/roles/')) {
    const id = Number(normPath.split('/')[2]);
    const r = db.roles.find((role) => role.id === id) || db.roles[0];
    if (m === 'PUT') {
      const idx = db.roles.findIndex((role) => role.id === id);
      if (idx !== -1) db.roles[idx] = { ...db.roles[idx], ...body };
      return { data: db.roles[idx] };
    }
    return { data: r };
  }

  // 18. Admin & Diagnostics
  if (normPath === '/admin/bug-reports' || normPath === '/bug-reports') {
    if (m === 'POST') {
      const newBug = { id: Date.now(), created_at: new Date().toISOString().slice(0, 10), user: 'Demo User', status: 'submitted', ...body };
      db.bugReports.push(newBug);
      return { data: newBug };
    }
    return { data: db.bugReports, meta: { total: db.bugReports.length } };
  }

  if (normPath === '/admin/error-logs' || normPath === '/error-logs') {
    return { data: db.errorLogs, meta: { total: db.errorLogs.length } };
  }

  if (normPath === '/backup/maintenance' || normPath === '/backup/status') {
    return { data: { in_progress: false, last_backup: '2025-08-30T22:00:00Z', total_backups: 14 } };
  }

  // Generic fallback
  return { data: { success: true, message: 'Mock response' } };
}
