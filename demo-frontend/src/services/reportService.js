import { apiGet, apiPost, apiPut, apiDelete } from './http.js';

function qs(params) {
  const usp = new URLSearchParams();
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') usp.set(k, v);
  });
  const s = usp.toString();
  return s ? `?${s}` : '';
}

// =======================================================================
// Catalog of report types organised by category. This is the
// source-of-truth used by both the reports hub and the generic report page
// to know titles + required permissions + filter shape.
// =======================================================================
export const REPORT_CATEGORIES = [
  {
    id: 'financial',
    title: 'Financial',
    icon: 'TrendingUp',
    permission: 'report.financial',
    reports: [
      { type: 'net_profit', label: 'Net Profit', special: '/reports/net-profit' },
      { type: 'profit_loss', label: 'Profit & Loss' },
      { type: 'balance_sheet', label: 'Balance Sheet' },
      { type: 'cash_flow', label: 'Cash Flow' },
      { type: 'vat', label: 'VAT Report' },
    ],
  },
  {
    id: 'sales',
    title: 'Sales',
    icon: 'BarChart3',
    permission: 'report.sales',
    reports: [
      { type: 'sales_summary', label: 'Sales Summary' },
      { type: 'sales_by_period', label: 'Sales Over Time' },
      { type: 'sales_by_product', label: 'Sales by Product' },
      { type: 'sales_by_category', label: 'Sales by Category' },
      { type: 'sales_by_employee', label: 'Sales by Employee' },
      { type: 'sales_by_payment_method', label: 'Payment Method Split' },
      { type: 'sales_invoices', label: 'Invoice List' },
    ],
  },
  {
    id: 'inventory',
    title: 'Inventory',
    icon: 'Package',
    permission: 'report.inventory',
    reports: [
      { type: 'inventory_stock_levels', label: 'Stock Levels' },
      { type: 'inventory_valuation', label: 'Valuation' },
      { type: 'inventory_movements', label: 'Movements' },
      { type: 'low_stock', label: 'Low Stock' },
      { type: 'dead_stock', label: 'Dead Stock' },
      { type: 'inventory_stock_counts', label: 'Stock Counts' },
    ],
  },
  {
    id: 'suppliers',
    title: 'Suppliers',
    icon: 'Truck',
    permission: 'report.suppliers',
    reports: [
      { type: 'supplier_summary', label: 'Supplier Summary' },
      { type: 'supplier_payables', label: 'Payables (Aging)' },
      { type: 'supplier_purchases', label: 'Purchase History' },
      { type: 'supplier_payments', label: 'Payments' },
      { type: 'supplier_returns', label: 'Returns' },
    ],
  },
  {
    id: 'customers',
    title: 'Customers',
    icon: 'Users',
    permission: 'report.customers',
    reports: [
      { type: 'customer_summary', label: 'Customer Summary' },
      { type: 'customer_receivables', label: 'Receivables (Aging)' },
      { type: 'customer_payments', label: 'Payments' },
      { type: 'customer_top', label: 'Top Customers' },
      { type: 'customer_inactive', label: 'Inactive Customers' },
    ],
  },
  {
    id: 'employees',
    title: 'Employees',
    icon: 'UserCog',
    permission: 'report.employees',
    reports: [
      { type: 'employee_performance', label: 'Performance' },
      { type: 'employee_activity', label: 'Activity Log' },
      { type: 'payroll', label: 'Payroll' },
    ],
  },
  {
    id: 'attendance',
    title: 'Attendance',
    icon: 'CalendarCheck',
    permission: 'report.attendance',
    reports: [
      { type: 'attendance_monthly_sheet', label: 'Monthly Sheet' },
      { type: 'attendance_summary', label: 'Summary' },
      { type: 'attendance_late', label: 'Late Arrivals' },
      { type: 'attendance_leave', label: 'Leave Balances' },
      { type: 'attendance_overtime', label: 'Overtime' },
    ],
  },
  {
    id: 'warranty',
    title: 'Warranty',
    icon: 'Shield',
    permission: 'report.warranty',
    reports: [
      { type: 'warranty_active', label: 'Active Warranties' },
      { type: 'warranty_claims', label: 'Claims' },
      { type: 'warranty_by_product', label: 'Claim Rate by Product' },
    ],
  },
  {
    id: 'returns',
    title: 'Returns',
    icon: 'Undo2',
    permission: 'report.returns',
    reports: [
      { type: 'returns_summary', label: 'Returns Summary' },
      { type: 'returns_requests', label: 'Requests' },
      { type: 'returns_by_product', label: 'By Product' },
    ],
  },
  {
    id: 'bills',
    title: 'Bills',
    icon: 'Receipt',
    permission: 'report.bills',
    reports: [
      { type: 'bills_summary', label: 'Bills Summary' },
      { type: 'bills_expenses', label: 'Expense Breakdown' },
      { type: 'bills_overdue', label: 'Overdue Bills' },
    ],
  },
];

export function findReport(type) {
  for (const cat of REPORT_CATEGORIES) {
    const def = cat.reports.find((r) => r.type === type);
    if (def) return { ...def, category: cat };
  }
  return null;
}

// =======================================================================
// API
// =======================================================================
export function runReport(type, params = {}) {
  return apiGet(`/reports/${type}${qs(params)}`);
}

// Demo build: there is no backend to render a real PDF/Excel export, so we
// simulate the download by generating a small CSV of the on-screen data
// client-side. This keeps the Export button interactive without a network
// call.
export async function downloadExport(type, format, params = {}) {
  await new Promise((resolve) => setTimeout(resolve, 400));
  const rows = await runReport(type, params);
  const list = Array.isArray(rows) ? rows : rows?.data || [];
  const ext = format === 'excel' ? 'xlsx' : format === 'pdf' ? 'pdf' : 'csv';
  const filename = `${type}-${new Date().toISOString().slice(0, 10)}.${ext}`;

  let text;
  if (list.length > 0 && typeof list[0] === 'object') {
    const headers = Object.keys(list[0]);
    text = [
      headers.join(','),
      ...list.map((row) => headers.map((h) => JSON.stringify(row[h] ?? '')).join(',')),
    ].join('\n');
  } else {
    text = `${type} report — demo export\nGenerated ${new Date().toLocaleString()}`;
  }

  const blob = new Blob([text], { type: 'text/csv;charset=utf-8;' });
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 5000);
  return { filename };
}

// =======================================================================
// Scheduled reports
// =======================================================================
export function listSchedules() {
  return apiGet('/reports/scheduled');
}
export function createSchedule(body) {
  return apiPost('/reports/scheduled', body);
}
export function updateSchedule(id, body) {
  return apiPut(`/reports/scheduled/${id}`, body);
}
export function deleteSchedule(id) {
  return apiDelete(`/reports/scheduled/${id}`);
}
export function runScheduleNow(id) {
  return apiPost(`/reports/scheduled/${id}/run`, {});
}
