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
  const product = db.products.find((p) => p.id === w.product_id);
  const variant = product?.variants?.find((v) => v.id === w.variant_id);
  return {
    id: w.id,
    warrantyNumber: w.warranty_code,
    warrantyType: w.warranty_type || 'customer',
    invoiceId: w.invoice_id ?? null,
    invoiceNumber: w.invoice_number ?? null,
    customerId: w.customer_id ?? null,
    customerName: w.customer_name,
    customerPhone: w.customer_phone,
    productId: w.product_id,
    productName: w.product_name,
    variantSku: variant?.sku || null,
    serialNumber: w.serial_number,
    startDate: w.start_date,
    endDate: w.end_date,
    durationMonths: w.duration_months,
    terms: w.terms || null,
    status,
    expiringSoon,
    daysRemaining,
    claimsCount: db.warrantyClaims.filter((c) => c.warranty_id === w.id).length,
    createdByUsername: w.created_by_username || null,
    createdAt: w.created_at || w.start_date,
    voidedAt: w.voided_at || null,
    voidReason: w.void_reason || null,
    supplierWarranty: null,
  };
}

function mapWarrantyDetail(w) {
  return {
    ...mapWarranty(w),
    claims: db.warrantyClaims.filter((c) => c.warranty_id === w.id).map(mapWarrantyClaim),
  };
}

function mapWarrantyClaim(c) {
  const warranty = db.warranties.find((w) => w.id === c.warranty_id);
  return {
    id: c.id,
    claimNumber: c.claim_number,
    warrantyId: c.warranty_id,
    warrantyNumber: warranty?.warranty_code || null,
    productName: c.product_name,
    serialNumber: c.serial_number,
    customerName: c.customer_name,
    customerPhone: c.customer_phone,
    issueDescription: c.issue_description,
    status: c.status,
    claimDate: c.created_at,
    createdByUsername: c.created_by_username || null,
    createdAt: c.created_at,
    resolution: c.resolution,
    notes: c.notes || null,
    resolvedDate: c.resolved_date || null,
    resolvedByUsername: c.resolved_by_username || null,
    replacementInvoiceId: c.replacement_invoice_id || null,
    replacementInvoiceNumber: c.replacement_invoice_number || null,
    supplierClaimRaised: !!c.supplier_claim_raised,
    supplierClaimResolved: !!c.supplier_claim_resolved,
  };
}

function supplierInputToRow(payload, existing = {}) {
  const row = { ...existing };
  if (payload.name !== undefined) row.name = payload.name;
  if (payload.contactPerson !== undefined) row.contact_person = payload.contactPerson;
  if (payload.phone !== undefined) row.phone = payload.phone;
  if (payload.email !== undefined) row.email = payload.email;
  if (payload.address !== undefined) row.address = payload.address;
  if (payload.paymentTerms !== undefined) row.payment_terms = payload.paymentTerms;
  if (payload.defaultLeadTimeDays !== undefined) row.default_lead_time_days = Number(payload.defaultLeadTimeDays) || 0;
  if (payload.notes !== undefined) row.notes = payload.notes;
  if (payload.isActive !== undefined) row.is_active = !!payload.isActive;
  return row;
}

function mapSupplier(s) {
  const supPOs = db.purchaseOrders.filter((po) => po.supplier_id === s.id);
  const activePOs = supPOs.filter((po) => po.status !== 'cancelled');
  const totalSpent = activePOs.reduce((acc, po) => acc + (po.grand_total || 0), 0);
  const lastOrderDate = supPOs.length
    ? supPOs.reduce((latest, po) => (new Date(po.order_date) > new Date(latest) ? po.order_date : latest), supPOs[0].order_date)
    : null;
  const poIds = new Set(supPOs.map((po) => po.id));
  const supPayments = db.purchaseOrderPayments.filter((p) => poIds.has(p.po_id));
  const lastPaymentDate = supPayments.length
    ? supPayments.reduce((latest, p) => (new Date(p.payment_date) > new Date(latest) ? p.payment_date : latest), supPayments[0].payment_date)
    : null;
  const overdueCount = supPOs.filter(
    (po) => po.due_date && new Date(po.due_date) < new Date() && po.payment_status !== 'paid' && po.status !== 'cancelled',
  ).length;
  return {
    id: s.id,
    name: s.name,
    contactPerson: s.contact_person || null,
    phone: s.phone,
    email: s.email || null,
    address: s.address || null,
    trnNumber: s.trn || null,
    creditLimit: s.credit_limit || 0,
    creditDays: s.credit_days || 0,
    outstandingBalance: s.outstanding_balance || 0,
    totalSpent: totalSpent || s.total_purchases || 0,
    isActive: s.is_active,
    notes: s.notes || null,
    paymentTerms: s.payment_terms || null,
    defaultLeadTimeDays: s.default_lead_time_days || 0,
    avgLeadTimeDays: s.avg_lead_time_days ?? null,
    defectRate: s.defect_rate ?? null,
    lastOrderDate,
    lastPaymentDate,
    overdueCount,
  };
}

function mapPOItem(it) {
  const product = db.products.find((p) => p.id === it.product_id);
  const variant = product?.variants?.find((v) => v.id === it.variant_id);
  const qty = it.quantity || 0;
  const received = it.received_quantity || 0;
  return {
    id: it.id,
    productId: it.product_id,
    variantId: it.variant_id,
    productName: it.product_name,
    productImage: product?.image || null,
    sku: variant?.sku || product?.sku || null,
    barcode: variant?.barcode || product?.barcode || null,
    unitLabel: product?.unit || 'pcs',
    quantity: qty,
    quantityReceived: received,
    quantityRemaining: Math.max(0, qty - received),
    costPricePerUnit: it.unit_cost,
    totalCost: it.total,
  };
}

function mapPurchaseOrder(po) {
  return {
    id: po.id,
    poNumber: po.po_number,
    supplierId: po.supplier_id,
    supplierName: po.supplier_name,
    status: po.status,
    paymentStatus: po.payment_status,
    orderDate: po.order_date,
    expectedDate: po.expected_delivery_date || null,
    dueDate: po.due_date || null,
    receivedDate: po.received_date || null,
    subtotal: po.subtotal,
    taxAmount: po.vat_total,
    totalCost: po.grand_total,
    amountPaid: po.paid_amount,
    balanceDue: po.balance_due,
    itemsCount: (po.items || []).length,
    notes: po.notes || null,
    attachmentPath: po.attachment_path || null,
    updatedAt: po.updated_at || po.order_date,
    items: (po.items || []).map(mapPOItem),
  };
}

function mapPOListRow(po) {
  const { items, ...rest } = mapPurchaseOrder(po);
  return rest;
}

function recalcPoPaymentStatus(po) {
  po.paid_amount = db.purchaseOrderPayments.filter((p) => p.po_id === po.id).reduce((acc, p) => acc + (Number(p.amount) || 0), 0);
  po.balance_due = Math.max(0, (po.grand_total || 0) - po.paid_amount);
  po.payment_status = po.balance_due <= 0.001 ? 'paid' : po.paid_amount > 0 ? 'partial' : 'unpaid';
}

const SOLD_BY_FROM_UNIT = { pcs: 'piece', m: 'meter', meter: 'meter', rolls: 'roll', roll: 'roll', kg: 'kg', box: 'box', length: 'piece' };
const UNIT_FROM_SOLD_BY = { piece: 'pcs', meter: 'm', roll: 'roll', kg: 'kg', box: 'box' };

function mapVariantAttributes(attrsObj) {
  return Object.entries(attrsObj || {}).map(([code, value]) => {
    const attr = db.attributes.find((a) => a.code === code);
    return { attributeId: attr?.id ?? code, attributeName: attr?.name || code, value };
  });
}

function categoryAttributesFor(categoryId) {
  const codesUsed = new Set();
  db.products
    .filter((p) => p.category_id === Number(categoryId))
    .forEach((p) => {
      (p.variants || []).forEach((v) => {
        Object.keys(v.attributes || {}).forEach((k) => codesUsed.add(k));
      });
    });
  return db.attributes
    .filter((a) => codesUsed.has(a.code))
    .map((a, i) => ({ attributeId: a.id, name: a.name, unit: null, isRequired: false, displayOrder: i }));
}

function mapVariant(v) {
  return {
    id: v.id,
    sku: v.sku,
    barcode: v.barcode,
    internalBarcode: v.internal_barcode || v.barcode,
    supplierBarcode: v.supplier_barcode || null,
    name: v.name || null,
    imagePath: v.image || null,
    attributes: Array.isArray(v.attributes) ? v.attributes : mapVariantAttributes(v.attributes),
    costPrice: v.cost_price,
    sellingPrice: v.selling_price,
    stockQty: v.stock_quantity || 0,
    quarantineQty: 0,
    reorderThreshold: v.reorder_threshold ?? null,
  };
}

function mapProduct(p) {
  const variants = (p.variants || []).map(mapVariant);
  const prices = p.has_variants ? variants.map((v) => v.sellingPrice || 0) : [p.selling_price || 0];
  const category = db.categories.find((c) => c.id === p.category_id);
  return {
    id: p.id,
    name: p.name,
    description: p.description || null,
    brand: p.brand || null,
    categoryId: p.category_id,
    categoryPath: category?.name || p.category_name || null,
    soldBy: p.sold_by || SOLD_BY_FROM_UNIT[p.unit] || 'piece',
    unitLabel: p.unit,
    hasVariants: !!p.has_variants,
    defaultWarrantyMonths: p.warranty_months || 0,
    reorderThreshold: p.min_stock_level ?? null,
    imagePath: p.image || null,
    isActive: p.is_active,
    variantCount: variants.length,
    minPrice: prices.length ? Math.min(...prices) : 0,
    maxPrice: prices.length ? Math.max(...prices) : 0,
    totalStock: p.has_variants ? variants.reduce((acc, v) => acc + (v.stockQty || 0), 0) : p.stock_quantity || 0,
    variants: p.has_variants
      ? variants
      : [
          {
            id: p.id,
            sku: p.sku,
            barcode: p.barcode,
            internalBarcode: p.barcode,
            supplierBarcode: p.supplier_barcode || null,
            name: null,
            imagePath: p.image || null,
            attributes: [],
            costPrice: p.cost_price,
            sellingPrice: p.selling_price,
            stockQty: p.stock_quantity || 0,
            quarantineQty: 0,
            reorderThreshold: p.min_stock_level ?? null,
          },
        ],
  };
}

function productInputToRow(payload, existing = {}) {
  const row = { ...existing };
  if (payload.name !== undefined) row.name = payload.name;
  if (payload.description !== undefined) row.description = payload.description;
  if (payload.categoryId !== undefined) {
    row.category_id = Number(payload.categoryId);
    row.category_name = db.categories.find((c) => c.id === Number(payload.categoryId))?.name || row.category_name;
  }
  if (payload.brand !== undefined) row.brand = payload.brand;
  if (payload.hasVariants !== undefined) row.has_variants = !!payload.hasVariants;
  if (payload.soldBy !== undefined) row.sold_by = payload.soldBy;
  if (payload.unitLabel !== undefined) row.unit = payload.unitLabel;
  if (payload.defaultWarrantyMonths !== undefined) {
    row.warranty_months = Number(payload.defaultWarrantyMonths) || 0;
    row.has_warranty = row.warranty_months > 0;
  }
  if (payload.reorderThreshold !== undefined) row.min_stock_level = Number(payload.reorderThreshold) || 0;
  if (payload.isActive !== undefined) row.is_active = !!payload.isActive;
  return row;
}

function logProductHistory(productId, action, performedByUsername, notes = null, oldValue = null, newValue = null) {
  db.productHistory.unshift({
    id: Date.now() + Math.floor(Math.random() * 1000),
    product_id: productId,
    action,
    performed_by_username: performedByUsername || db.currentUser?.full_name || 'Admin',
    timestamp: new Date().toISOString(),
    notes,
    old_value: oldValue,
    new_value: newValue,
  });
}

function mapTopSupplier(s, rank) {
  const orders = db.purchaseOrders.filter((po) => po.supplier_id === s.id);
  return {
    rank,
    supplier_id: s.id,
    supplier_name: s.name,
    total_orders: orders.length,
    total_spent: s.total_purchases || 0,
    defect_rate_pct: s.defect_rate ?? 1.5,
    avg_lead_time_days: s.default_lead_time_days || 7,
    on_time_rate_pct: 92,
  };
}

function mapWorstSupplier(s) {
  const overdue = db.purchaseOrders.filter((po) => po.supplier_id === s.id && po.due_date && new Date(po.due_date) < new Date() && po.payment_status !== 'paid');
  return {
    supplier_id: s.id,
    supplier_name: s.name,
    defect_rate_pct: s.defect_rate ?? 6.5,
    overdue_count: overdue.length,
    overdue_amount: overdue.reduce((acc, po) => acc + (po.balance_due || 0), 0),
    avg_lead_time_days: s.default_lead_time_days || 12,
  };
}

function mapTopCustomer(c, rank) {
  const custInvoices = db.invoices.filter((inv) => inv.customer_id === c.id && inv.status !== 'cancelled');
  const totalSpent = custInvoices.reduce((acc, inv) => acc + (inv.grand_total || 0), 0) || c.total_purchases || 0;
  return {
    rank,
    customer_id: c.id,
    customer_name: c.name,
    phone: c.phone,
    total_spent: totalSpent,
    invoice_count: custInvoices.length,
    avg_order_value: custInvoices.length ? totalSpent / custInvoices.length : 0,
  };
}

function mapAtRiskCustomer(c) {
  const custInvoices = db.invoices.filter((inv) => inv.customer_id === c.id && inv.status !== 'cancelled');
  const lastDate = custInvoices.length ? custInvoices.reduce((l, inv) => (new Date(inv.date) > new Date(l) ? inv.date : l), custInvoices[0].date) : null;
  const daysAgo = lastDate ? Math.round((new Date() - new Date(lastDate)) / (1000 * 60 * 60 * 24)) : null;
  return {
    customer_id: c.id,
    customer_name: c.name,
    phone: c.phone,
    last_purchase_days_ago: daysAgo,
    credit_balance: c.outstanding_balance || 0,
    lifetime_spent: c.total_purchases || 0,
    risk_reason: (c.outstanding_balance || 0) > 0 ? 'overdue_balance' : 'inactive',
  };
}

function mapEmployeePerformance(user, rank) {
  const userInvoices = db.invoices.filter((inv) => inv.user_id === user.id && inv.status !== 'cancelled');
  const revenue = userInvoices.reduce((acc, inv) => acc + (inv.grand_total || 0), 0);
  const discountTotal = userInvoices.reduce((acc, inv) => acc + (inv.discount_total || 0), 0);
  return {
    rank,
    user_id: user.id,
    employee_name: user.full_name || user.username,
    invoices_created: userInvoices.length,
    revenue_generated: revenue,
    avg_invoice_value: userInvoices.length ? revenue / userInvoices.length : 0,
    discount_rate_pct: revenue > 0 ? (discountTotal / revenue) * 100 : 0,
    return_request_count: db.returnRequests.filter((r) => r.requestedBy === user.id).length,
    attendance_rate_pct: 96,
  };
}

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const target = new Date(`${dateStr}T00:00:00`);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target - startOfToday) / (1000 * 60 * 60 * 24));
}

function billPaymentStatusFor(bp) {
  if (bp.status === 'paid') return 'paid';
  const d = daysUntil(bp.due_date);
  if (d < 0) return 'overdue';
  if (d === 0) return 'due';
  return 'upcoming';
}

function mapBillPayment(bp) {
  const bill = db.bills.find((b) => b.id === bp.bill_id);
  return {
    id: bp.id,
    billId: bp.bill_id,
    billName: bill?.bill_number || null,
    // A couple of dashboard widgets (AlertsPanel) read the snake_case
    // aliases below instead of the camelCase fields above — keep both in
    // sync so either consumer renders correctly.
    bill_name: bill?.bill_number || null,
    name: bill?.bill_number || null,
    vendorName: bill?.vendor_name || null,
    categoryIcon: db.expenseCategories.find((c) => c.id === bill?.category_id)?.icon || null,
    dueDate: bp.due_date,
    due_date: bp.due_date,
    amountDue: bp.amount_due,
    amount_due: bp.amount_due,
    amount: bp.amount_due,
    status: billPaymentStatusFor(bp),
    daysUntilDue: daysUntil(bp.due_date),
    paymentMethod: bp.payment_method || bill?.payment_method || null,
    bankName: bp.bank_name || null,
    paidDate: bp.paid_date || null,
    receiptAttachment: bp.receipt_attachment || null,
  };
}

function mapBill(b) {
  const payments = db.billPayments.filter((p) => p.bill_id === b.id);
  const unpaid = payments.filter((p) => p.status !== 'paid').sort((a, c) => new Date(a.due_date) - new Date(c.due_date))[0];
  const upcoming = unpaid ? mapBillPayment(unpaid) : null;
  const category = db.expenseCategories.find((c) => c.id === b.category_id);
  return {
    id: b.id,
    name: b.bill_number,
    vendorName: b.vendor_name,
    categoryId: b.category_id,
    categoryName: category?.name || null,
    categoryIcon: category?.icon || null,
    frequency: b.recurring,
    amount: b.amount,
    isVariableAmount: !!b.is_variable_amount,
    nextDueDate: upcoming?.dueDate || b.due_date,
    upcomingPaymentStatus: upcoming?.status || null,
    upcomingPaymentId: upcoming?.id || null,
    daysUntilDue: upcoming?.daysUntilDue ?? daysUntil(b.due_date),
    paymentMethod: b.payment_method || 'bank',
    bankName: b.bank_account_id ? db.treasury.bankAccounts.find((a) => a.id === b.bank_account_id)?.bank_name : null,
    status: b.lifecycle_status || 'active',
    notes: b.notes || null,
  };
}

function mapExpense(e) {
  const category = db.expenseCategories.find((c) => c.id === e.category_id);
  return {
    id: e.id,
    expenseDate: e.date,
    categoryId: e.category_id,
    categoryName: category?.name || null,
    categoryIcon: category?.icon || null,
    description: e.description,
    amount: e.amount,
    vat: e.vat || 0,
    paymentMethod: e.payment_method || 'cash',
    bankName: e.bank_name || null,
    paidByUsername: e.user,
    notes: e.notes || null,
    receiptAttachment: e.receipt_attachment || null,
    createdAt: e.created_at || e.date,
  };
}

