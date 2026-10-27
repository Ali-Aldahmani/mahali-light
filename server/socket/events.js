// Who receives each live event (authentication audit AUTH-04).
//
// Every socket joins one room per effective permission (role permissions
// plus the user's own grants, minus the user's own denies), the same set the
// REST middleware checks. A broadcast event goes to the rooms of the
// permission that guards the matching GET route, so a user who can't load
// the data can't receive it live either, and a custom role that can load it
// receives it too. Events about one user or one session still go to that
// user's or session's own room.
//
// Sending an event that isn't in this map throws, so a new event has to be
// given an audience before it can ship.

const EVERYONE = Symbol('everyone');

const EVENT_PERMISSIONS = {
  // Cash drawer and banks
  cash_balance_updated: 'cash.view',
  drawer_opened: 'cash.view',
  drawer_closed: 'cash.view',
  bank_balance_updated: 'bank.view',

  // Customers
  customer_changed: 'customer.view',
  customer_balance_updated: 'customer.view_balance',

  // Sales
  invoice_confirmed: 'invoice.view',
  invoice_cancelled: 'invoice.view',
  invoice_pdf_pending: 'invoice.view',
  invoice_pdf_ready: 'invoice.view',
  print_receipt_requested: 'invoice.print',
  edit_request_created: 'invoice.edit_approve',
  edit_request_reviewed: 'invoice.edit_approve',

  // Returns
  return_request_created: 'return.approve',
  return_request_reviewed: 'return.approve',
  return_executed: 'return.request',

  // Products and stock. The till keeps its stock figures live from
  // stock_updated, so product.view is enough to receive it.
  product_updated: 'product.view',
  stock_updated: ['stock.view', 'product.view'],
  reorder_alert_created: 'stock.view',
  adjustment_request_created: 'stock.adjust_approve',
  stock_count_submitted: 'stock.count_approve',

  // Purchasing
  po_created: 'supplier.view',
  po_received: 'supplier.view',
  po_payment_added: 'supplier.view',
  po_overdue: 'supplier.view',
  supplier_return_created: 'supplier.view',

  // Warranties
  warranty_created: 'warranty.view',
  warranty_created_batch: 'warranty.view',
  warranty_voided: 'warranty.view',
  warranty_voided_batch: 'warranty.view',
  warranty_expired_batch: 'warranty.view',
  warranty_expiring_soon: 'warranty.view',
  warranty_claim_created: 'warranty.view',
  warranty_claim_updated: 'warranty.view',
  warranty_claim_resolved: 'warranty.view',

  // Bills and expenses
  expense_recorded: 'bills.view',
  bill_paid: 'bills.view',
  bill_due_reminder: 'bills.view',

  // Attendance and leave
  attendance_checked_in: 'attendance.view_all',
  attendance_checked_out: 'attendance.view_all',
  attendance_day_finalized: 'attendance.view_all',
  correction_request_created: 'attendance.correction_approve',
  correction_request_reviewed: 'attendance.correction_approve',
  leave_request_created: 'attendance.correction_approve',
  leave_request_reviewed: 'attendance.correction_approve',
  holiday_added: 'attendance.view_own',
  holiday_removed: 'attendance.view_own',

  // Backups. A restore restarts the server, so every signed-in screen is told.
  backup_started: 'backup.view',
  backup_completed: 'backup.view',
  backup_failed: 'backup.view',
  disk_space_warning: 'backup.view',
  restore_imminent: EVERYONE,
  restore_progress: EVERYONE,
  restore_completed: EVERYONE,
};

const ALL_PERMISSIONS_ROOM = 'perm:*';

function permissionRoom(permission) {
  return `perm:${permission}`;
}

// Rooms a socket joins for its user's effective permissions.
function permissionRooms(permissions = []) {
  return permissions.includes('*')
    ? [ALL_PERMISSIONS_ROOM]
    : permissions.map(permissionRoom);
}

function roomsForEvent(event) {
  if (!Object.prototype.hasOwnProperty.call(EVENT_PERMISSIONS, event)) {
    throw new Error(`Live event "${event}" has no audience in server/socket/events.js`);
  }
  const audience = EVENT_PERMISSIONS[event];
  if (audience === EVERYONE) return null;
  return [...[].concat(audience).map(permissionRoom), ALL_PERMISSIONS_ROOM];
}

// Send a broadcast event to everyone allowed to see it. `alsoTo` adds rooms
// such as `user:<id>` for the person the event is about; a socket in more
// than one of the rooms still gets the event once.
function emitEvent(io, event, payload, { alsoTo = [] } = {}) {
  if (!io) return;
  const rooms = roomsForEvent(event);
  if (rooms === null) {
    io.emit(event, payload);
    return;
  }
  io.to([...rooms, ...alsoTo]).emit(event, payload);
}

module.exports = {
  EVENT_PERMISSIONS, EVERYONE, emitEvent, permissionRoom, permissionRooms, roomsForEvent,
};
