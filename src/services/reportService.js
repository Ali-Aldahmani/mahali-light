import { apiGet, apiPost, apiPut, apiDelete } from './http.js';
import { API_BASE } from '../config.js';
import { useAuthStore } from '../store/authStore.js';

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

// Download an export — we bypass apiGet/apiPost because the response is a
// binary blob, and we need the browser to trigger a Save As dialog.
export async function downloadExport(type, format, params = {}) {
  const token = useAuthStore.getState().token;
  const url = `${API_BASE}/reports/${type}/export${qs({ ...params, format })}`;
  const res = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    const body = await res.text();
    let message = body;
    try {
      message = JSON.parse(body)?.error?.message || body;
    } catch (_e) {
      // body wasn't JSON — fall through.
    }
    throw new Error(message || `Export failed (${res.status})`);
  }
  const cd = res.headers.get('Content-Disposition') || '';
  const match = /filename="?([^"]+)"?/i.exec(cd);
  const filename = match?.[1] || `${type}.${format === 'excel' ? 'xlsx' : format}`;
  const blob = await res.blob();
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