function mapExpenseCategory(c) {
  return {
    id: c.id,
    name: c.name,
    icon: c.icon || null,
    type: c.type || 'one_time',
    isActive: c.is_active !== false,
    billsCount: db.bills.filter((b) => b.category_id === c.id).length,
    expensesCount: db.expenses.filter((e) => e.category_id === c.id).length,
  };
}

function mapAccount(a) {
  return {
    id: a.id,
    code: a.code,
    name: a.name,
    type: a.type,
    parentId: a.parent_id,
    isSystem: !!a.is_system,
    description: a.description || null,
  };
}

function mapPeriod(p) {
  return {
    id: p.id,
    name: p.name,
    type: p.type,
    startDate: p.start_date,
    endDate: p.end_date,
    status: p.status,
    closedByUsername: p.closed_by_username || null,
    closedAt: p.closed_at || null,
  };
}

function journalEntryTotals(entry) {
  const totalDebit = entry.lines.reduce((acc, l) => acc + (l.debit || 0), 0);
  const totalCredit = entry.lines.reduce((acc, l) => acc + (l.credit || 0), 0);
  return { totalDebit, totalCredit, balanced: Math.abs(totalDebit - totalCredit) < 0.01 };
}

function mapJournalListRow(e) {
  const { totalDebit, totalCredit, balanced } = journalEntryTotals(e);
  return {
    id: e.id,
    entryNumber: e.entry_number,
    date: e.date,
    description: e.description,
    isManual: !!e.is_manual,
    referenceType: e.reference_type,
    lineCount: e.lines.length,
    totalDebit,
    totalCredit,
    balanced,
  };
}

function mapJournalDetail(e) {
  const period = db.financePeriods.find((p) => p.id === e.period_id);
  const { totalDebit, totalCredit, balanced } = journalEntryTotals(e);
  return {
    id: e.id,
    entryNumber: e.entry_number,
    date: e.date,
    periodName: period?.name || null,
    referenceType: e.reference_type,
    isManual: !!e.is_manual,
    createdByUsername: e.created_by_username,
    description: e.description,
    balanced,
    totalDebit,
    totalCredit,
    lines: e.lines.map((l, i) => {
      const account = db.financeAccounts.find((a) => a.code === l.account_code);
      return {
        id: `${e.id}-${i}`,
        accountCode: l.account_code,
        accountName: account?.name || l.account_code,
        debit: l.debit || 0,
        credit: l.credit || 0,
        notes: l.notes || null,
      };
    }),
  };
}

// Mirrors ALL_PERMISSIONS in src/store/authStore.js (minus the '*' wildcard)
// so the role/user permission editors have a full catalog to toggle.
const PERMISSION_CATALOG_KEYS = [
  'analytics.view', 'analytics.view_dashboard', 'analytics.view_peaks', 'analytics.view_reorder', 'analytics.view_seasonality', 'analytics.export_forecast', 'analytics.manage_reorder_settings',
  'dashboard.view',
  'user.view', 'user.create', 'user.edit', 'user.change_role',
  'employee.view', 'employee.create', 'employee.edit',
  'product.view', 'product.create', 'product.edit', 'product.view_cost',
  'stock.view', 'stock.adjust', 'stock.adjust_request', 'stock.adjust_direct', 'stock.adjust_approve', 'stock.count', 'stock.count_initiate', 'stock.count_approve',
  'supplier.view', 'supplier.create', 'supplier.edit', 'supplier.delete', 'supplier.purchase_order.create', 'supplier.purchase_order.pay',
  'customer.view', 'customer.create', 'customer.edit', 'customer.delete', 'customer.view_balance', 'customer.collect_payment',
  'invoice.view', 'invoice.create', 'invoice.edit_approve', 'invoice.edit_request', 'invoice.cancel',
  'warranty.view', 'warranty.create', 'warranty.claim',
  'return.request', 'return.approve',
  'cash.view', 'cash.drawer', 'cash.adjust',
  'bank.transact',
  'bills.view', 'bills.manage', 'bills.pay',
  'finance.view_dashboard', 'finance.view_journal', 'finance.close_period',
  'report.financial', 'report.sales', 'report.inventory', 'report.schedule', 'report.suppliers', 'report.customers', 'report.employees',
  'attendance.view_own', 'attendance.view_all', 'attendance.approve_leave', 'attendance.approve_correction', 'attendance.mark_manual', 'attendance.correction_approve',
  'settings.view', 'settings.edit',
  'backup.view',
  'bug.view_all',
  'errors.view_all',
];

function permissionLabel(key) {
  const part = key.split('.').pop();
  return part.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function permissionCatalog() {
  return PERMISSION_CATALOG_KEYS.map((key) => ({ key, label: permissionLabel(key), module: key.split('.')[0] }));
}

function mapEmployee(e) {
  return {
    id: e.id,
    name: e.name,
    roleTitle: e.job_title || null,
    department: e.department || null,
    phone: e.phone || null,
    email: e.email || null,
    salary: e.salary ?? null,
    joinDate: e.join_date || null,
    shiftStart: e.shift_start || '09:00',
    shiftEnd: e.shift_end || '18:00',
    isActive: e.status !== 'inactive',
    annualLeaveDays: e.annual_leave_days || 30,
    sickLeaveDays: e.sick_leave_days || 15,
  };
}

function mapRole(r) {
  const modules = [...new Set((r.permissions || []).filter((p) => p !== '*').map((p) => p.split('.')[0]))];
  return {
    id: r.id,
    name: r.name,
    description: r.description || null,
    isSystem: !!r.is_system,
    permissionKeys: r.permissions || [],
    modules,
    userCount: db.users.filter((u) => u.role_id === r.id && u.is_active).length,
  };
}

function mapUser(u) {
  const employee = db.employees.find((e) => e.id === u.employee_id) || null;
  const role = db.roles.find((r) => r.id === u.role_id) || null;
  return {
    id: u.id,
    username: u.username,
    email: u.email || null,
    phone: u.phone || null,
    isActive: u.is_active !== false,
    isOnline: !!u.is_online,
    lastActiveAt: u.last_active_at || null,
    createdAt: u.created_at,
    employee: employee ? { id: employee.id, name: employee.name } : null,
    role: role ? { id: role.id, name: role.name } : null,
  };
}

function mapAttendanceRow(a) {
  return {
    id: a.id,
    employeeId: a.employee_id,
    employeeName: a.employee_name,
    roleTitle: a.role_title,
    status: a.status,
    lateMinutes: a.late_minutes || 0,
    checkIn: a.check_in,
    checkOut: a.check_out,
    checkInMethod: a.check_in_method || 'app_login',
    standardHours: a.standard_hours || 8,
  };
}

function mapCorrection(c) {
  return {
    id: c.id,
    employeeId: c.employee_id,
    employeeName: c.employee_name,
    attendanceId: c.attendance_id,
    attendanceDate: c.attendance_date,
    reason: c.reason,
    requestNote: c.request_note,
    oldCheckIn: c.old_check_in,
    oldCheckOut: c.old_check_out,
    newCheckIn: c.new_check_in,
    newCheckOut: c.new_check_out,
    status: c.status,
    requestedBy: c.requested_by,
    rejectionReason: c.rejection_reason || null,
  };
}

function mapLeave(l) {
  return {
    id: l.id,
    employeeId: l.employee_id,
    employeeName: l.employee_name,
    leaveType: l.leave_type,
    startDate: l.start_date,
    endDate: l.end_date,
    totalDays: l.total_days,
    reason: l.reason,
    status: l.status,
    requestedBy: l.requested_by,
    rejectionReason: l.rejection_reason || null,
  };
}

function mapHoliday(h) {
  return { id: h.id, name: h.name, date: h.date, type: h.type || 'public' };
}

function businessDaysBetween(startStr, endStr) {
  const start = new Date(`${startStr}T00:00:00`);
  const end = new Date(`${endStr}T00:00:00`);
  let count = 0;
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const day = d.getDay();
    if (day !== 5 && day !== 6) count += 1; // UAE weekend: Friday & Saturday
  }
  return count;
}

function employeeLeaveBalances(employeeId, year) {
  const emp = db.employees.find((e) => e.id === employeeId);
  const override = db.attendance.leaveOverrides[employeeId] || {};
  const entitledAnnual = override.annual?.entitledDays ?? emp?.annual_leave_days ?? 30;
  const carriedAnnual = override.annual?.carriedOverDays ?? 0;
  const entitledSick = override.sick?.entitledDays ?? emp?.sick_leave_days ?? 15;
  const approvedLeaves = db.attendance.leaves.filter(
    (l) => l.employee_id === employeeId && l.status === 'approved' && new Date(l.start_date).getFullYear() === year,
  );
  const usedFor = (type) => approvedLeaves.filter((l) => l.leave_type === type).reduce((acc, l) => acc + (l.total_days || 0), 0);
  const usedAnnual = usedFor('annual');
  const usedSick = usedFor('sick');
  const usedUnpaid = usedFor('unpaid');
  const usedEmergency = usedFor('emergency');
  return {
    annual: { entitledDays: entitledAnnual, usedDays: usedAnnual, carriedOverDays: carriedAnnual, remainingDays: Math.max(0, entitledAnnual + carriedAnnual - usedAnnual) },
    sick: { entitledDays: entitledSick, usedDays: usedSick, carriedOverDays: 0, remainingDays: Math.max(0, entitledSick - usedSick) },
    unpaid: { entitledDays: null, usedDays: usedUnpaid, carriedOverDays: 0, remainingDays: null },
    emergency: { entitledDays: 5, usedDays: usedEmergency, carriedOverDays: 0, remainingDays: Math.max(0, 5 - usedEmergency) },
  };
}

function mapCashTransaction(t) {
  return {
    id: t.id,
    timestamp: t.timestamp,
    transactionType: t.transaction_type,
    direction: t.direction,
    amount: t.amount,
    balanceAfter: t.balance_after,
    referenceType: t.reference_type,
    employeeUsername: t.employee_username,
    notes: t.notes,
    sessionId: t.session_id,
  };
}

function mapCashSession(s) {
  return {
    id: s.id,
    openedAt: s.opened_at,
    openedByUsername: s.opened_by_username,
    openingBalance: s.opening_balance,
    closingBalance: s.closing_balance,
    discrepancy: s.discrepancy,
    closedAt: s.closed_at,
  };
}

function mapBankAccount(b) {
  return {
    id: b.id,
    bankName: b.bank_name,
    accountName: b.account_name,
    accountNumber: b.account_number,
    iban: b.iban,
    currency: b.currency || 'AED',
    currentBalance: b.balance,
    isDefault: !!b.is_primary,
    isActive: b.is_active !== false,
    notes: b.notes || null,
    lastActivityAt: b.last_activity_at || null,
  };
}

function mapBankTransaction(t) {
  return {
    id: t.id,
    timestamp: t.timestamp,
    transactionType: t.transaction_type,
    direction: t.direction,
    amount: t.amount,
    balanceAfter: t.balance_after,
    description: t.description,
    notes: t.notes,
    employeeUsername: t.employee_username,
  };
}

function mapCashTransfer(t) {
  return {
    id: t.id,
    transferDate: t.transfer_date,
    fromLabel: t.from_label,
    toLabel: t.to_label,
    amount: t.amount,
    employeeUsername: t.employee_username,
    notes: t.notes,
  };
}

function logCashTransaction({ type, direction, amount, referenceType, notes }) {
  const cd = db.treasury.cashDrawer;
  cd.current_balance = direction === 'in' ? cd.current_balance + amount : cd.current_balance - amount;
  const t = {
    id: Date.now() + Math.floor(Math.random() * 1000),
    timestamp: new Date().toISOString(),
    transaction_type: type,
    direction,
    amount,
    balance_after: Math.round(cd.current_balance * 100) / 100,
    reference_type: referenceType || null,
    employee_username: db.currentUser?.full_name || 'Admin',
    notes: notes || null,
    session_id: cd.session_id,
  };
  db.treasury.cashTransactions.unshift(t);
  return t;
}

function logBankTransaction(bankAccount, { type, direction, amount, description, notes }) {
  bankAccount.balance = direction === 'in' ? bankAccount.balance + amount : bankAccount.balance - amount;
  bankAccount.last_activity_at = new Date().toISOString();
  const t = {
    id: Date.now() + Math.floor(Math.random() * 1000),
    bank_account_id: bankAccount.id,
    timestamp: new Date().toISOString(),
    transaction_type: type,
    direction,
    amount,
    balance_after: Math.round(bankAccount.balance * 100) / 100,
    description: description || null,
    notes: notes || null,
    employee_username: db.currentUser?.full_name || 'Admin',
  };
  db.treasury.bankTransactions.unshift(t);
  return t;
}

function mapMovement(m) {
  const { product, variant } = findProductAndVariant(m.variant_id ?? m.product_id);
  return {
    id: m.id,
    timestamp: m.date,
    movementType: m.type === 'purchase_receive' ? 'purchase' : m.type,
    productId: m.product_id ?? product?.id ?? null,
    variantId: m.variant_id ?? null,
    productName: m.product_name,
    variantSku: variant?.sku || product?.sku || null,
    variantBarcode: variant?.barcode || product?.barcode || null,
    unitLabel: product?.unit || 'pcs',
    quantity: m.quantity,
    qtyBefore: m.qty_before ?? null,
    qtyAfter: m.qty_after ?? null,
    costPrice: m.cost_price ?? null,
    valueImpact: m.cost_price != null ? Math.round(m.quantity * m.cost_price * 100) / 100 : null,
    referenceType: m.reference_type || null,
    reference: m.reference || null,
    employeeUsername: m.user || null,
    notes: m.notes || null,
  };
}

function mapAdjustment(a) {
  return {
    id: a.id,
    productId: a.product_id,
    variantId: a.variant_id,
    productName: a.product_name,
    variantSku: a.sku,
    unitLabel: a.unit_label,
    currentQty: a.current_qty,
    requestedQty: a.requested_qty,
    difference: a.requested_qty - a.current_qty,
    adjustmentType: a.adjustment_type,
    reason: a.reason,
    requestNote: a.note,
    requestedByUsername: a.requested_by_username,
    requestedAt: a.requested_at,
    status: a.status,
    approvedByUsername: a.approved_by_username || null,
    approvedAt: a.approved_at || null,
    rejectionReason: a.rejection_reason || null,
  };
}

function logMovement({ productId, variantId, productName, type, quantity, qtyBefore, qtyAfter, costPrice, reference, referenceType, user }) {
  db.stockMovements.unshift({
    id: Date.now() + Math.floor(Math.random() * 1000),
    date: new Date().toISOString(),
    product_id: productId ?? null,
    variant_id: variantId ?? null,
    product_name: productName,
    type,
    quantity,
    qty_before: qtyBefore ?? null,
    qty_after: qtyAfter ?? null,
    cost_price: costPrice ?? null,
    reference: reference || null,
    reference_type: referenceType || null,
    user: user || db.currentUser?.full_name || 'Admin',
  });
}

