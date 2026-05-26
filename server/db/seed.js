require('dotenv').config();
const bcrypt = require('bcrypt');
const { getPool, query, withTransaction } = require('./postgres');
const { ROLE_DEFAULTS } = require('../../shared/permissions');

const SYSTEM_ROLES = [
  { name: 'Admin', description: 'Full system access', is_system: true },
  { name: 'Manager', description: 'Store management access', is_system: true },
  { name: 'Cashier', description: 'POS and invoicing access', is_system: true },
  { name: 'Warehouse', description: 'Inventory management access', is_system: true },
];

const ALL_PERMISSIONS = [
  ['invoice.view', 'View Invoices', 'invoice'],
  ['invoice.create', 'Create Invoice', 'invoice'],
  ['invoice.edit_request', 'Request Invoice Edit', 'invoice'],
  ['invoice.edit_approve', 'Approve Invoice Edit', 'invoice'],
  ['invoice.edit_direct', 'Edit Invoice Directly', 'invoice'],
  ['invoice.cancel', 'Cancel Invoice', 'invoice'],
  ['invoice.refund', 'Refund Invoice', 'invoice'],
  ['invoice.print', 'Print Invoice', 'invoice'],
  ['invoice.download', 'Download Invoice PDF', 'invoice'],
  ['product.view', 'View Products', 'product'],
  ['product.create', 'Create Product', 'product'],
  ['product.edit', 'Edit Product', 'product'],
  ['product.delete', 'Delete Product', 'product'],
  ['product.adjust_stock', 'Adjust Stock', 'product'],
  ['product.view_cost', 'View Cost Price', 'product'],
  ['supplier.view', 'View Suppliers', 'supplier'],
  ['supplier.create', 'Create Supplier', 'supplier'],
  ['supplier.edit', 'Edit Supplier', 'supplier'],
  ['supplier.delete', 'Delete Supplier', 'supplier'],
  ['supplier.purchase_order.create', 'Create Purchase Order', 'supplier'],
  ['supplier.purchase_order.pay', 'Pay Purchase Order', 'supplier'],
  ['customer.view', 'View Customers', 'customer'],
  ['customer.create', 'Create Customer', 'customer'],
  ['customer.edit', 'Edit Customer', 'customer'],
  ['customer.delete', 'Delete Customer', 'customer'],
  ['customer.collect_payment', 'Collect Customer Payment', 'customer'],
  ['customer.view_balance', 'View Customer Balance', 'customer'],
  ['employee.view', 'View Employees', 'employee'],
  ['employee.create', 'Create Employee', 'employee'],
  ['employee.edit', 'Edit Employee', 'employee'],
  ['employee.delete', 'Delete Employee', 'employee'],
  ['user.create', 'Create User', 'user'],
  ['user.edit', 'Edit User', 'user'],
  ['user.change_role', 'Change User Role', 'user'],
  ['user.force_logout', 'Force Logout User', 'user'],
  ['stock.view', 'View Stock', 'stock'],
  ['stock.adjust_request', 'Request Stock Adjustment', 'stock'],
  ['stock.adjust_approve', 'Approve Stock Adjustment', 'stock'],
  ['stock.adjust_direct', 'Adjust Stock Directly', 'stock'],
  ['stock.count_initiate', 'Initiate Stock Count', 'stock'],
  ['stock.count_approve', 'Approve Stock Count', 'stock'],
  ['cash.view', 'View Cash Drawer', 'cash'],
  ['cash.adjust', 'Adjust Cash Drawer', 'cash'],
  ['bank.view', 'View Bank Accounts', 'bank'],
  ['bank.transact', 'Bank Transactions', 'bank'],
  ['return.request', 'Submit Return Request', 'return'],
  ['return.approve', 'Approve Return Request', 'return'],
  ['return.process', 'Process Return Directly', 'return'],
  ['attendance.view_own', 'View Own Attendance', 'attendance'],
  ['attendance.view_all', 'View All Attendance', 'attendance'],
  ['attendance.mark_manual', 'Mark Manual Attendance', 'attendance'],
  ['attendance.correction_request', 'Request Attendance Correction', 'attendance'],
  ['attendance.correction_approve', 'Approve Attendance Correction', 'attendance'],
  ['bills.view', 'View Bills', 'bills'],
  ['bills.pay', 'Pay Bills', 'bills'],
  ['bills.manage', 'Manage Bills', 'bills'],
  ['bills.notifications', 'Receive Bill Reminders', 'bills'],
  ['finance.view_dashboard', 'View Finance Dashboard', 'finance'],
  ['finance.view_pl', 'View P&L Report', 'finance'],
  ['finance.view_balance_sheet', 'View Balance Sheet', 'finance'],
  ['finance.view_cashflow', 'View Cash Flow', 'finance'],
  ['finance.view_vat', 'View VAT Report', 'finance'],
  ['finance.view_journal', 'View Journal Entries', 'finance'],
  ['finance.close_period', 'Close Financial Period', 'finance'],
  ['finance.export_reports', 'Export Financial Reports', 'finance'],
  ['report.sales', 'Sales Reports', 'report'],
  ['report.inventory', 'Inventory Reports', 'report'],
  ['report.suppliers', 'Supplier Reports', 'report'],
  ['report.customers', 'Customer Reports', 'report'],
  ['report.employees', 'Employee Reports', 'report'],
  ['report.attendance', 'Attendance Reports', 'report'],
  ['report.warranty', 'Warranty Reports', 'report'],
  ['report.returns', 'Returns Reports', 'report'],
  ['report.bills', 'Bills Reports', 'report'],
  ['report.analytics', 'Analytics Reports', 'report'],
  ['report.export_pdf', 'Export PDF', 'report'],
  ['report.export_csv', 'Export CSV', 'report'],
  ['report.export_excel', 'Export Excel', 'report'],
  ['analytics.view_peaks', 'View Peak Analytics', 'analytics'],
  ['analytics.view_reorder', 'View Reorder Forecast', 'analytics'],
  ['analytics.export_forecast', 'Export Forecast', 'analytics'],
  ['backup.view', 'View Backups', 'backup'],
  ['backup.run_manual', 'Run Manual Backup', 'backup'],
  ['backup.restore', 'Restore Backup', 'backup'],
  ['backup.configure', 'Configure Backup', 'backup'],
  ['settings.view', 'View Settings', 'settings'],
  ['settings.edit', 'Edit Settings', 'settings'],
  ['errors.view_all', 'View All Error Logs', 'errors'],
  ['errors.resolve', 'Resolve Error Logs', 'errors'],
  ['bug.view_all', 'View All Bug Reports', 'bug'],
  ['bug.manage', 'Manage Bug Reports', 'bug'],
  ['warranty.view', 'View Warranties', 'warranty'],
  ['warranty.create', 'Create Warranty', 'warranty'],
  ['warranty.claim', 'Process Warranty Claim', 'warranty'],
  ['report.employee_performance_own', 'View Own Performance', 'report'],
  ['report.employee_performance_all', 'View All Performance', 'report'],
];