function applyStockAdjustment(a) {
  const { product, variant } = findProductAndVariant(a.variant_id);
  if (variant) {
    variant.stock_quantity = Math.max(0, a.requested_qty);
    if (product?.variants) {
      product.stock_quantity = product.variants.reduce((acc, v) => acc + (v.stock_quantity || 0), 0);
    }
  } else if (product) {
    product.stock_quantity = Math.max(0, a.requested_qty);
  }
  logMovement({
    productId: a.product_id,
    variantId: a.variant_id,
    productName: a.product_name,
    type: 'adjustment',
    quantity: a.requested_qty - a.current_qty,
    qtyBefore: a.current_qty,
    qtyAfter: a.requested_qty,
    costPrice: variant ? variant.cost_price : product?.cost_price,
    reference: `ADJ-${String(a.id).slice(-6)}`,
    referenceType: a.status === 'approved' && a.approved_by_username ? 'adjustment_direct' : 'adjustment_request',
  });
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

  // Multipart uploads (image/receipt/attachment forms) send a FormData body.
  // Flatten it into a plain object so every handler below can read fields
  // with normal dot notation, same as JSON bodies. Files become their
  // filename string since the mock never persists real file bytes.
  if (typeof FormData !== 'undefined' && body instanceof FormData) {
    const flat = {};
    for (const [key, value] of body.entries()) {
      flat[key] = typeof File !== 'undefined' && value instanceof File ? value.name : value;
    }
    body = flat;
  }

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
    const sorted = [...db.suppliers].sort((a, b) => (b.total_purchases || 0) - (a.total_purchases || 0));
    return { data: sorted.map((s, i) => mapTopSupplier(s, i + 1)) };
  }
  if (normPath === '/analytics/worst-suppliers') {
    return { data: db.suppliers.slice(2).map(mapWorstSupplier) };
  }
  if (normPath === '/analytics/top-customers') {
    const sorted = [...db.customers].sort((a, b) => (b.total_purchases || 0) - (a.total_purchases || 0));
    return { data: sorted.map((c, i) => mapTopCustomer(c, i + 1)) };
  }
  if (normPath === '/analytics/at-risk-customers') {
    return { data: db.customers.filter((c) => c.outstanding_balance > 0).map(mapAtRiskCustomer) };
  }
  if (normPath === '/analytics/employee-performance') {
    return {
      data: db.finance.employeePerformance.map((e) => ({
        rank: e.rank,
        user_id: e.user_id,
        employee_name: e.employee_name,
        invoices_created: e.invoices_count,
        revenue_generated: e.revenue_generated,
        avg_invoice_value: e.avg_ticket,
        discount_rate_pct: e.revenue_generated > 0 ? (e.discounts_given / e.revenue_generated) * 100 : 0,
        return_request_count: e.returns_processed,
        attendance_rate_pct: e.attendance_rate,
      })),
    };
  }
  if (normPath === '/analytics/category-breakdown') {
    return { data: db.finance.categoryBreakdown };
  }
  if (normPath === '/analytics/peak-heatmap' || normPath === '/analytics/peak-hours') {
    return { data: db.finance.peakHours };
  }
  if (normPath === '/analytics/peak-days') {
    const series = [
      { label: 'Mon', is_weekend: false, invoice_count: 22, revenue: 32000 },
      { label: 'Tue', is_weekend: false, invoice_count: 19, revenue: 29000 },
      { label: 'Wed', is_weekend: false, invoice_count: 24, revenue: 35000 },
      { label: 'Thu', is_weekend: false, invoice_count: 27, revenue: 41000 },
      { label: 'Fri', is_weekend: true, invoice_count: 8, revenue: 9500 },
      { label: 'Sat', is_weekend: true, invoice_count: 30, revenue: 45000 },
      { label: 'Sun', is_weekend: true, invoice_count: 17, revenue: 26000 },
    ];
    return { data: { series } };
  }
  if (normPath === '/analytics/peak-months') {
    const year = Number(params.year) || new Date().getFullYear();
    const currentSeries = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, revenue: db.finance.timeline?.[i]?.revenue || Math.round(120000 + Math.random() * 100000) }));
    const previousSeries = currentSeries.map((r) => ({ month: r.month, revenue: Math.round(r.revenue * 0.85) }));
    const peakRevenue = Math.max(...currentSeries.map((r) => r.revenue));
    const peak_months = currentSeries.filter((r) => r.revenue >= peakRevenue * 0.9).map((r) => r.month);
    return {
      data: {
        year,
        compare_year: year - 1,
        peak_months,
        current: { series: currentSeries },
        previous: { series: previousSeries },
      },
    };
  }
  if (normPath === '/analytics/net-profit-trends') {
    return { data: db.finance.timeline };
  }
  if (normPath.startsWith('/analytics/product-seasonality/')) {
    return { data: { product_id: 1, months: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], sales: [12, 14, 18, 22, 35, 45, 60, 55, 40, 30, 25, 20] } };
  }
  if (normPath === '/forecast/reorder') {
    const rows = db.products
      .filter((p) => p.stock_quantity <= p.min_stock_level && !db.dismissedReorderAlerts.includes(-p.id))
      .map((p) => ({
        id: p.id,
        variant_id: p.id,
        product_name: p.name,
        is_peak_season: false,
        sku: p.sku,
        category_name: p.category_name,
        current_stock: p.stock_quantity,
        unit_label: p.unit,
        reorder_point: p.min_stock_level,
        recommended_qty: p.reorder_quantity || 50,
        lead_time_days: 7,
        confidence: p.stock_quantity === 0 ? 'high' : 'medium',
        based_on_months: 6,
      }));
    return { data: rows };
  }

  if (normPath.startsWith('/forecast/reorder/')) {
    const id = Number(normPath.split('/')[3]);
    if (m === 'POST') {
      // Use the negative-id namespace so this never collides with the
      // product-level dismissed-alerts list used by /stock/reorder-alerts.
      db.dismissedReorderAlerts.push(-id);
      return { data: { success: true } };
    }
    return { data: { success: true } };
  }

  if (normPath === '/forecast/annual-plan') {
    const year = Number(params.year) || new Date().getFullYear();
    const MONTH_FACTOR = [0.7, 0.75, 0.85, 0.9, 1.1, 1.3, 1.2, 1.15, 1.05, 0.95, 0.85, 1.2];
    const candidates = db.products.slice(0, 8);
    const plans = candidates.map((p) => {
      const baseQty = Math.max(5, p.reorder_quantity || p.min_stock_level || 20);
      const costPrice = p.cost_price || 0;
      const months = MONTH_FACTOR.map((factor, i) => {
        const qty = Math.round(baseQty * factor);
        return { month: i + 1, recommended_qty: qty, estimated_cost: Math.round(qty * costPrice * 100) / 100, basis: 'historical' };
      });
      return {
        variant_id: p.id,
        product_name: p.name,
        year,
        total_qty: months.reduce((acc, r) => acc + r.recommended_qty, 0),
        total_cost: months.reduce((acc, r) => acc + r.estimated_cost, 0),
        months,
      };
    });
    return { data: plans };
  }

  if (normPath.startsWith('/forecast/annual-plan/')) {
    const variantId = Number(normPath.split('/')[3]);
    const product = db.products.find((p) => p.id === variantId) || db.products[0];
    const MONTH_FACTOR = [0.7, 0.75, 0.85, 0.9, 1.1, 1.3, 1.2, 1.15, 1.05, 0.95, 0.85, 1.2];
    const baseQty = Math.max(5, product.reorder_quantity || product.min_stock_level || 20);
    const months = MONTH_FACTOR.map((factor, i) => {
      const qty = Math.round(baseQty * factor);
      return { month: i + 1, recommended_qty: qty, estimated_cost: Math.round(qty * (product.cost_price || 0) * 100) / 100, basis: 'historical' };
    });
    return { data: months };
  }

  if (normPath === '/forecast/recalculate') {
    return { data: { success: true } };
  }

  // 4. Products, Categories & Attributes
  if (normPath === '/products') {
    if (m === 'POST') {
      const catId = Number(body.categoryId) || 1;
      const category = db.categories.find((c) => c.id === catId);
      const baseRow = productInputToRow(body, {
        id: Date.now(),
        category_id: catId,
        category_name: category?.name || 'General',
        is_active: true,
      });
      if (body.hasVariants) {
        baseRow.variants = (body.variants || []).map((v, i) => ({
          id: Date.now() + i + 1,
          sku: v.sku || `${baseRow.name.slice(0, 3).toUpperCase()}-${Date.now().toString().slice(-4)}-${i}`,
          barcode: v.barcode || null,
          supplier_barcode: v.supplierBarcode || null,
          name: (v.attributeValueIds || []).join(' ') || null,
          attributes: {},
          cost_price: Number(v.costPrice) || 0,
          selling_price: Number(v.sellingPrice) || 0,
          stock_quantity: Number(v.openingStock) || 0,
          reorder_threshold: v.reorderThreshold ?? null,
        }));
        baseRow.stock_quantity = baseRow.variants.reduce((acc, v) => acc + v.stock_quantity, 0);
        baseRow.sku = baseRow.variants[0]?.sku || `SKU-${Date.now().toString().slice(-4)}`;
        baseRow.barcode = baseRow.variants[0]?.barcode || null;
        baseRow.cost_price = baseRow.variants[0]?.cost_price || 0;
        baseRow.selling_price = baseRow.variants[0]?.selling_price || 0;
      } else {
        const s = body.simple || {};
        baseRow.variants = [];
        baseRow.sku = s.sku || `SKU-${Date.now().toString().slice(-4)}`;
        baseRow.barcode = s.barcode || null;
        baseRow.supplier_barcode = s.supplierBarcode || null;
        baseRow.cost_price = Number(s.costPrice) || 0;
        baseRow.selling_price = Number(s.sellingPrice) || 0;
        baseRow.stock_quantity = Number(s.openingStock) || 0;
        if (s.reorderThreshold != null) baseRow.min_stock_level = Number(s.reorderThreshold) || 0;
      }
      db.products.unshift(baseRow);
      logProductHistory(baseRow.id, 'product.created', db.currentUser?.full_name, `Created "${baseRow.name}"`);
      return { data: mapProduct(baseRow) };
    }
    let list = [...db.products];
    if (params.search || params.q) {
      const q = (params.search || params.q).toLowerCase();
      list = list.filter((p) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q));
    }
    if (params.categoryId || params.category_id) {
      const cid = Number(params.categoryId || params.category_id);
      list = list.filter((p) => p.category_id === cid);
    }
    if (params.soldBy) {
      list = list.filter((p) => (p.sold_by || SOLD_BY_FROM_UNIT[p.unit] || 'piece') === params.soldBy);
    }
    if (params.hasVariants) {
      const want = params.hasVariants === 'true';
      list = list.filter((p) => !!p.has_variants === want);
    }
    if (params.isActive) {
      const want = params.isActive === 'true';
      list = list.filter((p) => !!p.is_active === want);
    }
    const page = Number(params.page) || 1;
    const limit = Number(params.limit) || 20;
    const total = list.length;
    const pageRows = list.slice((page - 1) * limit, (page - 1) * limit + limit).map(mapProduct);
    return { data: pageRows, meta: { total, page, limit } };
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

  if (normPath === '/variants/generate-barcode') {
    return { data: { barcode: `692${Date.now().toString().slice(-10)}` } };
  }

  if (normPath.startsWith('/products/') && normPath.includes('/variants')) {
    const parts = normPath.split('/');
    const id = Number(parts[2]);
    const variantId = parts[4] ? Number(parts[4]) : null;
    const action = parts[5];
    const idx = db.products.findIndex((p) => p.id === id);
    const prod = idx !== -1 ? db.products[idx] : db.products[0];

    if (!variantId) {
      // /products/:id/variants — list or create
      if (m === 'POST') {
        const newVariant = {
          id: Date.now(),
          sku: body.sku || `${prod.sku}-${(prod.variants?.length || 0) + 1}`,
          barcode: body.barcode || null,
          supplier_barcode: body.supplierBarcode || null,
          name: (body.attributeValueIds || []).join(' ') || null,
          attributes: {},
          cost_price: Number(body.costPrice) || 0,
          selling_price: Number(body.sellingPrice) || 0,
          stock_quantity: Number(body.openingStock) || 0,
          reorder_threshold: body.reorderThreshold ?? null,
        };
        prod.variants = prod.variants || [];
        prod.variants.push(newVariant);
        prod.has_variants = true;
        prod.stock_quantity = prod.variants.reduce((acc, v) => acc + (v.stock_quantity || 0), 0);
        logProductHistory(prod.id, 'variant.created', null, `Added variant ${newVariant.sku}`);
        return { data: mapVariant(newVariant) };
      }
      return { data: (prod?.variants || []).map(mapVariant) };
    }

    // /products/:id/variants/:variantId(/image)
    const variant = (prod.variants || []).find((v) => v.id === variantId);
    if (action === 'image') {
      if (m === 'POST') {
        if (variant) variant.image = `products/variant-${variantId}.jpg`;
        return { data: { imagePath: variant?.image || null } };
      }
      if (m === 'DELETE') {
        if (variant) variant.image = null;
        return { data: { success: true } };
      }
    }
    if (m === 'PUT' && variant) {
      if (body.sku !== undefined) variant.sku = body.sku;
      if (body.barcode !== undefined) variant.barcode = body.barcode;
      if (body.supplierBarcode !== undefined) variant.supplier_barcode = body.supplierBarcode;
      if (body.sellingPrice !== undefined) variant.selling_price = Number(body.sellingPrice) || 0;
      if (body.costPrice !== undefined) variant.cost_price = Number(body.costPrice) || 0;
      if (body.reorderThreshold !== undefined) variant.reorder_threshold = body.reorderThreshold;
      prod.stock_quantity = prod.variants.reduce((acc, v) => acc + (v.stock_quantity || 0), 0);
      logProductHistory(prod.id, 'variant.updated', null, `Updated variant ${variant.sku}`);
      return { data: mapVariant(variant) };
    }
    if (m === 'DELETE') {
      prod.variants = (prod.variants || []).filter((v) => v.id !== variantId);
      prod.stock_quantity = prod.variants.reduce((acc, v) => acc + (v.stock_quantity || 0), 0);
      logProductHistory(prod.id, 'variant.deleted', null, `Removed variant`);
      return { data: { success: true } };
    }
    return { data: variant ? mapVariant(variant) : null };
  }

  if (normPath.startsWith('/products/') && normPath.endsWith('/history')) {
    const id = Number(normPath.split('/')[2]);
    const entries = db.productHistory
      .filter((h) => h.product_id === id)
      .map((h) => ({
        id: h.id,
        action: h.action,
        performedByUsername: h.performed_by_username,
        timestamp: h.timestamp,
        notes: h.notes,
        oldValue: h.old_value,
        newValue: h.new_value,
      }));
    return { data: entries };
  }

  if (normPath.startsWith('/products/') && normPath.endsWith('/image')) {
    const id = Number(normPath.split('/')[2]);
    const idx = db.products.findIndex((p) => p.id === id);
    if (idx === -1) return { data: { success: true } };
    if (m === 'POST') {
      db.products[idx].image = `products/product-${id}.jpg`;
      logProductHistory(id, 'product.image_updated', null, 'Image uploaded');
      return { data: mapProduct(db.products[idx]) };
    }
    if (m === 'DELETE') {
      db.products[idx].image = null;
      return { data: { success: true } };
    }
    return { data: mapProduct(db.products[idx]) };
  }

  if (normPath.startsWith('/products/')) {
    const id = Number(normPath.split('/')[2]);
    const idx = db.products.findIndex((p) => p.id === id);
    if (m === 'DELETE') {
      if (idx !== -1) db.products[idx].is_active = false;
      return { data: { success: true } };
    }
    if (m === 'PUT') {
      if (idx !== -1) {
        db.products[idx] = productInputToRow(body, db.products[idx]);
        logProductHistory(id, 'product.updated', db.currentUser?.full_name, 'Product details updated');
      }
      return { data: mapProduct(db.products[idx] || db.products[0]) };
    }
    const prod = db.products.find((p) => p.id === id) || db.products[0];
    return { data: mapProduct(prod) };
  }

  if (normPath === '/categories' || normPath === '/categories/flat' || normPath === '/categories/tree') {
    if (m === 'POST') {
      const newCat = { id: Date.now(), product_count: 0, ...body };
      db.categories.push(newCat);
      return { data: newCat };
    }
    return { data: db.categories, meta: { total: db.categories.length } };
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

  if (normPath.startsWith('/categories/') && normPath.endsWith('/attributes')) {
    const id = Number(normPath.split('/')[2]);
    if (m === 'PUT') {
      // Demo keeps attribute linkage derived from existing product variants;
      // acknowledge the save without persisting a separate linkage table.
      return { data: body.attributes || [] };
    }
    return { data: categoryAttributesFor(id) };
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

  if (normPath === '/stock/low-stock') {
    const rows = flattenStockRows().filter((r) => r.status === 'low_stock' || r.status === 'out_of_stock');
    return { data: rows };
  }

  if (normPath === '/stock/dead-stock') {
    return { data: [], meta: { total: 0 } };
  }

  if (normPath === '/stock/valuation') {
    const rows = flattenStockRows();
    return {
      data: {
        totalValue: rows.reduce((acc, r) => acc + r.stockValue, 0),
        totalUnits: rows.reduce((acc, r) => acc + r.stockQty, 0),
        byCategory: db.categories.map((c) => ({
          categoryId: c.id,
          categoryName: c.name,
          value: rows.filter((r) => r.categoryName === c.name).reduce((acc, r) => acc + r.stockValue, 0),
        })),
      },
      meta: { total: rows.length },
    };
  }

  if (normPath.startsWith('/stock/movements/product/') || normPath.startsWith('/stock/movements/variant/')) {
    const parts = normPath.split('/');
    const isVariant = parts[3] === 'variant';
    const id = Number(parts[4]);
    let list = db.stockMovements.filter((m) => (isVariant ? m.variant_id === id : m.product_id === id));
    if (params.movementType) list = list.filter((m) => (m.type === 'purchase_receive' ? 'purchase' : m.type) === params.movementType);
    list.sort((a, b) => new Date(b.date) - new Date(a.date));
    const limit = Number(params.limit) || 200;
    return { data: list.slice(0, limit).map(mapMovement) };
  }

  if (normPath === '/stock/movements' || normPath === '/inventory/movements') {
    let list = [...db.stockMovements];
    if (params.search) {
      const q = params.search.toLowerCase();
      list = list.filter((m) => (m.product_name || '').toLowerCase().includes(q) || (m.reference || '').toLowerCase().includes(q));
    }
    if (params.productId) list = list.filter((m) => String(m.product_id) === String(params.productId));
    if (params.variantId) list = list.filter((m) => String(m.variant_id) === String(params.variantId));
    if (params.movementType) list = list.filter((m) => (m.type === 'purchase_receive' ? 'purchase' : m.type) === params.movementType);
    if (params.referenceType) list = list.filter((m) => m.reference_type === params.referenceType);
    if (params.dateFrom) list = list.filter((m) => m.date.slice(0, 10) >= params.dateFrom);
    if (params.dateTo) list = list.filter((m) => m.date.slice(0, 10) <= params.dateTo);
    list.sort((a, b) => new Date(b.date) - new Date(a.date));
    const page = Number(params.page) || 1;
    const limit = Number(params.limit) || 50;
    const total = list.length;
    const pageRows = list.slice((page - 1) * limit, (page - 1) * limit + limit).map(mapMovement);
    return { data: pageRows, meta: { total, page, limit } };
  }

  if (normPath === '/stock/reorder-alerts/check') {
    const activeCount = db.products.filter((p) => p.stock_quantity <= p.min_stock_level && !db.dismissedReorderAlerts.includes(p.id)).length;
    return { data: { scanned: db.products.length, created: activeCount } };
  }

  if (normPath.startsWith('/stock/reorder-alerts/')) {
    const id = Number(normPath.split('/')[3]);
    if (m === 'PUT') {
      if (!db.dismissedReorderAlerts.includes(id)) db.dismissedReorderAlerts.push(id);
      return { data: { success: true } };
    }
    return { data: { success: true } };
  }

  if (normPath === '/stock/reorder-alerts' || normPath === '/inventory/alerts') {
    const alerts = db.products
      .filter((p) => p.stock_quantity <= p.min_stock_level && !db.dismissedReorderAlerts.includes(p.id))
      .map((p) => ({
        id: p.id,
        productId: p.id,
        productName: p.name,
        product_name: p.name,
        productImage: p.image || null,
        categoryName: p.category_name,
        sku: p.sku,
        unitLabel: p.unit,
        currentStock: p.stock_quantity,
        current_stock: p.stock_quantity,
        reorderPoint: p.min_stock_level,
        reorder_point: p.min_stock_level,
        recommendedOrderQty: p.reorder_quantity || 50,
        recommended_order_qty: p.reorder_quantity || 50,
        status: 'pending',
        createdAt: new Date().toISOString(),
      }));
    return { data: alerts, meta: { total: alerts.length } };
  }

  if (normPath === '/stock/adjustments' || normPath === '/inventory/adjustments') {
    if (m === 'POST') {
      const { product, variant } = findProductAndVariant(body.variantId);
      const currentQty = variant ? variant.stock_quantity || 0 : product?.stock_quantity || 0;
      const qty = Number(body.quantity) || 0;
      let requestedQty = currentQty;
      if (body.adjustmentType === 'add') requestedQty = currentQty + Math.abs(qty);
      else if (body.adjustmentType === 'remove') requestedQty = Math.max(0, currentQty - Math.abs(qty));
      else if (body.adjustmentType === 'set') requestedQty = qty;

      const adj = {
        id: Date.now(),
        product_id: product?.id ?? null,
        variant_id: variant?.id ?? product?.id ?? null,
        product_name: variant?.name ? `${product.name} — ${variant.name}` : product?.name || 'Item',
        sku: variant?.sku || product?.sku || null,
        unit_label: product?.unit || 'pcs',
        current_qty: currentQty,
        requested_qty: requestedQty,
        adjustment_type: body.adjustmentType || 'set',
        reason: body.reason || 'other',
        note: body.note || '',
        requested_by_username: db.currentUser?.full_name || 'Admin',
        requested_at: new Date().toISOString(),
        status: body.applyDirectly ? 'approved' : 'pending',
        approved_by_username: body.applyDirectly ? db.currentUser?.full_name || 'Admin' : null,
        approved_at: body.applyDirectly ? new Date().toISOString() : null,
        rejection_reason: null,
      };
      db.stockAdjustments.unshift(adj);
      if (body.applyDirectly) applyStockAdjustment(adj);
      return { data: mapAdjustment(adj) };
    }

    let list = [...db.stockAdjustments];
    if (params.status && params.status !== 'all') list = list.filter((a) => a.status === params.status);
    if (params.search) {
      const q = params.search.toLowerCase();
      list = list.filter((a) => (a.product_name || '').toLowerCase().includes(q) || (a.sku || '').toLowerCase().includes(q));
    }
    list.sort((a, b) => new Date(b.requested_at) - new Date(a.requested_at));
    const page = Number(params.page) || 1;
    const limit = Number(params.limit) || 25;
    const total = list.length;
    const pageRows = list.slice((page - 1) * limit, (page - 1) * limit + limit).map(mapAdjustment);
    return { data: pageRows, meta: { total, page, limit } };
  }

  if (normPath.startsWith('/stock/adjustments/')) {
    const parts = normPath.split('/');
    const id = Number(parts[3]);
    const action = parts[4];
    const adj = db.stockAdjustments.find((a) => a.id === id);
    if (!adj) return { data: null };

    if (action === 'approve' && m === 'PUT') {
      adj.status = 'approved';
      adj.approved_by_username = db.currentUser?.full_name || 'Admin';
      adj.approved_at = new Date().toISOString();
      applyStockAdjustment(adj);
      return { data: mapAdjustment(adj) };
    }
    if (action === 'reject' && m === 'PUT') {
      adj.status = 'rejected';
      adj.approved_by_username = db.currentUser?.full_name || 'Admin';
      adj.rejection_reason = body.rejectionReason || 'Rejected';
      return { data: mapAdjustment(adj) };
    }
    return { data: mapAdjustment(adj) };
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
        if (it.counted_quantity == null || it.counted_quantity === it.system_quantity) return;
        const product = db.products.find((p) => p.id === it.product_id);
        if (!product) return;
        let variant = null;
        if (product.variants && product.variants.length > 0) {
          variant = product.variants.find((v) => v.id === it.variant_id);
          if (variant) variant.stock_quantity = it.counted_quantity;
          product.stock_quantity = product.variants.reduce((acc, v) => acc + (v.stock_quantity || 0), 0);
        } else {
          product.stock_quantity = it.counted_quantity;
        }
        logMovement({
          productId: product.id,
          variantId: variant?.id,
          productName: it.product_name,
          type: 'count_correction',
          quantity: it.counted_quantity - it.system_quantity,
          qtyBefore: it.system_quantity,
          qtyAfter: it.counted_quantity,
          costPrice: it.cost_price,
          reference: count.count_number,
          referenceType: 'stock_count',
        });
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
      const row = supplierInputToRow(body, {
        id: Date.now(),
        outstanding_balance: 0,
        total_purchases: 0,
        credit_limit: 0,
        credit_days: 30,
        is_active: true,
      });
      db.suppliers.unshift(row);
      return { data: mapSupplier(row) };
    }
    let list = [...db.suppliers];
    if (params.search) {
      const q = params.search.toLowerCase();
      list = list.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          (s.contact_person || '').toLowerCase().includes(q) ||
          (s.phone || '').includes(q) ||
          (s.email || '').toLowerCase().includes(q),
      );
    }
    if (params.isActive) {
      const wantActive = params.isActive === 'true';
      list = list.filter((s) => !!s.is_active === wantActive);
    }
    const mapped = list.map(mapSupplier);
    const totals = {
      totalSuppliers: db.suppliers.filter((s) => s.is_active).length,
      totalOutstanding: db.suppliers.reduce((acc, s) => acc + (s.outstanding_balance || 0), 0),
      overdueCount: mapped.reduce((acc, s) => acc + s.overdueCount, 0),
    };
    const page = Number(params.page) || 1;
    const limit = Number(params.limit) || 25;
    const total = mapped.length;
    const pageRows = mapped.slice((page - 1) * limit, (page - 1) * limit + limit);
    return { data: pageRows, meta: { total, page, limit, totals } };
  }

  if (normPath.startsWith('/suppliers/')) {
    const parts = normPath.split('/');
    const id = Number(parts[2]);
    const subRoute = parts[3];
    const idx = db.suppliers.findIndex((s) => s.id === id);
    const sup = idx !== -1 ? db.suppliers[idx] : db.suppliers[0];

    if (subRoute === 'purchase-orders') {
      return { data: db.purchaseOrders.filter((po) => po.supplier_id === id).map(mapPOListRow) };
    }
    if (subRoute === 'payments') {
      const poIds = new Set(db.purchaseOrders.filter((po) => po.supplier_id === id).map((po) => po.id));
      const rows = db.purchaseOrderPayments
        .filter((p) => poIds.has(p.po_id))
        .map((p) => ({
          id: p.id,
          amount: p.amount,
          paymentMethod: p.payment_method,
          paymentDate: p.payment_date,
          poNumber: p.po_number,
          employeeUsername: p.employee_username,
          notes: p.notes || null,
          receiptAttachment: p.receipt_attachment || null,
        }))
        .sort((a, b) => new Date(b.paymentDate) - new Date(a.paymentDate));
      return { data: rows };
    }
    if (subRoute === 'products') {
      const rows = [];
      db.purchaseOrders
        .filter((po) => po.supplier_id === id)
        .forEach((po) => {
          (po.items || []).forEach((it) => {
            const product = db.products.find((p) => p.id === it.product_id);
            let entry = rows.find((r) => r.variantId === (it.variant_id ?? it.product_id));
            if (!entry) {
              entry = {
                variantId: it.variant_id ?? it.product_id,
                productId: it.product_id,
                productName: it.product_name,
                productImage: product?.image || null,
                sku: db.products.find((p) => p.id === it.product_id)?.variants?.find((v) => v.id === it.variant_id)?.sku || product?.sku || null,
                latestCost: it.unit_cost,
                previousCost: null,
                totalUnitsBought: 0,
                purchaseCount: 0,
                lastOrderDate: po.order_date,
              };
              rows.push(entry);
            } else if (new Date(po.order_date) > new Date(entry.lastOrderDate)) {
              entry.previousCost = entry.latestCost;
              entry.latestCost = it.unit_cost;
              entry.lastOrderDate = po.order_date;
            }
            entry.totalUnitsBought += it.quantity || 0;
            entry.purchaseCount += 1;
          });
        });
      return { data: rows };
    }
    if (subRoute === 'returns') {
      const requests = db.returnRequests
        .filter((r) => r.returnType === 'supplier_return' && r.supplierId === id)
        .map((r) => ({
          id: r.id,
          requestNumber: r.requestNumber,
          requestedAt: r.requestedAt,
          poNumber: null,
          poId: null,
          itemCount: r.itemCount,
          totalValue: r.totalValue,
          status: r.status,
        }));
      return { data: { legacy: [], requests } };
    }
    if (subRoute === 'timeline') {
      const events = [];
      const supplierPOs = db.purchaseOrders.filter((po) => po.supplier_id === id);
      supplierPOs.forEach((po) => {
        events.push({ event: 'po_created', at: po.order_date, referenceId: po.id, label: po.po_number });
        if (po.status === 'received' || po.status === 'partially_received') {
          events.push({ event: 'po_received', at: po.received_date || po.order_date, referenceId: po.id, label: po.po_number });
        }
      });
      const poIds = new Set(supplierPOs.map((po) => po.id));
      db.purchaseOrderPayments.filter((p) => poIds.has(p.po_id)).forEach((p) => {
        events.push({ event: 'payment_added', at: p.created_at, referenceId: p.id, label: p.po_number, amount: p.amount, employeeUsername: p.employee_username });
      });
      db.returnRequests.filter((r) => r.returnType === 'supplier_return' && r.supplierId === id).forEach((r) => {
        events.push({ event: 'return_created', at: r.requestedAt, referenceId: r.id, label: r.requestNumber, amount: r.totalValue, employeeUsername: r.requestedByUsername });
      });
      events.sort((a, b) => new Date(b.at) - new Date(a.at));
      return { data: events };
    }

    if (m === 'PUT') {
      if (idx !== -1) db.suppliers[idx] = supplierInputToRow(body, db.suppliers[idx]);
      return { data: mapSupplier(db.suppliers[idx] || sup) };
    }
    if (m === 'DELETE') {
      if (idx !== -1) db.suppliers[idx].is_active = false;
      return { data: { success: true } };
    }
    return { data: mapSupplier(sup) };
  }

  if (normPath === '/purchase-orders') {
    if (m === 'POST') {
      const supplier = db.suppliers.find((s) => s.id === Number(body.supplierId));
      const items = (body.items || []).map((it, i) => {
        const product = db.products.find((p) => p.id === Number(it.productId));
        const variant = product?.variants?.find((v) => v.id === Number(it.variantId));
        const qty = Number(it.quantity) || 0;
        const unitCost = Number(it.costPricePerUnit) || 0;
        return {
          id: Date.now() + i,
          product_id: product?.id ?? Number(it.productId) ?? null,
          variant_id: variant?.id ?? Number(it.variantId) ?? null,
          product_name: variant?.name ? `${product.name} — ${variant.name}` : product?.name || 'Item',
          quantity: qty,
          received_quantity: 0,
          unit_cost: unitCost,
          total: qty * unitCost,
        };
      });
      const subtotal = items.reduce((acc, it) => acc + it.total, 0);
      const taxAmount = Number(body.taxAmount) || 0;
      const grandTotal = subtotal + taxAmount;
      const newPo = {
        id: Date.now(),
        po_number: `PO-2025-${(db.purchaseOrders.length + 36).toString().padStart(4, '0')}`,
        supplier_id: supplier?.id || null,
        supplier_name: supplier?.name || 'Unknown supplier',
        status: 'draft',
        payment_status: 'unpaid',
        order_date: body.orderDate || new Date().toISOString().slice(0, 10),
        expected_delivery_date: body.expectedDate || null,
        due_date: body.dueDate || null,
        subtotal,
        vat_total: taxAmount,
        grand_total: grandTotal,
        paid_amount: 0,
        balance_due: grandTotal,
        notes: body.notes || null,
        attachment_path: null,
        items,
      };
      db.purchaseOrders.unshift(newPo);
      return { data: mapPurchaseOrder(newPo) };
    }

    let list = [...db.purchaseOrders];
    if (params.search) {
      const q = params.search.toLowerCase();
      list = list.filter((po) => po.po_number.toLowerCase().includes(q) || (po.supplier_name || '').toLowerCase().includes(q));
    }
    if (params.supplierId) list = list.filter((po) => po.supplier_id === Number(params.supplierId));
    if (params.status) list = list.filter((po) => po.status === params.status);
    if (params.paymentStatus) list = list.filter((po) => po.payment_status === params.paymentStatus);
    if (params.dateFrom) list = list.filter((po) => po.order_date >= params.dateFrom);
    if (params.dateTo) list = list.filter((po) => po.order_date <= params.dateTo);
    if (params.overdue === 'true') {
      list = list.filter((po) => po.due_date && new Date(po.due_date) < new Date() && po.payment_status !== 'paid' && po.status !== 'cancelled');
    }
    list.sort((a, b) => new Date(b.order_date) - new Date(a.order_date));

    const now = new Date();
    const activePOs = db.purchaseOrders.filter((po) => po.status !== 'cancelled');
    const overdue = activePOs.filter((po) => po.due_date && new Date(po.due_date) < now && po.payment_status !== 'paid');
    const totals = {
      totalPos: db.purchaseOrders.length,
      pendingPayment: activePOs.reduce((acc, po) => acc + (po.balance_due || 0), 0),
      pendingPaymentCount: activePOs.filter((po) => (po.balance_due || 0) > 0).length,
      overdueCount: overdue.length,
      overdueAmount: overdue.reduce((acc, po) => acc + (po.balance_due || 0), 0),
      thisMonthSpent: activePOs
        .filter((po) => new Date(po.order_date).getMonth() === now.getMonth() && new Date(po.order_date).getFullYear() === now.getFullYear())
        .reduce((acc, po) => acc + (po.grand_total || 0), 0),
    };

    const page = Number(params.page) || 1;
    const limit = Number(params.limit) || 25;
    const total = list.length;
    const pageRows = list.slice((page - 1) * limit, (page - 1) * limit + limit).map(mapPOListRow);
    return { data: pageRows, meta: { total, page, limit, totals } };
  }

  if (normPath.startsWith('/purchase-orders/')) {
    const parts = normPath.split('/');
    const id = Number(parts[2]);
    const action = parts[3];
    const idx = db.purchaseOrders.findIndex((p) => p.id === id);
    const po = idx !== -1 ? db.purchaseOrders[idx] : db.purchaseOrders[0];

    if (action === 'confirm' && m === 'POST') {
      if (po.status === 'draft') po.status = 'confirmed';
      return { data: mapPurchaseOrder(po) };
    }

    if (action === 'receive' && m === 'POST') {
      const updates = Array.isArray(body) ? body : body.items || [];
      updates.forEach((u) => {
        const item = po.items.find((it) => it.id === u.id);
        if (!item) return;
        const receiveQty = Number(u.quantityReceived) || 0;
        item.received_quantity = Math.min(item.quantity, (item.received_quantity || 0) + receiveQty);
        const product = db.products.find((p) => p.id === item.product_id);
        if (product) {
          const variant = product.variants?.find((v) => v.id === item.variant_id);
          const before = variant ? variant.stock_quantity || 0 : product.stock_quantity || 0;
          if (variant) {
            variant.stock_quantity = (variant.stock_quantity || 0) + receiveQty;
            product.stock_quantity = product.variants.reduce((acc, v) => acc + (v.stock_quantity || 0), 0);
          } else {
            product.stock_quantity = (product.stock_quantity || 0) + receiveQty;
          }
          if (receiveQty > 0) {
            logMovement({
              productId: product.id,
              variantId: variant?.id,
              productName: item.product_name,
              type: 'purchase',
              quantity: receiveQty,
              qtyBefore: before,
              qtyAfter: variant ? variant.stock_quantity : product.stock_quantity,
              costPrice: item.unit_cost,
              reference: po.po_number,
              referenceType: 'purchase_order',
            });
          }
        }
      });
      const fullyReceived = po.items.every((it) => (it.received_quantity || 0) >= it.quantity);
      const anyReceived = po.items.some((it) => (it.received_quantity || 0) > 0);
      po.status = fullyReceived ? 'received' : anyReceived ? 'partially_received' : po.status;
      if (fullyReceived) po.received_date = new Date().toISOString().slice(0, 10);
      return { data: mapPurchaseOrder(po) };
    }

    if (action === 'payments' && m === 'POST') {
      const payment = {
        id: Date.now(),
        po_id: id,
        po_number: po.po_number,
        amount: Number(body.amount) || 0,
        payment_method: body.paymentMethod || 'cash',
        payment_date: body.paymentDate || new Date().toISOString().slice(0, 10),
        employee_username: db.currentUser?.full_name || 'Admin',
        notes: body.notes || null,
        receipt_attachment: null,
        created_at: new Date().toISOString(),
      };
      db.purchaseOrderPayments.unshift(payment);
      recalcPoPaymentStatus(po);
      return {
        data: {
          payment: { id: payment.id, amount: payment.amount, paymentMethod: payment.payment_method, paymentDate: payment.payment_date, poNumber: payment.po_number, employeeUsername: payment.employee_username, notes: payment.notes, receiptAttachment: null },
          purchaseOrder: mapPurchaseOrder(po),
        },
      };
    }
    if (action === 'payments' && m === 'GET') {
      return {
        data: db.purchaseOrderPayments
          .filter((p) => p.po_id === id)
          .map((p) => ({ id: p.id, amount: p.amount, paymentMethod: p.payment_method, paymentDate: p.payment_date, poNumber: p.po_number, employeeUsername: p.employee_username, notes: p.notes || null, receiptAttachment: p.receipt_attachment || null })),
      };
    }

    if (action === 'attachment' && m === 'POST') {
      po.attachment_path = `receipts/po-${po.id}.pdf`;
      po.updated_at = new Date().toISOString();
      return { data: { attachmentPath: po.attachment_path } };
    }
    if (action === 'attachment' && m === 'DELETE') {
      po.attachment_path = null;
      return { data: { success: true } };
    }

    if (m === 'DELETE') {
      if (po.status === 'draft' && idx !== -1) db.purchaseOrders.splice(idx, 1);
      return { data: { success: true } };
    }
    if (m === 'PUT') {
      if (idx !== -1) db.purchaseOrders[idx] = { ...db.purchaseOrders[idx], ...body };
      return { data: mapPurchaseOrder(db.purchaseOrders[idx] || po) };
    }
    return { data: mapPurchaseOrder(po) };
  }

  if (normPath.startsWith('/supplier-payments/')) {
    const parts = normPath.split('/');
    const id = Number(parts[2]);
    const action = parts[3];
    if (action === 'receipt' && m === 'POST') {
      const payment = db.purchaseOrderPayments.find((p) => p.id === id);
      if (payment) payment.receipt_attachment = `receipts/payment-${id}.pdf`;
      return { data: { receiptAttachment: payment?.receipt_attachment || null } };
    }
    if (m === 'DELETE') {
      const idx = db.purchaseOrderPayments.findIndex((p) => p.id === id);
      let po = null;
      if (idx !== -1) {
        const [payment] = db.purchaseOrderPayments.splice(idx, 1);
        po = db.purchaseOrders.find((p) => p.id === payment.po_id);
        if (po) recalcPoPaymentStatus(po);
      }
      return { data: { success: true, purchaseOrder: po ? mapPurchaseOrder(po) : null } };
    }
    return { data: { success: true } };
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
        const before = variant ? variant.stock_quantity || 0 : product?.stock_quantity || 0;
        if (variant) {
          variant.stock_quantity = Math.max(0, (variant.stock_quantity || 0) - item.quantity);
          if (product?.variants) {
            product.stock_quantity = product.variants.reduce((acc, v) => acc + (v.stock_quantity || 0), 0);
          }
        } else if (product) {
          product.stock_quantity = Math.max(0, (product.stock_quantity || 0) - item.quantity);
        }
        logMovement({
          productId: product?.id,
          variantId: variant?.id,
          productName: item.product_name,
          type: 'sale',
          quantity: -item.quantity,
          qtyBefore: before,
          qtyAfter: variant ? variant.stock_quantity : product?.stock_quantity,
          costPrice: variant ? variant.cost_price : product?.cost_price,
          reference: newInv.invoice_number,
          referenceType: 'invoice',
        });
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
          const before = variant ? variant.stock_quantity || 0 : product?.stock_quantity || 0;
          if (variant) {
            variant.stock_quantity = (variant.stock_quantity || 0) + item.quantity;
            if (product?.variants) {
              product.stock_quantity = product.variants.reduce((acc, v) => acc + (v.stock_quantity || 0), 0);
            }
          } else if (product) {
            product.stock_quantity = (product.stock_quantity || 0) + item.quantity;
          }
          logMovement({
            productId: product?.id,
            variantId: variant?.id,
            productName: item.product_name,
            type: 'return_in',
            quantity: item.quantity,
            qtyBefore: before,
            qtyAfter: variant ? variant.stock_quantity : product?.stock_quantity,
            costPrice: variant ? variant.cost_price : product?.cost_price,
            reference: inv.invoice_number,
            referenceType: 'invoice',
          });
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
  if (normPath === '/warranties/summary') {
    const now = new Date();
    const mapped = db.warranties.map(mapWarranty);
    return {
      data: {
        active_count: mapped.filter((w) => w.status === 'active').length,
        expiring_soon_count: mapped.filter((w) => w.status === 'active' && w.expiringSoon).length,
        expiring_this_month_count: db.warranties.filter((w) => {
          const end = new Date(w.end_date);
          return w.status === 'active' && end.getMonth() === now.getMonth() && end.getFullYear() === now.getFullYear();
        }).length,
        expired_this_year_count: mapped.filter((w) => w.status === 'expired' && new Date(w.endDate).getFullYear() === now.getFullYear()).length,
        claimed_count: mapped.filter((w) => w.claimsCount > 0).length,
      },
    };
  }

  if (normPath === '/warranties/lookup') {
    const q = (params.q || '').toLowerCase();
    const match = db.warranties
      .filter((w) =>
        (w.serial_number || '').toLowerCase().includes(q) ||
        w.warranty_code.toLowerCase().includes(q) ||
        (w.customer_phone || '').includes(q),
      )
      .map(mapWarranty);
    return { data: match };
  }

  if (normPath.startsWith('/warranties/product-stats/')) {
    const productId = Number(normPath.split('/')[3]);
    const list = db.warranties.filter((w) => w.product_id === productId);
    const claims = db.warrantyClaims.filter((c) => list.some((w) => w.id === c.warranty_id));
    const openClaims = claims.filter((c) => !['resolved', 'rejected'].includes(c.status));
    const sortedClaims = [...claims].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return {
      data: {
        productId,
        totalWarranties: list.length,
        activeCount: list.filter((w) => w.status === 'active').length,
        totalClaims: claims.length,
        openClaims: openClaims.length,
        claimRatePct: list.length > 0 ? Math.round((claims.length / list.length) * 1000) / 10 : 0,
        mostRecentReason: sortedClaims[0]?.issue_description || null,
      },
    };
  }

  if (normPath === '/warranties') {
    if (m === 'POST') {
      const product = db.products.find((p) => p.id === Number(body.productId));
      const variant = product?.variants?.find((v) => v.id === Number(body.variantId));
      const customer = body.customerId ? db.customers.find((c) => c.id === Number(body.customerId)) : null;
      const start = body.startDate || new Date().toISOString().slice(0, 10);
      const durationMonths = Number(body.durationMonths) || 12;
      const end = new Date(start);
      end.setMonth(end.getMonth() + durationMonths);
      const newWar = {
        id: Date.now(),
        warranty_code: `WAR-2025-${(db.warranties.length + 46).toString().padStart(4, '0')}`,
        warranty_type: body.warrantyType || 'customer',
        invoice_id: null,
        invoice_number: null,
        customer_id: customer?.id || null,
        customer_name: customer?.name || 'Walk-in customer',
        customer_phone: customer?.phone || null,
        product_id: product?.id || null,
        variant_id: variant?.id || null,
        product_name: variant?.name ? `${product.name} — ${variant.name}` : product?.name || 'Product',
        serial_number: body.serialNumber || null,
        start_date: start,
        end_date: end.toISOString().slice(0, 10),
        duration_months: durationMonths,
        status: 'active',
        terms: body.terms || null,
        created_by_username: db.currentUser?.full_name || 'Admin',
        created_at: new Date().toISOString(),
        voided_at: null,
        void_reason: null,
      };
      db.warranties.unshift(newWar);
      return { data: mapWarranty(newWar) };
    }

    let list = [...db.warranties];
    if (params.search || params.q) {
      const q = (params.search || params.q).toLowerCase();
      list = list.filter(
        (w) =>
          (w.serial_number || '').toLowerCase().includes(q) ||
          w.warranty_code.toLowerCase().includes(q) ||
          (w.customer_name || '').toLowerCase().includes(q) ||
          (w.product_name || '').toLowerCase().includes(q) ||
          (w.invoice_number || '').toLowerCase().includes(q),
      );
    }
    if (params.invoice_id) list = list.filter((w) => String(w.invoice_id) === String(params.invoice_id));
    if (params.warranty_type) list = list.filter((w) => (w.warranty_type || 'customer') === params.warranty_type);
    let mapped = list.map(mapWarranty);
    if (params.status) mapped = mapped.filter((w) => w.status === params.status);
    if (params.expiring_soon === 'true') mapped = mapped.filter((w) => w.status === 'active' && w.expiringSoon);
    if (params.expired === 'true') mapped = mapped.filter((w) => w.status === 'expired');
    const sort = params.sort || 'end_date_asc';
    mapped.sort((a, b) => {
      if (sort === 'end_date_desc') return new Date(b.endDate) - new Date(a.endDate);
      if (sort === 'created_desc') return new Date(b.createdAt) - new Date(a.createdAt);
      if (sort === 'product') return (a.productName || '').localeCompare(b.productName || '');
      if (sort === 'customer') return (a.customerName || '').localeCompare(b.customerName || '');
      return new Date(a.endDate) - new Date(b.endDate);
    });
    const page = Number(params.page) || 1;
    const limit = Number(params.limit) || 25;
    const total = mapped.length;
    const pageRows = mapped.slice((page - 1) * limit, (page - 1) * limit + limit);
    return { data: pageRows, meta: { total, page, limit } };
  }

  if (normPath.startsWith('/warranties/')) {
    const parts = normPath.split('/');
    const id = Number(parts[2]);
    const action = parts[3];
    const idx = db.warranties.findIndex((w) => w.id === id);
    const war = idx !== -1 ? db.warranties[idx] : db.warranties[0];

    if (action === 'void' && m === 'POST') {
      war.status = 'void';
      war.voided_at = new Date().toISOString();
      war.void_reason = body.reason || null;
      return { data: mapWarrantyDetail(war) };
    }
    if (m === 'PUT') {
      if (idx !== -1) db.warranties[idx] = { ...db.warranties[idx], ...body };
      return { data: mapWarrantyDetail(db.warranties[idx] || war) };
    }
    return { data: mapWarrantyDetail(war) };
  }

  if (normPath === '/warranty-claims/summary') {
    const claims = db.warrantyClaims;
    const now = new Date();
    return {
      data: {
        open_count: claims.filter((c) => c.status === 'under_inspection').length,
        in_progress_count: claims.filter((c) => c.status === 'in_progress').length,
        resolved_this_month: claims.filter(
          (c) => c.resolved_date && new Date(c.resolved_date).getMonth() === now.getMonth() && new Date(c.resolved_date).getFullYear() === now.getFullYear(),
        ).length,
        rejected_count: claims.filter((c) => c.status === 'rejected').length,
        supplier_pending: claims.filter((c) => c.supplier_claim_raised && !c.supplier_claim_resolved).length,
      },
    };
  }

  if (normPath === '/warranty-claims') {
    if (m === 'POST') {
      const warranty = db.warranties.find((w) => w.id === Number(body.warrantyId));
      const newClaim = {
        id: Date.now(),
        claim_number: `CLM-2025-${(db.warrantyClaims.length + 9).toString().padStart(4, '0')}`,
        warranty_id: warranty?.id || null,
        product_name: warranty?.product_name || null,
        serial_number: warranty?.serial_number || null,
        customer_name: warranty?.customer_name || null,
        customer_phone: warranty?.customer_phone || null,
        issue_description: body.issueDescription || '',
        status: 'under_inspection',
        created_by_username: db.currentUser?.full_name || 'Admin',
        created_at: new Date().toISOString(),
        resolution: null,
        notes: null,
        resolved_date: null,
        resolved_by_username: null,
        replacement_invoice_id: null,
        replacement_invoice_number: null,
        supplier_claim_raised: false,
        supplier_claim_resolved: false,
      };
      db.warrantyClaims.unshift(newClaim);
      return { data: mapWarrantyClaim(newClaim) };
    }

    let list = [...db.warrantyClaims];
    if (params.status) list = list.filter((c) => c.status === params.status);
    if (params.search) {
      const q = params.search.toLowerCase();
      list = list.filter(
        (c) =>
          c.claim_number.toLowerCase().includes(q) ||
          (c.customer_name || '').toLowerCase().includes(q) ||
          (c.product_name || '').toLowerCase().includes(q) ||
          (c.serial_number || '').toLowerCase().includes(q),
      );
    }
    list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const page = Number(params.page) || 1;
    const limit = Number(params.limit) || 25;
    const total = list.length;
    const pageRows = list.slice((page - 1) * limit, (page - 1) * limit + limit).map(mapWarrantyClaim);
    return { data: pageRows, meta: { total, page, limit } };
  }

  if (normPath.startsWith('/warranty-claims/')) {
    const parts = normPath.split('/');
    const id = Number(parts[2]);
    const action = parts[3];
    const claim = db.warrantyClaims.find((c) => c.id === id) || db.warrantyClaims[0];

    if (action === 'resolve' && m === 'POST') {
      claim.status = body.resolution === 'rejected' ? 'rejected' : 'resolved';
      claim.resolution = body.resolution || null;
      claim.notes = body.notes || null;
      claim.resolved_date = new Date().toISOString().slice(0, 10);
      claim.resolved_by_username = db.currentUser?.full_name || 'Admin';
      return { data: mapWarrantyClaim(claim) };
    }
    if (action === 'raise-supplier-claim' && m === 'POST') {
      claim.supplier_claim_raised = true;
      claim.notes = body.notes || claim.notes;
      return { data: mapWarrantyClaim(claim) };
    }
    if (action === 'supplier-resolved' && m === 'POST') {
      claim.supplier_claim_resolved = !!body.resolved;
      claim.notes = body.notes || claim.notes;
      return { data: mapWarrantyClaim(claim) };
    }
    if (m === 'PUT') {
      Object.assign(claim, body);
      return { data: mapWarrantyClaim(claim) };
    }
    return { data: mapWarrantyClaim(claim) };
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
            let variant = null;
            const before = product.stock_quantity || 0;
            let variantBefore = null;
            if (it.variantId && product.variants?.length) {
              variant = product.variants.find((v) => v.id === it.variantId);
              variantBefore = variant?.stock_quantity || 0;
              if (variant) variant.stock_quantity = (variant.stock_quantity || 0) + it.quantity;
              product.stock_quantity = product.variants.reduce((acc, v) => acc + (v.stock_quantity || 0), 0);
            } else {
              product.stock_quantity = (product.stock_quantity || 0) + it.quantity;
            }
            logMovement({
              productId: product.id,
              variantId: variant?.id,
              productName: it.productName,
              type: 'return_in',
              quantity: it.quantity,
              qtyBefore: variant ? variantBefore : before,
              qtyAfter: variant ? variant.stock_quantity : product.stock_quantity,
              costPrice: variant ? variant.cost_price : product.cost_price,
              reference: reqRow.requestNumber,
              referenceType: 'return_order',
            });
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

  // 11. Treasury & Cash Drawer
  if (normPath === '/treasury/summary' || normPath === '/treasury') {
    const cd = db.treasury.cashDrawer;
    const todayStr = new Date().toISOString().slice(0, 10);
    const todayTx = db.treasury.cashTransactions.filter((t) => t.timestamp.slice(0, 10) === todayStr);
    const moneyIn = todayTx.filter((t) => t.direction === 'in').reduce((acc, t) => acc + t.amount, 0);
    const moneyOut = todayTx.filter((t) => t.direction === 'out').reduce((acc, t) => acc + t.amount, 0);
    const activeBanks = db.treasury.bankAccounts.filter((b) => b.is_active !== false);
    const banksTotal = activeBanks.reduce((acc, b) => acc + b.balance, 0);
    const receivables = db.customers.reduce((acc, c) => acc + (c.outstanding_balance || 0), 0);
    const payables = db.suppliers.reduce((acc, s) => acc + (s.outstanding_balance || 0), 0);
    const recentCash = db.treasury.cashTransactions.slice(0, 15).map((t) => ({
      id: t.id,
      source: 'cash',
      transactionType: t.transaction_type,
      bankName: null,
      notes: t.notes,
      timestamp: t.timestamp,
      employeeUsername: t.employee_username,
      direction: t.direction,
      amount: t.amount,
    }));
    const recentBank = db.treasury.bankTransactions.slice(0, 15).map((t) => {
      const acc = db.treasury.bankAccounts.find((b) => b.id === t.bank_account_id);
      return {
        id: t.id,
        source: 'bank',
        transactionType: t.transaction_type,
        bankName: acc?.bank_name || null,
        notes: t.notes || t.description,
        timestamp: t.timestamp,
        employeeUsername: t.employee_username,
        direction: t.direction,
        amount: t.amount,
      };
    });
    const recent = [...recentCash, ...recentBank].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).slice(0, 10);
    return {
      data: {
        cash: { balance: cd.current_balance, status: cd.status, sessionId: cd.session_id },
        banks: { total: banksTotal, accounts: activeBanks.map(mapBankAccount) },
        receivables,
        payables,
        netPosition: cd.current_balance + banksTotal + receivables - payables,
        totalAssets: cd.current_balance + banksTotal,
        today: { moneyIn, moneyOut, inCount: todayTx.filter((t) => t.direction === 'in').length, outCount: todayTx.filter((t) => t.direction === 'out').length },
        recent,
      },
    };
  }

  if (normPath === '/cash-drawer/open') {
    const cd = db.treasury.cashDrawer;
    const nextId = Math.max(0, ...db.treasury.cashSessions.map((s) => s.id)) + 1;
    cd.status = 'open';
    cd.session_id = nextId;
    cd.opening_balance = Number(body.openingBalance) || 0;
    cd.current_balance = Number(body.openingBalance) || 0;
    cd.opened_by_username = db.currentUser?.full_name || 'Admin';
    cd.last_opened_at = new Date().toISOString();
    db.treasury.cashSessions.unshift({
      id: nextId,
      opened_at: cd.last_opened_at,
      opened_by_username: cd.opened_by_username,
      opening_balance: cd.opening_balance,
      closing_balance: null,
      discrepancy: null,
      closed_at: null,
    });
    logCashTransaction({ type: 'opening_float', direction: 'in', amount: cd.opening_balance, notes: body.notes });
    return { data: { status: cd.status, currentBalance: cd.current_balance, openingBalance: cd.opening_balance, lastOpenedAt: cd.last_opened_at, lastClosedAt: cd.last_closed_at, openedByUsername: cd.opened_by_username, session: { id: cd.session_id } } };
  }

  if (normPath === '/cash-drawer/close') {
    const cd = db.treasury.cashDrawer;
    const expected = cd.current_balance;
    const counted = Number(body.closingBalance) || 0;
    const discrepancy = Math.round((counted - expected) * 100) / 100;
    cd.status = 'closed';
    cd.current_balance = counted;
    cd.last_closed_at = new Date().toISOString();
    const session = db.treasury.cashSessions.find((s) => s.id === cd.session_id);
    if (session) {
      session.closing_balance = counted;
      session.discrepancy = discrepancy;
      session.closed_at = cd.last_closed_at;
    }
    if (Math.abs(discrepancy) > 0.01) {
      logCashTransaction({ type: 'adjustment', direction: discrepancy > 0 ? 'in' : 'out', amount: Math.abs(discrepancy), referenceType: 'count_correction', notes: body.notes || 'Closing count discrepancy' });
    }
    return { data: { reconciliation: { expectedBalance: expected, countedBalance: counted, discrepancy, sessionId: cd.session_id } } };
  }

  if (normPath === '/cash-drawer/adjust') {
    logCashTransaction({ type: 'adjustment', direction: body.direction === 'out' ? 'out' : 'in', amount: Number(body.amount) || 0, referenceType: 'adjustment', notes: body.reason });
    const cd = db.treasury.cashDrawer;
    return { data: { status: cd.status, currentBalance: cd.current_balance } };
  }

  if (normPath === '/cash-drawer/transfer') {
    const amount = Number(body.amount) || 0;
    logCashTransaction({ type: 'transfer_out', direction: 'out', amount, referenceType: 'transfer', notes: body.notes });
    const bank = db.treasury.bankAccounts.find((b) => b.id === Number(body.toId));
    if (bank) logBankTransaction(bank, { type: 'transfer_in', direction: 'in', amount, description: 'Cash drawer transfer', notes: body.notes });
    db.treasury.cashTransfers.unshift({
      id: Date.now(),
      transfer_date: body.transferDate || new Date().toISOString().slice(0, 10),
      from_label: 'Cash drawer',
      to_label: bank?.bank_name || 'Bank',
      amount,
      employee_username: db.currentUser?.full_name || 'Admin',
      notes: body.notes || null,
    });
    return { data: { success: true } };
  }

  if (normPath === '/treasury/cash-drawer' || normPath === '/cash-drawer') {
    if (m === 'POST') {
      db.treasury.cashDrawer = { ...db.treasury.cashDrawer, ...body };
    }
    const cd = db.treasury.cashDrawer;
    return { data: { status: cd.status, currentBalance: cd.current_balance, openingBalance: cd.opening_balance, lastOpenedAt: cd.last_opened_at, lastClosedAt: cd.last_closed_at, openedByUsername: cd.opened_by_username, session: { id: cd.session_id } } };
  }

  if (normPath === '/cash-drawer/sessions' || normPath === '/treasury/sessions') {
    const list = [...db.treasury.cashSessions].sort((a, b) => new Date(b.openedAt || b.opened_at) - new Date(a.openedAt || a.opened_at));
    return { data: list.map(mapCashSession), meta: { total: list.length } };
  }

  if (normPath.startsWith('/cash-drawer/sessions/')) {
    const id = Number(normPath.split('/')[3]);
    const session = db.treasury.cashSessions.find((s) => s.id === id);
    return { data: session ? mapCashSession(session) : null };
  }

  if (normPath === '/cash-drawer/transfers') {
    const list = [...db.treasury.cashTransfers].sort((a, b) => new Date(b.transfer_date) - new Date(a.transfer_date));
    return { data: list.map(mapCashTransfer), meta: { total: list.length } };
  }

  if (normPath === '/treasury/transactions' || normPath === '/cash-drawer/transactions') {
    const limit = Number(params.limit) || 50;
    const list = [...db.treasury.cashTransactions].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    return { data: list.slice(0, limit).map(mapCashTransaction), meta: { total: list.length } };
  }

  if (normPath === '/bank-accounts') {
    if (m === 'POST') {
      const newAcc = {
        id: Date.now(),
        bank_name: body.bankName,
        account_name: body.accountName,
        account_number: body.accountNumber || null,
        iban: body.iban || null,
        currency: body.currency || 'AED',
        balance: Number(body.openingBalance) || 0,
        is_primary: !!body.isDefault,
        is_active: true,
        notes: body.notes || null,
        last_activity_at: new Date().toISOString(),
      };
      if (newAcc.is_primary) db.treasury.bankAccounts.forEach((b) => { b.is_primary = false; });
      db.treasury.bankAccounts.push(newAcc);
      return { data: mapBankAccount(newAcc) };
    }
    const list = params.include_inactive === 'true' ? db.treasury.bankAccounts : db.treasury.bankAccounts.filter((b) => b.is_active !== false);
    return { data: list.map(mapBankAccount), meta: { total: list.length } };
  }

  if (normPath.startsWith('/bank-accounts/')) {
    const parts = normPath.split('/');
    const id = Number(parts[2]);
    const action = parts[3];
    const idx = db.treasury.bankAccounts.findIndex((b) => b.id === id);
    const bank = idx !== -1 ? db.treasury.bankAccounts[idx] : db.treasury.bankAccounts[0];

    if (action === 'transactions' && m === 'GET') {
      const limit = Number(params.limit) || 50;
      const list = db.treasury.bankTransactions.filter((t) => t.bank_account_id === id).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      return { data: list.slice(0, limit).map(mapBankTransaction), meta: { total: list.length } };
    }
    if (action === 'deposit' && m === 'POST') {
      logBankTransaction(bank, { type: 'deposit', direction: 'in', amount: Number(body.amount) || 0, description: body.description, notes: body.notes });
      return { data: mapBankAccount(bank) };
    }
    if (action === 'withdrawal' && m === 'POST') {
      logBankTransaction(bank, { type: 'withdrawal', direction: 'out', amount: Number(body.amount) || 0, description: body.description, notes: body.notes });
      return { data: mapBankAccount(bank) };
    }
    if (action === 'transfer' && m === 'POST') {
      const amount = Number(body.amount) || 0;
      logBankTransaction(bank, { type: 'transfer_out', direction: 'out', amount, description: 'Transfer out', notes: body.notes });
      let toLabel = 'Account';
      if (body.toType === 'bank_account') {
        const target = db.treasury.bankAccounts.find((b) => b.id === Number(body.toId));
        if (target) {
          logBankTransaction(target, { type: 'transfer_in', direction: 'in', amount, description: 'Transfer in', notes: body.notes });
          toLabel = target.bank_name;
        }
      } else if (body.toType === 'cash_drawer') {
        logCashTransaction({ type: 'transfer_in', direction: 'in', amount, referenceType: 'transfer', notes: body.notes });
        toLabel = 'Cash drawer';
      }
      db.treasury.cashTransfers.unshift({
        id: Date.now(),
        transfer_date: body.transferDate || new Date().toISOString().slice(0, 10),
        from_label: bank.bank_name,
        to_label: toLabel,
        amount,
        employee_username: db.currentUser?.full_name || 'Admin',
        notes: body.notes || null,
      });
      return { data: { success: true } };
    }

    if (m === 'PUT') {
      if (idx !== -1) {
        if (body.bankName !== undefined) bank.bank_name = body.bankName;
        if (body.accountName !== undefined) bank.account_name = body.accountName;
        if (body.accountNumber !== undefined) bank.account_number = body.accountNumber;
        if (body.iban !== undefined) bank.iban = body.iban;
        if (body.notes !== undefined) bank.notes = body.notes;
        if (body.isDefault !== undefined) {
          if (body.isDefault) db.treasury.bankAccounts.forEach((b) => { b.is_primary = false; });
          bank.is_primary = !!body.isDefault;
        }
      }
      return { data: mapBankAccount(bank) };
    }
    if (m === 'DELETE') {
      if (idx !== -1) db.treasury.bankAccounts[idx].is_active = false;
      return { data: { success: true } };
    }
    return { data: mapBankAccount(bank) };
  }

  // 12. Attendance & HR
  if (normPath === '/attendance/today') {
    const rows = db.attendance.today.map(mapAttendanceRow);
    const counters = {
      present: rows.filter((r) => r.status === 'present').length,
      late: rows.filter((r) => r.status === 'late').length,
      absent: rows.filter((r) => r.status === 'absent').length,
      leave: rows.filter((r) => r.status === 'on_leave').length,
      notCheckedIn: rows.filter((r) => r.status === 'not_checked_in').length,
    };
    return { data: { date: new Date().toISOString().slice(0, 10), counters, employees: rows } };
  }

  if (normPath === '/attendance/corrections') {
    if (m === 'POST') {
      const emp = db.employees.find((e) => e.id === Number(body.employeeId)) || db.employees.find((e) => e.id === db.currentUser?.id);
      const attendanceRow = db.attendance.today.find((a) => a.id === Number(body.attendanceId));
      const newCorrection = {
        id: Date.now(),
        employee_id: emp?.id ?? attendanceRow?.employee_id ?? null,
        employee_name: emp?.name || attendanceRow?.employee_name || db.currentUser?.full_name,
        attendance_id: Number(body.attendanceId) || null,
        attendance_date: attendanceRow ? db.attendance.today.find((a) => a.id === Number(body.attendanceId))?.check_in?.slice(0, 10) : new Date().toISOString().slice(0, 10),
        reason: body.reason || 'other',
        request_note: body.requestNote || '',
        old_check_in: attendanceRow?.check_in || null,
        old_check_out: attendanceRow?.check_out || null,
        new_check_in: body.newCheckIn || null,
        new_check_out: body.newCheckOut || null,
        status: 'pending',
        requested_by: db.currentUser?.id || null,
        rejection_reason: null,
      };
      db.attendance.corrections.unshift(newCorrection);
      return { data: mapCorrection(newCorrection) };
    }
    let list = [...db.attendance.corrections];
    if (params.status) list = list.filter((c) => c.status === params.status);
    return { data: list.map(mapCorrection), meta: { total: list.length } };
  }

  if (normPath.startsWith('/attendance/corrections/')) {
    const parts = normPath.split('/');
    const id = Number(parts[3]);
    const action = parts[4];
    const correction = db.attendance.corrections.find((c) => c.id === id);
    if (correction && action === 'approve' && m === 'PUT') {
      correction.status = 'approved';
      const attendanceRow = db.attendance.today.find((a) => a.id === correction.attendance_id);
      if (attendanceRow) {
        attendanceRow.check_in = correction.new_check_in || attendanceRow.check_in;
        attendanceRow.check_out = correction.new_check_out || attendanceRow.check_out;
      }
      return { data: mapCorrection(correction) };
    }
    if (correction && action === 'reject' && m === 'PUT') {
      correction.status = 'rejected';
      correction.rejection_reason = body.rejectionReason || 'Rejected';
      return { data: mapCorrection(correction) };
    }
    return { data: correction ? mapCorrection(correction) : null };
  }

  if (normPath === '/attendance/monthly') {
    const [year, month] = [Number(params.year) || new Date().getFullYear(), Number(params.month) || new Date().getMonth() + 1];
    const daysInMonth = new Date(year, month, 0).getDate();
    let employees = db.employees.filter((e) => e.status === 'active');
    if (params.employeeId) employees = employees.filter((e) => e.id === Number(params.employeeId));
    const rows = employees.map((e) => {
      const todayRow = db.attendance.today.find((a) => a.employee_id === e.id);
      const days = {};
      let present = 0;
      let late = 0;
      const totalWorkDays = Array.from({ length: daysInMonth }, (_, i) => i + 1).filter((d) => {
        const dow = new Date(year, month - 1, d).getDay();
        return dow !== 5 && dow !== 6;
      }).length;
      for (let d = 1; d <= daysInMonth; d += 1) {
        const dow = new Date(year, month - 1, d).getDay();
        if (dow === 5 || dow === 6) { days[d] = { status: 'weekend' }; continue; }
        if (d === new Date().getDate() && month === new Date().getMonth() + 1 && year === new Date().getFullYear() && todayRow) {
          days[d] = { status: todayRow.status, checkIn: todayRow.check_in, checkOut: todayRow.check_out };
          if (todayRow.status === 'present') present += 1;
          if (todayRow.status === 'late') { present += 1; late += 1; }
        } else if (d < new Date().getDate() || month < new Date().getMonth() + 1 || year < new Date().getFullYear()) {
          days[d] = { status: 'present', checkIn: null, checkOut: null };
          present += 1;
        } else {
          days[d] = { status: 'upcoming' };
        }
      }
      const totalHours = present * (todayRow?.standard_hours || 8);
      return {
        employeeId: e.id,
        employeeName: e.name,
        roleTitle: e.job_title,
        days,
        summary: { present, late, absent: Math.max(0, totalWorkDays - present), leave: 0, totalHours, overtimeHours: 0, shortageHours: 0 },
      };
    });
    return { data: { year, month, daysInMonth, rows } };
  }

  if (normPath === '/attendance/check-in' || normPath === '/attendance/check-out') {
    const rec = db.attendance.today.find((a) => a.employee_id === db.currentUser.id) || db.attendance.today[0];
    if (normPath.endsWith('check-in')) {
      rec.status = 'present';
      rec.check_in = new Date().toISOString();
    } else {
      rec.check_out = new Date().toISOString();
    }
    return { data: mapAttendanceRow(rec) };
  }

  if (normPath.startsWith('/attendance/') && normPath.endsWith('/summary')) {
    const employeeId = Number(normPath.split('/')[2]);
    const balances = employeeLeaveBalances(employeeId, Number(params.year) || new Date().getFullYear());
    return { data: { employeeId, ...balances } };
  }

  if (normPath.startsWith('/attendance/')) {
    const parts = normPath.split('/');
    const maybeId = parts[2];
    if (maybeId && !Number.isNaN(Number(maybeId))) {
      const employeeId = Number(maybeId);
      const list = db.attendance.today.filter((a) => a.employee_id === employeeId).map(mapAttendanceRow);
      return { data: list, meta: { total: list.length } };
    }
  }

  if (normPath === '/attendance') {
    if (m === 'POST') {
      const emp = db.employees.find((e) => e.id === Number(body.employeeId));
      const newRow = {
        id: Date.now(),
        employee_id: emp?.id ?? null,
        employee_name: emp?.name || 'Employee',
        role_title: emp?.job_title || null,
        status: body.status || 'present',
        late_minutes: 0,
        check_in: body.checkIn || null,
        check_out: body.checkOut || null,
        check_in_method: 'manual',
        standard_hours: 8,
      };
      db.attendance.today.push(newRow);
      return { data: mapAttendanceRow(newRow) };
    }
    let list = [...db.attendance.today];
    if (params.employeeId) list = list.filter((a) => a.employee_id === Number(params.employeeId));
    if (params.from) {
      const today = new Date().toISOString().slice(0, 10);
      if (params.from > today) list = [];
    }
    return { data: list.map(mapAttendanceRow), meta: { total: list.length } };
  }

  if (normPath === '/leave-balances') {
    const year = Number(params.year) || new Date().getFullYear();
    const rows = db.employees.filter((e) => e.status === 'active').map((e) => ({
      employeeId: e.id,
      employeeName: e.name,
      roleTitle: e.job_title,
      balances: employeeLeaveBalances(e.id, year),
    }));
    return { data: { rows }, meta: { total: rows.length } };
  }

  if (normPath === '/leave-balances/carry-over') {
    const fromYear = Number(body.fromYear);
    db.employees.forEach((e) => {
      const bal = employeeLeaveBalances(e.id, fromYear);
      const existing = db.attendance.leaveOverrides[e.id] || {};
      db.attendance.leaveOverrides[e.id] = {
        ...existing,
        annual: { ...(existing.annual || {}), carriedOverDays: bal.annual.remainingDays },
      };
    });
    return { data: { success: true, count: db.employees.length } };
  }

  if (normPath.startsWith('/leave-balances/')) {
    const employeeId = Number(normPath.split('/')[2]);
    if (m === 'PUT') {
      const existing = db.attendance.leaveOverrides[employeeId] || {};
      db.attendance.leaveOverrides[employeeId] = { ...existing, ...(body.payload || {}) };
      const emp = db.employees.find((e) => e.id === employeeId);
      return { data: { employeeId, employeeName: emp?.name, balances: employeeLeaveBalances(employeeId, Number(body.year) || new Date().getFullYear()) } };
    }
    const year = Number(params.year) || new Date().getFullYear();
    const balances = employeeLeaveBalances(employeeId, year);
    return { data: { employeeId, balances: Object.entries(balances).map(([leaveType, b]) => ({ leaveType, ...b })) } };
  }

  if (normPath === '/leaves/calculate-days') {
    const workingDays = params.startDate && params.endDate ? businessDaysBetween(params.startDate, params.endDate) : 0;
    return { data: { workingDays } };
  }

  if (normPath === '/attendance/leaves' || normPath === '/leaves') {
    if (m === 'POST') {
      const emp = db.employees.find((e) => e.id === Number(body.employeeId));
      const totalDays = businessDaysBetween(body.startDate, body.endDate);
      const newLeave = {
        id: Date.now(),
        employee_id: emp?.id ?? null,
        employee_name: emp?.name || 'Employee',
        leave_type: body.leaveType || 'annual',
        start_date: body.startDate,
        end_date: body.endDate,
        total_days: totalDays,
        status: 'pending',
        reason: body.reason || '',
        requested_by: db.currentUser?.id || null,
        rejection_reason: null,
        created_at: new Date().toISOString(),
      };
      db.attendance.leaves.unshift(newLeave);
      return { data: mapLeave(newLeave) };
    }
    let list = [...db.attendance.leaves];
    if (params.status) list = list.filter((l) => l.status === params.status);
    if (params.leaveType) list = list.filter((l) => l.leave_type === params.leaveType);
    if (params.employeeId) list = list.filter((l) => l.employee_id === Number(params.employeeId));
    return { data: list.map(mapLeave), meta: { total: list.length } };
  }

  if (normPath.startsWith('/leaves/')) {
    const parts = normPath.split('/');
    const id = Number(parts[2]);
    const action = parts[3];
    const leave = db.attendance.leaves.find((l) => l.id === id);
    if (leave && action === 'approve' && m === 'PUT') {
      leave.status = 'approved';
      return { data: mapLeave(leave) };
    }
    if (leave && action === 'reject' && m === 'PUT') {
      leave.status = 'rejected';
      leave.rejection_reason = body.rejectionReason || 'Rejected';
      return { data: mapLeave(leave) };
    }
    if (leave && action === 'cancel' && m === 'PUT') {
      leave.status = 'cancelled';
      return { data: mapLeave(leave) };
    }
    return { data: leave ? mapLeave(leave) : null };
  }

  if (normPath === '/attendance/holidays' || normPath === '/holidays') {
    if (m === 'POST') {
      const newHol = { id: Date.now(), name: body.name, date: body.date, type: body.type || 'public' };
      db.attendance.holidays.push(newHol);
      return { data: mapHoliday(newHol) };
    }
    let list = [...db.attendance.holidays];
    if (params.year) list = list.filter((h) => h.date.slice(0, 4) === String(params.year));
    return { data: list.map(mapHoliday) };
  }

  if (normPath.startsWith('/holidays/')) {
    const id = Number(normPath.split('/')[2]);
    if (m === 'DELETE') {
      db.attendance.holidays = db.attendance.holidays.filter((h) => h.id !== id);
      return { data: { success: true } };
    }
    const h = db.attendance.holidays.find((x) => x.id === id);
    return { data: h ? mapHoliday(h) : null };
  }

  // 13. Bills & Expenses
  if (normPath === '/bill-payments/upcoming') {
    const now = new Date();
    const mapped = db.billPayments.map(mapBillPayment);
    const overdue = mapped.filter((p) => p.status === 'overdue');
    const dueToday = mapped.filter((p) => p.status === 'due');
    const thisWeek = mapped.filter((p) => p.status === 'upcoming' && p.daysUntilDue <= 7);
    const activeBills = db.bills.filter((b) => (b.lifecycle_status || 'active') === 'active');
    const monthlyRecurringTotal = activeBills.filter((b) => b.recurring === 'monthly').reduce((acc, b) => acc + (b.amount || 0), 0);
    const paidThisMonth = db.billPayments
      .filter((p) => p.status === 'paid' && p.paid_date && new Date(p.paid_date).getMonth() === now.getMonth() && new Date(p.paid_date).getFullYear() === now.getFullYear())
      .reduce((acc, p) => acc + (p.amount_due || 0), 0);
    return {
      data: {
        totals: {
          monthlyRecurringTotal,
          overdueAmount: overdue.reduce((acc, p) => acc + p.amountDue, 0),
          dueThisWeekAmount: [...dueToday, ...thisWeek].reduce((acc, p) => acc + p.amountDue, 0),
          paidThisMonth,
        },
        buckets: { overdue, dueToday, thisWeek },
      },
    };
  }

  if (normPath === '/bill-payments') {
    let list = db.billPayments.map(mapBillPayment);
    if (params.status) list = list.filter((p) => p.status === params.status);
    list.sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
    return { data: list, meta: { total: list.length } };
  }

  if (normPath.startsWith('/bill-payments/')) {
    const parts = normPath.split('/');
    const id = Number(parts[2]);
    const action = parts[3];
    const payment = db.billPayments.find((p) => p.id === id);
    if (payment && action === 'pay' && m === 'POST') {
      payment.status = 'paid';
      payment.paid_date = new Date().toISOString().slice(0, 10);
      payment.payment_method = body.paymentMethod || 'bank';
      const bank = db.treasury.bankAccounts.find((a) => a.id === Number(body.bankAccountId));
      payment.bank_name = bank?.bank_name || null;
      if (Number(body.amountPaid)) payment.amount_due = Number(body.amountPaid);
      if (payment.payment_method === 'cash') {
        logCashTransaction({ type: 'bill_payment', direction: 'out', amount: payment.amount_due, referenceType: 'bill_payment', notes: `Bill payment #${payment.id}` });
      } else if (bank) {
        logBankTransaction(bank, { type: 'bill_payment', direction: 'out', amount: payment.amount_due, description: 'Bill payment', notes: null });
      }
      // Roll the recurring bill forward to its next cycle.
      const bill = db.bills.find((b) => b.id === payment.bill_id);
      if (bill) {
        const next = new Date(`${payment.due_date}T00:00:00`);
        if (bill.recurring === 'monthly') next.setMonth(next.getMonth() + 1);
        else if (bill.recurring === 'quarterly') next.setMonth(next.getMonth() + 3);
        else next.setFullYear(next.getFullYear() + 1);
        db.billPayments.push({ id: Date.now(), bill_id: bill.id, due_date: next.toISOString().slice(0, 10), amount_due: bill.amount + (bill.vat_amount || 0), status: 'due', paid_date: null, payment_method: null, bank_name: null, receipt_attachment: null });
      }
      return { data: mapBillPayment(payment) };
    }
    if (payment && action === 'receipt' && m === 'POST') {
      payment.receipt_attachment = `receipts/bill-payment-${id}.pdf`;
      return { data: { receiptAttachment: payment.receipt_attachment } };
    }
    return { data: payment ? mapBillPayment(payment) : null };
  }

  if (normPath === '/bills') {
    if (m === 'POST') {
      const category = db.expenseCategories.find((c) => c.id === Number(body.categoryId));
      const newBill = {
        id: Date.now(),
        bill_number: body.name,
        vendor_name: body.vendorName || body.name,
        category_id: category?.id || null,
        amount: body.isVariableAmount ? 0 : Number(body.amount) || 0,
        vat_amount: 0,
        is_variable_amount: !!body.isVariableAmount,
        due_date: body.firstDueDate || body.startDate,
        lifecycle_status: 'active',
        recurring: body.frequency || 'monthly',
        payment_method: body.paymentMethod || 'bank',
        bank_account_id: body.bankAccountId ? Number(body.bankAccountId) : null,
        notes: body.notes || null,
      };
      db.bills.unshift(newBill);
      db.billPayments.push({ id: Date.now() + 1, bill_id: newBill.id, due_date: newBill.due_date, amount_due: newBill.amount, status: 'due', paid_date: null, payment_method: null, bank_name: null, receipt_attachment: null });
      return { data: mapBill(newBill) };
    }
    let list = [...db.bills];
    if (params.status) list = list.filter((b) => (b.lifecycle_status || 'active') === params.status);
    return { data: list.map(mapBill), meta: { total: list.length } };
  }

  if (normPath.startsWith('/bills/')) {
    const parts = normPath.split('/');
    const id = Number(parts[2]);
    const action = parts[3];
    const idx = db.bills.findIndex((b) => b.id === id);
    const bill = idx !== -1 ? db.bills[idx] : db.bills[0];

    if (action === 'pause' && m === 'POST') {
      bill.lifecycle_status = 'paused';
      return { data: mapBill(bill) };
    }
    if (action === 'resume' && m === 'POST') {
      bill.lifecycle_status = 'active';
      return { data: mapBill(bill) };
    }
    if (m === 'PUT') {
      if (body.name !== undefined) bill.bill_number = body.name;
      if (body.vendorName !== undefined) bill.vendor_name = body.vendorName;
      if (body.categoryId !== undefined) bill.category_id = Number(body.categoryId) || null;
      if (body.amount !== undefined) bill.amount = Number(body.amount) || 0;
      if (body.isVariableAmount !== undefined) bill.is_variable_amount = !!body.isVariableAmount;
      if (body.frequency !== undefined) bill.recurring = body.frequency;
      if (body.nextDueDate !== undefined) bill.due_date = body.nextDueDate;
      if (body.paymentMethod !== undefined) bill.payment_method = body.paymentMethod;
      if (body.bankAccountId !== undefined) bill.bank_account_id = body.bankAccountId ? Number(body.bankAccountId) : null;
      if (body.notes !== undefined) bill.notes = body.notes;
      return { data: mapBill(bill) };
    }
    if (m === 'DELETE') {
      if (idx !== -1) db.bills[idx].lifecycle_status = 'cancelled';
      return { data: { success: true } };
    }
    return { data: mapBill(bill) };
  }

  if (normPath === '/expenses/summary') {
    const year = Number(params.year) || new Date().getFullYear();
    const month = Number(params.month) || new Date().getMonth() + 1;
    const monthExpenses = db.expenses.filter((e) => e.date.slice(0, 4) === String(year) && Number(e.date.slice(5, 7)) === month);
    const yearExpenses = db.expenses.filter((e) => e.date.slice(0, 4) === String(year));
    const byCategory = db.expenseCategories
      .map((c) => {
        const rows = monthExpenses.filter((e) => e.category_id === c.id);
        return { categoryId: c.id, categoryName: c.name, categoryIcon: c.icon, count: rows.length, total: rows.reduce((acc, e) => acc + (e.amount || 0), 0) };
      })
      .sort((a, b) => b.total - a.total);
    return {
      data: {
        monthTotal: monthExpenses.reduce((acc, e) => acc + (e.amount || 0), 0),
        yearTotal: yearExpenses.reduce((acc, e) => acc + (e.amount || 0), 0),
        byCategory,
      },
    };
  }

  if (normPath === '/expenses') {
    if (m === 'POST') {
      const category = db.expenseCategories.find((c) => c.id === Number(body.categoryId));
      const amount = Number(body.amount) || 0;
      const newExp = {
        id: Date.now(),
        date: body.expenseDate || new Date().toISOString().slice(0, 10),
        description: body.description || 'Expense',
        category_id: category?.id || null,
        amount,
        vat: 0,
        payment_method: body.paymentMethod || 'cash',
        bank_name: body.bankAccountId ? db.treasury.bankAccounts.find((a) => a.id === Number(body.bankAccountId))?.bank_name : null,
        user: db.currentUser?.full_name || 'Admin',
        notes: body.notes || null,
        created_at: new Date().toISOString(),
        receipt_attachment: body.receipt ? `receipts/expense-${Date.now()}.jpg` : null,
      };
      db.expenses.unshift(newExp);
      if (newExp.payment_method === 'cash') {
        logCashTransaction({ type: 'expense', direction: 'out', amount, referenceType: 'expense', notes: newExp.description });
      } else {
        const bank = db.treasury.bankAccounts.find((a) => a.id === Number(body.bankAccountId));
        if (bank) logBankTransaction(bank, { type: 'expense', direction: 'out', amount, description: newExp.description, notes: null });
      }
      return { data: mapExpense(newExp) };
    }
    let list = [...db.expenses];
    if (params.categoryId) list = list.filter((e) => e.category_id === Number(params.categoryId));
    if (params.paymentMethod) list = list.filter((e) => e.payment_method === params.paymentMethod);
    if (params.search) {
      const q = params.search.toLowerCase();
      list = list.filter((e) => (e.description || '').toLowerCase().includes(q));
    }
    if (params.from) list = list.filter((e) => e.date >= params.from);
    if (params.to) list = list.filter((e) => e.date <= params.to);
    list.sort((a, b) => new Date(b.date) - new Date(a.date));
    const limit = Number(params.limit) || 100;
    const pageRows = list.slice(0, limit).map(mapExpense);
    return { data: pageRows, meta: { total: list.length, totalAmount: list.reduce((acc, e) => acc + (e.amount || 0), 0) } };
  }

  if (normPath.startsWith('/expenses/')) {
    const id = Number(normPath.split('/')[2]);
    if (m === 'DELETE') {
      const idx = db.expenses.findIndex((e) => e.id === id);
      if (idx !== -1) db.expenses.splice(idx, 1);
      return { data: { success: true } };
    }
    const e = db.expenses.find((x) => x.id === id);
    return { data: e ? mapExpense(e) : null };
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

  if (normPath === '/finance/accounts') {
    if (m === 'POST') {
      const newAcc = {
        id: Date.now(),
        code: body.code,
        name: body.name,
        type: body.type || 'expense',
        parent_id: body.parentId || null,
        is_system: false,
        description: body.description || null,
      };
      db.financeAccounts.push(newAcc);
      return { data: mapAccount(newAcc) };
    }
    return { data: db.financeAccounts.map(mapAccount) };
  }

  if (normPath.startsWith('/finance/accounts/')) {
    const id = Number(normPath.split('/')[3]);
    const idx = db.financeAccounts.findIndex((a) => a.id === id);
    if (m === 'PUT' && idx !== -1) {
      const a = db.financeAccounts[idx];
      if (body.code !== undefined) a.code = body.code;
      if (body.name !== undefined) a.name = body.name;
      if (body.type !== undefined) a.type = body.type;
      if (body.description !== undefined) a.description = body.description;
      return { data: mapAccount(a) };
    }
    if (m === 'DELETE') {
      if (idx !== -1 && !db.financeAccounts[idx].is_system) db.financeAccounts.splice(idx, 1);
      return { data: { success: true } };
    }
    return { data: idx !== -1 ? mapAccount(db.financeAccounts[idx]) : null };
  }

  if (normPath === '/finance/periods') {
    return { data: db.financePeriods.map(mapPeriod) };
  }

  if (normPath.endsWith('/checklist') && normPath.startsWith('/finance/periods/')) {
    const id = Number(normPath.split('/')[3]);
    const period = db.financePeriods.find((p) => p.id === id);
    const unbalanced = db.journalEntries.filter((e) => e.period_id === id && !journalEntryTotals(e).balanced);
    const checklist = [
      { key: 'journal_balanced', label: 'All journal entries are balanced', ok: unbalanced.length === 0, pending: unbalanced.length },
      { key: 'invoices_confirmed', label: 'No draft invoices in this period', ok: true, pending: 0 },
      { key: 'pos_reconciled', label: 'Cash drawer sessions reconciled', ok: true, pending: 0 },
    ];
    return { data: { period: period ? mapPeriod(period) : null, checklist } };
  }

  if (normPath.endsWith('/close') && normPath.startsWith('/finance/periods/')) {
    const id = Number(normPath.split('/')[3]);
    const period = db.financePeriods.find((p) => p.id === id);
    if (period) {
      period.status = 'closed';
      period.closed_by_username = db.currentUser?.full_name || 'Admin';
      period.closed_at = new Date().toISOString();
    }
    return { data: period ? mapPeriod(period) : null };
  }

  if (normPath === '/finance/journal') {
    if (m === 'POST') {
      const lines = (body.lines || []).map((l) => {
        const account = db.financeAccounts.find((a) => String(a.id) === String(l.accountId));
        return { account_code: account?.code || String(l.accountId), debit: Number(l.debit) || 0, credit: Number(l.credit) || 0, notes: null };
      });
      const openPeriod = db.financePeriods.find((p) => p.status === 'open' && p.type === 'monthly') || db.financePeriods[0];
      const newEntry = {
        id: Date.now(),
        entry_number: `JE-2025-${String(db.journalEntries.length + 93).padStart(4, '0')}`,
        date: body.date || new Date().toISOString().slice(0, 10),
        period_id: openPeriod?.id || null,
        reference_type: 'manual',
        is_manual: true,
        description: body.description || 'Manual journal entry',
        created_by_username: db.currentUser?.full_name || 'Admin',
        lines,
      };
      db.journalEntries.unshift(newEntry);
      return { data: mapJournalDetail(newEntry) };
    }

    let list = [...db.journalEntries];
    if (params.from) list = list.filter((e) => e.date >= params.from);
    if (params.to) list = list.filter((e) => e.date <= params.to);
    if (params.referenceType) list = list.filter((e) => e.reference_type === params.referenceType);
    if (params.isManual) list = list.filter((e) => String(!!e.is_manual) === params.isManual);
    list.sort((a, b) => new Date(b.date) - new Date(a.date));
    const page = Number(params.page) || 1;
    const limit = Number(params.limit) || 25;
    const total = list.length;
    const pageRows = list.slice((page - 1) * limit, (page - 1) * limit + limit).map(mapJournalListRow);
    return { data: pageRows, meta: { page, limit, total } };
  }

  if (normPath.startsWith('/finance/journal/')) {
    const id = Number(normPath.split('/')[3]);
    const entry = db.journalEntries.find((e) => e.id === id);
    return { data: entry ? mapJournalDetail(entry) : null };
  }

  if (normPath === '/expense-categories') {
    if (m === 'POST') {
      const newCat = { id: Date.now(), name: body.name, icon: body.icon || null, type: body.type || 'recurring', is_active: body.isActive !== false };
      db.expenseCategories.push(newCat);
      return { data: mapExpenseCategory(newCat) };
    }
    return { data: db.expenseCategories.map(mapExpenseCategory), meta: { total: db.expenseCategories.length } };
  }

  if (normPath.startsWith('/expense-categories/')) {
    const id = Number(normPath.split('/')[2]);
    const idx = db.expenseCategories.findIndex((c) => c.id === id);
    if (m === 'PUT' && idx !== -1) {
      const c = db.expenseCategories[idx];
      if (body.name !== undefined) c.name = body.name;
      if (body.icon !== undefined) c.icon = body.icon;
      if (body.type !== undefined) c.type = body.type;
      if (body.isActive !== undefined) c.is_active = body.isActive;
      return { data: mapExpenseCategory(c) };
    }
    if (m === 'DELETE' && idx !== -1) {
      db.expenseCategories.splice(idx, 1);
      return { data: { success: true } };
    }
    const found = db.expenseCategories.find((c) => c.id === id);
    return { data: found ? mapExpenseCategory(found) : null };
  }

  // 15. Reports
  if (normPath.startsWith('/reports/')) {
    const rows = db.invoices.map((inv, i) => ({
      id: inv.id ?? i,
      reference: inv.invoice_number,
      date: inv.date.slice(0, 10),
      customer: inv.customer_name,
      amount: inv.grand_total,
      vat: inv.vat_total,
      status: inv.status,
    }));
    const columns = [
      { key: 'reference', label: 'Reference', type: 'text' },
      { key: 'date', label: 'Date', type: 'date' },
      { key: 'customer', label: 'Customer', type: 'text' },
      { key: 'amount', label: 'Amount', type: 'currency' },
      { key: 'vat', label: 'VAT', type: 'currency' },
      { key: 'status', label: 'Status', type: 'text' },
    ];
    return {
      data: {
        summary: { total_sales: 184500, total_profit: 52300, orders_count: 142, average_order: 1299 },
        columns,
        rows,
        totals: { amount: rows.reduce((acc, r) => acc + (r.amount || 0), 0), vat: rows.reduce((acc, r) => acc + (r.vat || 0), 0) },
        meta: { rowCount: rows.length },
        period: { label: null },
      },
    };
  }

  // 16. Approvals & Notifications
  if (normPath === '/approvals') {
    return { data: db.approvals, meta: { total: db.approvals.length } };
  }
  if (normPath === '/notifications/approvals/queue') {
    const limit = Number(params.limit) || 10;
    const returns = db.returnRequests
      .filter((r) => r.status === 'pending')
      .slice(0, limit)
      .map((r) => ({ id: r.id, request_number: r.requestNumber, no_invoice_return: r.noInvoiceReturn, customer_name: r.customerName, total_value: r.totalValue, requested_at: r.requestedAt }));
    const invoiceEdits = db.invoiceEditRequests
      .filter((r) => r.status === 'pending')
      .slice(0, limit)
      .map((r) => ({ id: r.id, invoice_id: r.invoiceId, invoice_number: r.invoiceNumber, requested_by_name: r.requestedByUsername, requested_at: r.requestedAt }));
    const stockAdjustments = db.stockAdjustments
      .filter((a) => a.status === 'pending')
      .slice(0, limit)
      .map((a) => ({ id: a.id, product_name: a.product_name, difference: a.requested_qty - a.current_qty, reason: a.reason, requested_by_name: a.requested_by_username, requested_at: a.requested_at }));
    const stockCounts = db.stockCounts
      .filter((c) => c.status === 'pending_approval')
      .slice(0, limit)
      .map((c) => {
        const counted = c.items.filter((it) => it.counted_quantity != null);
        const discrepancies = counted.filter((it) => it.counted_quantity !== it.system_quantity);
        return { id: c.id, count_type: c.count_type, discrepancy_count: discrepancies.length, submitted_by_name: c.initiated_by_username, submitted_at: c.initiated_at };
      });
    const attendanceCorrections = db.attendance.corrections
      .filter((c) => c.status === 'pending')
      .slice(0, limit)
      .map((c) => ({ id: c.id, employee_name: c.employee_name, attendance_date: c.attendance_date, reason: c.reason }));
    const leaves = db.attendance.leaves
      .filter((l) => l.status === 'pending')
      .slice(0, limit)
      .map((l) => ({ id: l.id, employee_name: l.employee_name, leave_type: l.leave_type, start_date: l.start_date, end_date: l.end_date, total_days: l.total_days, created_at: l.created_at || l.start_date }));
    return {
      data: {
        returns,
        invoice_edits: invoiceEdits,
        stock_adjustments: stockAdjustments,
        stock_counts: stockCounts,
        attendance_corrections: attendanceCorrections,
        leaves,
      },
    };
  }
  if (normPath === '/notifications/approvals/counts') {
    const total =
      db.returnRequests.filter((r) => r.status === 'pending').length +
      db.invoiceEditRequests.filter((r) => r.status === 'pending').length +
      db.stockAdjustments.filter((a) => a.status === 'pending').length +
      db.stockCounts.filter((c) => c.status === 'pending_approval').length +
      db.attendance.corrections.filter((c) => c.status === 'pending').length +
      db.attendance.leaves.filter((l) => l.status === 'pending').length;
    return { data: { total } };
  }
  if (normPath === '/notifications/preferences') {
    if (m === 'PUT') {
      db.notificationPreferences = { ...db.notificationPreferences, ...body };
      return { data: db.notificationPreferences };
    }
    return { data: db.notificationPreferences };
  }

  if (normPath === '/notifications/broadcast') {
    const newNotif = {
      id: Date.now(),
      title: body.title || 'Announcement',
      message: body.message || '',
      category: 'system',
      severity: body.severity || 'info',
      read: false,
      created_at: new Date().toISOString(),
    };
    db.notifications.unshift(newNotif);
    return { data: { success: true, recipients: db.users.filter((u) => u.is_active).length } };
  }

  if (normPath === '/notifications') {
    let list = [...db.notifications].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    if (params.category) list = list.filter((n) => n.category === params.category);
    if (params.severity) list = list.filter((n) => n.severity === params.severity);
    if (params.unread_only === '1' || params.unread_only === 'true' || params.unread_only === true) {
      list = list.filter((n) => !n.read);
    }
    const unreadCount = db.notifications.filter((n) => !n.read).length;
    const page = Number(params.page) || 1;
    const limit = Number(params.limit) || 30;
    const start = (page - 1) * limit;
    const pageRows = list.slice(start, start + limit).map((n) => ({
      id: n.id,
      title: n.title,
      message: n.message,
      category: n.category,
      severity: n.severity || n.type || 'info',
      is_read: !!n.read,
      action_url: n.action_url || null,
      created_at: n.created_at,
    }));
    return { data: pageRows, meta: { total: list.length, unread_count: unreadCount, page, limit } };
  }
  if (normPath === '/notifications/unread-count') {
    return { data: { unread_count: db.notifications.filter((n) => !n.read).length } };
  }
  if (normPath === '/notifications/read-all') {
    db.notifications.forEach((n) => { n.read = true; });
    return { data: { success: true } };
  }
  if (normPath.startsWith('/notifications/') && normPath.endsWith('/read')) {
    const id = Number(normPath.split('/')[2]);
    const n = db.notifications.find((x) => x.id === id);
    if (n) n.read = true;
    return { data: { success: true } };
  }
  if (normPath.startsWith('/notifications/') && normPath.endsWith('/dismiss')) {
    const id = Number(normPath.split('/')[2]);
    db.notifications = db.notifications.filter((x) => x.id !== id);
    return { data: { success: true } };
  }

  // 17. Users, Employees & Roles
  if (normPath === '/roles/permissions/all') {
    return { data: permissionCatalog() };
  }

  if (normPath === '/users') {
    if (m === 'POST') {
      const role = db.roles.find((r) => r.id === Number(body.roleId));
      const newUser = {
        id: Date.now(),
        username: body.username,
        full_name: body.username,
        email: body.email || null,
        phone: body.phone || null,
        role: role?.name || null,
        role_id: role?.id || null,
        employee_id: body.employeeId ? Number(body.employeeId) : null,
        is_active: true,
        is_online: false,
        last_active_at: null,
        created_at: new Date().toISOString(),
        permission_overrides: null,
      };
      db.users.push(newUser);
      return { data: mapUser(newUser) };
    }
    let list = [...db.users];
    if (params.search) {
      const q = params.search.toLowerCase();
      list = list.filter((u) => u.username.toLowerCase().includes(q) || (u.full_name || '').toLowerCase().includes(q));
    }
    if (params.isActive) {
      const want = params.isActive === 'true';
      list = list.filter((u) => !!u.is_active === want);
    }
    const page = Number(params.page) || 1;
    const limit = Number(params.limit) || 20;
    const total = list.length;
    const pageRows = list.slice((page - 1) * limit, (page - 1) * limit + limit).map(mapUser);
    return { data: pageRows, meta: { page, limit, total } };
  }

  if (normPath.endsWith('/permissions') && normPath.startsWith('/users/')) {
    const id = Number(normPath.split('/')[2]);
    const idx = db.users.findIndex((u) => u.id === id);
    const user = idx !== -1 ? db.users[idx] : db.users[0];
    const role = db.roles.find((r) => r.id === user.role_id);
    const rolePermissionKeys = role?.permissions?.includes('*') ? PERMISSION_CATALOG_KEYS : role?.permissions || [];
    if (m === 'PUT') {
      db.users[idx].permission_overrides = body.effectiveKeys || [];
      return { data: { success: true } };
    }
    const effectiveKeys = user.permission_overrides || rolePermissionKeys;
    return {
      data: {
        username: user.username,
        roleName: role?.name || null,
        rolePermissionKeys,
        effectiveKeys,
        allPermissions: permissionCatalog(),
      },
    };
  }

  if (normPath.endsWith('/force-logout') && normPath.startsWith('/users/')) {
    const id = Number(normPath.split('/')[2]);
    const user = db.users.find((u) => u.id === id);
    if (user) user.is_online = false;
    return { data: { sessionsClosed: 1 } };
  }

  if (normPath.startsWith('/users/')) {
    const id = Number(normPath.split('/')[2]);
    const idx = db.users.findIndex((user) => user.id === id);
    const u = idx !== -1 ? db.users[idx] : db.users[0];
    if (m === 'PUT') {
      if (idx !== -1) {
        if (body.username !== undefined) db.users[idx].username = body.username;
        if (body.email !== undefined) db.users[idx].email = body.email;
        if (body.phone !== undefined) db.users[idx].phone = body.phone;
        if (body.roleId !== undefined) {
          const role = db.roles.find((r) => r.id === Number(body.roleId));
          db.users[idx].role_id = role?.id || null;
          db.users[idx].role = role?.name || null;
        }
        if (body.employeeId !== undefined) db.users[idx].employee_id = body.employeeId ? Number(body.employeeId) : null;
        if (body.isActive !== undefined) db.users[idx].is_active = body.isActive;
      }
      return { data: mapUser(db.users[idx] || u) };
    }
    if (m === 'DELETE') {
      if (idx !== -1) db.users[idx].is_active = false;
      return { data: { success: true } };
    }
    return { data: mapUser(u) };
  }

  if (normPath === '/employees') {
    if (m === 'POST') {
      const newEmp = {
        id: Date.now(),
        name: body.name,
        job_title: body.roleTitle || null,
        department: body.department || null,
        phone: body.phone || null,
        email: body.email || null,
        salary: body.salary != null ? Number(body.salary) : null,
        join_date: new Date().toISOString().slice(0, 10),
        shift_start: body.shiftStart || '09:00',
        shift_end: body.shiftEnd || '18:00',
        status: 'active',
        annual_leave_days: 30,
        sick_leave_days: 15,
      };
      db.employees.push(newEmp);
      return { data: mapEmployee(newEmp) };
    }
    let list = [...db.employees];
    if (params.search) {
      const q = params.search.toLowerCase();
      list = list.filter((e) => e.name.toLowerCase().includes(q));
    }
    if (params.isActive) {
      const want = params.isActive === 'true';
      list = list.filter((e) => (e.status !== 'inactive') === want);
    }
    const page = Number(params.page) || 1;
    const limit = Number(params.limit) || 50;
    const total = list.length;
    const pageRows = list.slice((page - 1) * limit, (page - 1) * limit + limit).map(mapEmployee);
    return { data: pageRows, meta: { page, limit, total } };
  }
  if (normPath.startsWith('/employees/')) {
    const id = Number(normPath.split('/')[2]);
    const idx = db.employees.findIndex((e) => e.id === id);
    const e = idx !== -1 ? db.employees[idx] : db.employees[0];
    if (m === 'PUT') {
      if (idx !== -1) {
        const emp = db.employees[idx];
        if (body.name !== undefined) emp.name = body.name;
        if (body.roleTitle !== undefined) emp.job_title = body.roleTitle;
        if (body.department !== undefined) emp.department = body.department;
        if (body.phone !== undefined) emp.phone = body.phone;
        if (body.email !== undefined) emp.email = body.email;
        if (body.salary !== undefined) emp.salary = Number(body.salary) || null;
        if (body.shiftStart !== undefined) emp.shift_start = body.shiftStart;
        if (body.shiftEnd !== undefined) emp.shift_end = body.shiftEnd;
        if (body.isActive !== undefined) emp.status = body.isActive ? 'active' : 'inactive';
      }
      return { data: mapEmployee(db.employees[idx] || e) };
    }
    if (m === 'DELETE') {
      if (idx !== -1) db.employees[idx].status = 'inactive';
      return { data: { success: true } };
    }
    return { data: mapEmployee(e) };
  }

  if (normPath === '/roles') {
    if (m === 'POST') {
      const newRole = { id: Date.now(), user_count: 0, is_system: false, permissions: body.permissionKeys || [], name: body.name, description: body.description || null };
      db.roles.push(newRole);
      return { data: mapRole(newRole) };
    }
    return { data: db.roles.map(mapRole), meta: { total: db.roles.length } };
  }

  if (normPath.endsWith('/permissions') && normPath.startsWith('/roles/')) {
    const id = Number(normPath.split('/')[2]);
    const role = db.roles.find((r) => r.id === id);
    if (role && m === 'PUT') {
      role.permissions = body.permissionKeys || [];
      return { data: mapRole(role) };
    }
    return { data: role ? mapRole(role) : null };
  }

  if (normPath.startsWith('/roles/')) {
    const id = Number(normPath.split('/')[2]);
    const idx = db.roles.findIndex((role) => role.id === id);
    const r = idx !== -1 ? db.roles[idx] : db.roles[0];
    if (m === 'PUT') {
      if (idx !== -1) {
        if (body.name !== undefined) db.roles[idx].name = body.name;
        if (body.description !== undefined) db.roles[idx].description = body.description;
        if (body.permissionKeys !== undefined) db.roles[idx].permissions = body.permissionKeys;
      }
      return { data: mapRole(db.roles[idx] || r) };
    }
    if (m === 'DELETE') {
      if (idx !== -1 && !db.roles[idx].is_system) db.roles.splice(idx, 1);
      return { data: { success: true } };
    }
    return { data: mapRole(r) };
  }

  // 18. Admin & Diagnostics
  if (normPath === '/admin/bug-reports' || normPath === '/bug-reports') {
    if (m === 'POST') {
      const newBug = {
        id: Date.now(),
        ticket_number: `BUG-2025-${String(db.bugReports.length + 1).padStart(4, '0')}`,
        what_were_you_doing: body.title || 'Reported Issue',
        what_happened: body.description || '',
        urgency: body.urgency || 'minor',
        status: 'open',
        created_at: new Date().toISOString(),
        reported_by_username: db.currentUser?.full_name || 'Demo User',
        pc_identifier: 'POS-01',
        screenshot_path: null,
        breadcrumbs: [],
        comments: [],
      };
      db.bugReports.unshift(newBug);
      return { data: newBug };
    }
    let list = [...db.bugReports].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    if (params.status) list = list.filter((r) => r.status === params.status);
    const limit = Number(params.limit) || 50;
    // Anchor "now" to the most recent seeded report rather than the real
    // wall clock, so "this month" stays meaningful regardless of when this
    // demo is actually being run.
    const now = db.bugReports.reduce((max, r) => {
      const d = new Date(r.created_at);
      return d > max ? d : max;
    }, new Date(0));
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const summary = {
      open_count: db.bugReports.filter((r) => r.status === 'open').length,
      in_progress_count: db.bugReports.filter((r) => r.status === 'in_progress').length,
      resolved_month: db.bugReports.filter((r) => r.status === 'resolved' && new Date(r.created_at) >= monthStart).length,
      blocking_open: db.bugReports.filter((r) => r.status === 'open' && r.urgency === 'blocking').length,
    };
    return { data: list.slice(0, limit), meta: { total: list.length, summary } };
  }

  if (normPath.startsWith('/admin/bug-reports/') || normPath.startsWith('/bug-reports/')) {
    const parts = normPath.split('/');
    const id = Number(parts[parts.length - (parts[parts.length - 1] === 'comments' ? 2 : 1)]);
    const bug = db.bugReports.find((r) => r.id === id);
    if (normPath.endsWith('/comments') && m === 'POST') {
      if (bug) {
        bug.comments = bug.comments || [];
        bug.comments.push({
          id: Date.now(),
          author_username: db.currentUser?.full_name || 'admin',
          created_at: new Date().toISOString(),
          comment: body.comment || '',
        });
      }
      return { data: bug || null };
    }
    if (m === 'PUT') {
      if (bug && body.status) bug.status = body.status;
      return { data: bug || null };
    }
    return { data: bug || null };
  }

  if (normPath === '/admin/error-logs' || normPath === '/error-logs') {
    let list = [...db.errorLogs].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    if (params.severity) list = list.filter((r) => r.severity === params.severity);
    if (params.resolved === 'true') list = list.filter((r) => r.resolved);
    else if (params.resolved === 'false') list = list.filter((r) => !r.resolved);
    const limit = Number(params.limit) || 80;
    // Anchor "now" to the most recent seeded log entry rather than the real
    // wall clock, so the 7-day/1-hour windows stay meaningful regardless of
    // when this demo is actually being run.
    const now = db.errorLogs.reduce((max, r) => {
      const d = new Date(r.created_at);
      return d > max ? d : max;
    }, new Date(0));
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const inLast7d = (r) => new Date(r.created_at) >= sevenDaysAgo;
    const summary = {
      critical_7d: db.errorLogs.filter((r) => r.severity === 'critical' && inLast7d(r)).length,
      error_7d: db.errorLogs.filter((r) => r.severity === 'error' && inLast7d(r)).length,
      warning_7d: db.errorLogs.filter((r) => r.severity === 'warning' && inLast7d(r)).length,
      unresolved: db.errorLogs.filter((r) => !r.resolved).length,
      last_hour: db.errorLogs.filter((r) => new Date(r.created_at) >= oneHourAgo).length,
    };
    // Auto-escalation: same error code occurring 3+ times within the last hour.
    const recentByCode = {};
    db.errorLogs
      .filter((r) => new Date(r.created_at) >= oneHourAgo)
      .forEach((r) => {
        recentByCode[r.code] = recentByCode[r.code] || { code: r.code, count: 0, pcs: [] };
        recentByCode[r.code].count += 1;
        if (!recentByCode[r.code].pcs.includes(r.pc_identifier)) recentByCode[r.code].pcs.push(r.pc_identifier);
      });
    const escalations = Object.values(recentByCode).filter((e) => e.count >= 3);
    return { data: list.slice(0, limit), meta: { total: list.length, summary, escalations } };
  }

  if (normPath.startsWith('/admin/error-logs/') || normPath.startsWith('/error-logs/')) {
    if (normPath.endsWith('/cleanup')) {
      const days = Number(params.days) || 90;
      const nowRef = db.errorLogs.reduce((max, r) => {
        const d = new Date(r.created_at);
        return d > max ? d : max;
      }, new Date(0));
      const cutoff = new Date(nowRef.getTime() - days * 24 * 60 * 60 * 1000);
      const before = db.errorLogs.length;
      db.errorLogs = db.errorLogs.filter((r) => !(r.resolved && new Date(r.created_at) < cutoff));
      return { data: { deleted: before - db.errorLogs.length } };
    }
    const parts = normPath.split('/');
    const id = Number(parts[2] === 'error-logs' ? parts[3] : parts[2]);
    const log = db.errorLogs.find((r) => r.id === id);
    if (normPath.endsWith('/resolve') && m === 'PUT') {
      if (log) {
        log.resolved = true;
        log.resolution_note = body.resolution_note || '';
      }
      return { data: log || null };
    }
    return { data: log || null };
  }

  if (normPath === '/backup/maintenance' || normPath === '/backup/status') {
    return { data: { in_progress: false, last_backup: '2025-08-30T22:00:00Z', total_backups: 14 } };
  }

  // Generic fallback
  return { data: { success: true, message: 'Mock response' } };
}