async function ensurePermissions() {
  for (const [key, label, mod] of ALL_PERMISSIONS) {
    await query(
      `INSERT INTO permissions (key, label, module) VALUES ($1,$2,$3)
       ON CONFLICT (key) DO UPDATE SET label = EXCLUDED.label, module = EXCLUDED.module`,
      [key, label, mod],
    );
  }
}

async function ensureRoles() {
  for (const role of SYSTEM_ROLES) {
    await query(
      `INSERT INTO roles (name, description, is_system) VALUES ($1,$2,$3)
       ON CONFLICT (name) DO UPDATE SET description = EXCLUDED.description, is_system = EXCLUDED.is_system`,
      [role.name, role.description, role.is_system],
    );
  }
}

async function assignRolePermissions() {
  const { rows: perms } = await query('SELECT id, key FROM permissions');
  const permByKey = new Map(perms.map((p) => [p.key, p.id]));
  const allKeys = perms.map((p) => p.key);

  for (const [roleName, keys] of Object.entries(ROLE_DEFAULTS)) {
    const { rows } = await query('SELECT id FROM roles WHERE name = $1', [roleName]);
    if (!rows.length) continue;
    const roleId = rows[0].id;
    const target = keys === '*' ? allKeys : keys;

    await withTransaction(async (client) => {
      await client.query('DELETE FROM role_permissions WHERE role_id = $1', [roleId]);
      for (const key of target) {
        const permId = permByKey.get(key);
        if (!permId) continue;
        await client.query(
          'INSERT INTO role_permissions (role_id, permission_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
          [roleId, permId],
        );
      }
    });
  }
}

async function ensureAdminUser() {
  const { rows } = await query('SELECT id FROM users WHERE username = $1', ['admin']);
  if (rows.length) {
    console.log('[seed] admin user already exists');
    return;
  }

  const { rows: roleRows } = await query("SELECT id FROM roles WHERE name = 'Admin'");
  if (!roleRows.length) throw new Error('Admin role missing');

  const rounds = Number(process.env.BCRYPT_ROUNDS || 12);
  const hash = await bcrypt.hash('admin123', rounds);

  await query(
    `INSERT INTO users (username, password_hash, role_id, is_active)
     VALUES ($1,$2,$3,true)`,
    ['admin', hash, roleRows[0].id],
  );
  console.log('[seed] created default admin user (username: admin, password: admin123)');
}

async function run() {
  console.log('[seed] starting...');
  await ensurePermissions();
  await ensureRoles();
  await assignRolePermissions();
  await ensureAdminUser();
  console.log('[seed] done.');
}

if (require.main === module) {
  run()
    .then(() => getPool().end())
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = { run };
