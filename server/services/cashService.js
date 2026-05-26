const { query, withTransaction } = require('../db/postgres');
const { AppError, ERROR_CODES } = require('../../shared/errorCodes');
const { logActivity } = require('../utils/activityLog');

// Tolerance below which a drawer-close discrepancy is allowed without manager
// approval (the cashier must still leave a note). Anything above this trips
// BIZ_DISCREPANCY_NEEDS_APPROVAL until a manager force-closes.
const DISCREPANCY_TOLERANCE = 10;

const ALLOWED_TX_TYPES = new Set([
  'sale',
  'refund',
  'supplier_payment',
  'customer_payment',
  'expense',
  'manual_in',
  'manual_out',
  'opening',
  'closing',
  'transfer',
]);

function money(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function nowIso() {
  return new Date().toISOString();
}

// =======================================================================
// Drawer lookup helpers
// =======================================================================
async function getDrawerRow(client) {
  const { rows } = await client.query(
    `SELECT * FROM cash_drawer ORDER BY updated_at ASC LIMIT 1 FOR UPDATE`,
  );
  if (!rows.length) {
    // Auto-seed the singleton drawer (the migration already inserts one but
    // this keeps the service self-healing in dev).
    await client.query(
      `INSERT INTO cash_drawer (name, status) VALUES ('Main Cash Drawer','closed')`,
    );
    const { rows: again } = await client.query(
      `SELECT * FROM cash_drawer ORDER BY updated_at ASC LIMIT 1 FOR UPDATE`,
    );
    return again[0];
  }
  return rows[0];
}

async function getOpenSession(client, drawerId) {
  const { rows } = await client.query(
    `SELECT * FROM cash_drawer_sessions
       WHERE cash_drawer_id = $1 AND status = 'open'
       ORDER BY opened_at DESC LIMIT 1`,
    [drawerId],
  );
  return rows[0] || null;
}

// Public read used by controllers + treasury summary.
async function getDrawerState() {
  const { rows } = await query(
    `SELECT d.*, ou.username AS opened_by_username,
            cu.username AS closed_by_username
       FROM cash_drawer d
       LEFT JOIN users ou ON ou.id = d.opened_by
       LEFT JOIN users cu ON cu.id = d.closed_by
       ORDER BY d.updated_at ASC LIMIT 1`,
  );
  if (!rows.length) {
    return {
      id: null,
      name: 'Main Cash Drawer',
      currentBalance: 0,
      status: 'closed',
      session: null,
    };
  }
  const drawer = rows[0];
  let session = null;
  if (drawer.status === 'open') {
    const { rows: sessRows } = await query(
      `SELECT s.*, u.username AS opened_by_username
         FROM cash_drawer_sessions s
         LEFT JOIN users u ON u.id = s.opened_by
        WHERE s.cash_drawer_id = $1 AND s.status = 'open'
        ORDER BY s.opened_at DESC LIMIT 1`,
      [drawer.id],
    );
    if (sessRows.length) session = shapeSession(sessRows[0]);
  }
  return {
    id: drawer.id,
    name: drawer.name,
    currentBalance: Number(drawer.current_balance),
    openingBalance: Number(drawer.opening_balance),
    status: drawer.status,
    lastOpenedAt: drawer.last_opened_at,
    lastClosedAt: drawer.last_closed_at,
    openedBy: drawer.opened_by,
    openedByUsername: drawer.opened_by_username || null,
    closedBy: drawer.closed_by,
    closedByUsername: drawer.closed_by_username || null,
    notes: drawer.notes,
    session,
  };
}

function shapeSession(row) {
  if (!row) return null;
  return {
    id: row.id,
    drawerId: row.cash_drawer_id,
    openedBy: row.opened_by,
    openedByUsername: row.opened_by_username || null,
    openingBalance: Number(row.opening_balance),
    closedBy: row.closed_by,
    closedByUsername: row.closed_by_username || null,
    closingBalance: row.closing_balance != null ? Number(row.closing_balance) : null,
    expectedBalance: row.expected_balance != null ? Number(row.expected_balance) : null,
    discrepancy: row.discrepancy != null ? Number(row.discrepancy) : null,
    openedAt: row.opened_at,
    closedAt: row.closed_at,
    status: row.status,
    notes: row.notes,
  };
}

function shapeTransaction(row) {
  return {
    id: row.id,
    cashDrawerId: row.cash_drawer_id,
    sessionId: row.session_id,
    transactionType: row.transaction_type,
    direction: row.direction,
    amount: Number(row.amount),
    balanceBefore: Number(row.balance_before),
    balanceAfter: Number(row.balance_after),
    referenceType: row.reference_type,
    referenceId: row.reference_id,
    employeeId: row.employee_id,
    employeeUsername: row.employee_username || null,
    timestamp: row.timestamp,
    notes: row.notes,
  };
}

// =======================================================================
// Internal: post a single transaction row + bump the drawer balance.
// Accepts an existing `client` (when the caller is already inside a
// withTransaction) — this is how invoice / PO / return / collection flows
// chain the bookkeeping without spawning a nested transaction.
// =======================================================================
async function postTransactionWith(client, params) {
  const {
    transactionType,
    direction,
    amount,
    referenceType = null,
    referenceId = null,
    employeeId = null,
    notes = null,
    allowAutoOpen = true,
    sessionOverride = null,
  } = params;

  if (!ALLOWED_TX_TYPES.has(transactionType)) {
    throw new AppError(
      ERROR_CODES.VALIDATION_FAILED,
      `Invalid cash transaction type ${transactionType}.`,
    );
  }
  if (direction !== 'in' && direction !== 'out') {
    throw new AppError(
      ERROR_CODES.VALIDATION_FAILED,
      'Cash direction must be "in" or "out".',
    );
  }
  const amt = money(amount);
  if (!Number.isFinite(amt) || amt <= 0) {
    throw new AppError(
      ERROR_CODES.VALIDATION_FAILED,
      'Cash amount must be greater than zero.',
    );
  }

  const drawer = await getDrawerRow(client);
  let session = await getOpenSession(client, drawer.id);

  // The drawer being closed is normally a hard error, but the invoice/PO/return
  // flows can't fail an entire sale if the cashier forgot to open the drawer.
  // For those cases (allowAutoOpen) we silently open a session using the
  // current balance, mark it as auto-opened, and continue.
  if (!session && drawer.status !== 'open') {
    if (!allowAutoOpen && transactionType !== 'opening') {
      throw new AppError(ERROR_CODES.BIZ_DRAWER_CLOSED, undefined, {
        status: 409,
      });
    }
    if (transactionType !== 'opening') {
      const opening = Number(drawer.current_balance) || 0;
      const { rows: sessRows } = await client.query(
        `INSERT INTO cash_drawer_sessions
           (cash_drawer_id, opened_by, opening_balance, status, notes)
         VALUES ($1,$2,$3,'open',$4)
         RETURNING *`,
        [drawer.id, employeeId, opening, 'Auto-opened by system'],
      );
      session = sessRows[0];
      await client.query(
        `UPDATE cash_drawer
            SET status = 'open',
                opening_balance = $1,
                last_opened_at = NOW(),
                opened_by = $2,
                updated_at = NOW()
          WHERE id = $3`,
        [opening, employeeId, drawer.id],
      );
    }
  }

  const before = money(drawer.current_balance);
  const delta = direction === 'in' ? amt : -amt;
  const after = money(before + delta);

  if (direction === 'out' && after < -0.0001) {
    throw new AppError(
      ERROR_CODES.BIZ_INSUFFICIENT_CASH,
      `Cash drawer has ${before.toFixed(2)} AED, cannot pay out ${amt.toFixed(2)} AED.`,
      { status: 409, details: { available: before, requested: amt } },
    );
  }

  const sessionId = sessionOverride || session?.id || null;

  const { rows: txRows } = await client.query(
    `INSERT INTO cash_drawer_transactions
       (cash_drawer_id, session_id, transaction_type, direction, amount,
        balance_before, balance_after, reference_type, reference_id,
        employee_id, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING *`,
    [
      drawer.id,
      sessionId,
      transactionType,
      direction,
      amt,
      before,
      after,
      referenceType,
      referenceId,
      employeeId,
      notes,
    ],
  );

  await client.query(
    `UPDATE cash_drawer
        SET current_balance = $1,
            updated_at = NOW()
      WHERE id = $2`,
    [after, drawer.id],
  );

  return {
    transaction: txRows[0],
    drawerId: drawer.id,
    sessionId,
    balanceBefore: before,
    balanceAfter: after,
    delta,
  };
}

// =======================================================================
// Public posting helpers
// =======================================================================

// Generic helper: caller may pass `client` when already inside a transaction;
// otherwise we spin up our own and emit the balance update.
async function recordCash(params) {
  const { client, io = null, ...rest } = params;
  if (client) {
    const result = await postTransactionWith(client, rest);
    return result;
  }
  const result = await withTransaction((c) =>
    postTransactionWith(c, rest),
  );
  if (io) {
    io.to('role:Manager').emit('cash_balance_updated', {
      newBalance: result.balanceAfter,
      delta: result.delta,
      transactionType: rest.transactionType,
      changedBy: rest.employeeId || null,
      at: nowIso(),
    });
    io.to('role:Admin').emit('cash_balance_updated', {
      newBalance: result.balanceAfter,
      delta: result.delta,
      transactionType: rest.transactionType,
      changedBy: rest.employeeId || null,
      at: nowIso(),
    });
  }
  return result;
}

async function recordCashIn(params) {
  return recordCash({ ...params, direction: 'in' });
}

async function recordCashOut(params) {
  return recordCash({ ...params, direction: 'out' });
}

// =======================================================================
// Drawer lifecycle
// =======================================================================
async function openDrawer({ openingBalance, employeeId, notes = null, io = null }) {
  const amt = money(openingBalance);
  if (!Number.isFinite(amt) || amt < 0) {
    throw new AppError(
      ERROR_CODES.VALIDATION_FAILED,
      'Opening balance must be zero or more.',
    );
  }
  const result = await withTransaction(async (client) => {
    const drawer = await getDrawerRow(client);
    if (drawer.status === 'open') {
      throw new AppError(ERROR_CODES.BIZ_DRAWER_ALREADY_OPEN, undefined, {
        status: 409,
      });
    }
    const { rows: sessRows } = await client.query(
      `INSERT INTO cash_drawer_sessions
         (cash_drawer_id, opened_by, opening_balance, status, notes)
       VALUES ($1,$2,$3,'open',$4)
       RETURNING *`,
      [drawer.id, employeeId, amt, notes],
    );
    const session = sessRows[0];

    await client.query(
      `UPDATE cash_drawer
          SET status = 'open',
              current_balance = $1,
              opening_balance = $1,
              opened_by = $2,
              last_opened_at = NOW(),
              updated_at = NOW(),
              notes = COALESCE(NULLIF($3, ''), notes)
        WHERE id = $4`,
      [amt, employeeId, notes || '', drawer.id],
    );

    // Record an `opening` transaction so the running ledger has a starting
    // anchor for the session totals.
    await client.query(
      `INSERT INTO cash_drawer_transactions
         (cash_drawer_id, session_id, transaction_type, direction, amount,
          balance_before, balance_after, employee_id, notes)
       VALUES ($1,$2,'opening','in',$3,0,$3,$4,$5)`,
      [drawer.id, session.id, amt, employeeId, 'Drawer opened'],
    );

    await logActivity({
      entityType: 'cash_drawer',
      entityId: drawer.id,
      action: 'cash_drawer.opened',
      performedBy: employeeId,
      newValue: { openingBalance: amt, sessionId: session.id },
    });

    return { drawer, session };
  });

  if (io) {
    io.emit('drawer_opened', {
      drawerId: result.drawer.id,
      sessionId: result.session.id,
      openedBy: employeeId,
      openingBalance: amt,
      at: nowIso(),
    });
    io.to('role:Manager').emit('cash_balance_updated', {
      newBalance: amt,
      delta: amt,
      transactionType: 'opening',
      changedBy: employeeId,
      at: nowIso(),
    });
  }
  return result;
}

async function closeDrawer({
  closingBalance,
  employeeId,
  notes = null,
  force = false,
  io = null,
}) {
  const counted = money(closingBalance);
  if (!Number.isFinite(counted) || counted < 0) {
    throw new AppError(
      ERROR_CODES.VALIDATION_FAILED,
      'Closing balance must be zero or more.',
    );
  }
  const result = await withTransaction(async (client) => {
    const drawer = await getDrawerRow(client);
    if (drawer.status !== 'open') {
      throw new AppError(
        ERROR_CODES.BIZ_INVALID_STATE,
        'Drawer is already closed.',
        { status: 409 },
      );
    }
    const session = await getOpenSession(client, drawer.id);
    if (!session) {
      throw new AppError(
        ERROR_CODES.BIZ_INVALID_STATE,
        'No open drawer session to close.',
        { status: 409 },
      );
    }

    // The "expected" balance is whatever the running ledger says we should
    // have. We trust the running balance because every cash event since the
    // session began has updated it through this service.
    const expected = money(drawer.current_balance);
    const discrepancy = money(counted - expected);

    if (Math.abs(discrepancy) > DISCREPANCY_TOLERANCE && !force) {
      throw new AppError(
        ERROR_CODES.BIZ_DISCREPANCY_NEEDS_APPROVAL,
        `Discrepancy of ${discrepancy.toFixed(2)} AED exceeds the ${DISCREPANCY_TOLERANCE.toFixed(2)} AED tolerance.`,
        {
          status: 409,
          details: {
            expectedBalance: expected,
            countedBalance: counted,
            discrepancy,
            tolerance: DISCREPANCY_TOLERANCE,
          },
        },
      );
    }
    if (Math.abs(discrepancy) > 0.0001 && !notes) {
      throw new AppError(
        ERROR_CODES.VALIDATION_FAILED,
        'A note is required to explain a cash discrepancy.',
      );
    }

    await client.query(
      `INSERT INTO cash_drawer_transactions
         (cash_drawer_id, session_id, transaction_type, direction, amount,
          balance_before, balance_after, employee_id, notes)
       VALUES ($1,$2,'closing','out',0,$3,$4,$5,$6)`,
      [
        drawer.id,
        session.id,
        expected,
        counted,
        employeeId,
        notes || `Drawer closed. Discrepancy ${discrepancy.toFixed(2)} AED.`,
      ],
    );

    await client.query(
      `UPDATE cash_drawer_sessions
          SET status = 'closed',
              closed_by = $1,
              closing_balance = $2,
              expected_balance = $3,
              discrepancy = $4,
              closed_at = NOW(),
              notes = COALESCE(NULLIF($5, ''), notes)
        WHERE id = $6`,
      [employeeId, counted, expected, discrepancy, notes || '', session.id],
    );

    await client.query(
      `UPDATE cash_drawer
          SET status = 'closed',
              current_balance = $1,
              closed_by = $2,
              last_closed_at = NOW(),
              updated_at = NOW()
        WHERE id = $3`,
      [counted, employeeId, drawer.id],
    );

    await logActivity({
      entityType: 'cash_drawer',
      entityId: drawer.id,
      action: Math.abs(discrepancy) > 0.0001
        ? 'cash_drawer.discrepancy_noted'
        : 'cash_drawer.closed',
      performedBy: employeeId,
      newValue: {
        sessionId: session.id,
        expectedBalance: expected,
        countedBalance: counted,
        discrepancy,
      },
      notes,
    });

    return {
      drawer,
      session: { ...session, closing_balance: counted, expected_balance: expected, discrepancy },
      expected,
      discrepancy,
      counted,
    };
  });

  if (io) {
    io.to('role:Manager').emit('drawer_closed', {
      drawerId: result.drawer.id,
      sessionId: result.session.id,
      closedBy: employeeId,
      closingBalance: result.counted,
      expectedBalance: result.expected,
      discrepancy: result.discrepancy,
      at: nowIso(),
    });
    io.to('role:Admin').emit('drawer_closed', {
      drawerId: result.drawer.id,
      sessionId: result.session.id,
      closedBy: employeeId,
      closingBalance: result.counted,
      expectedBalance: result.expected,
      discrepancy: result.discrepancy,
      at: nowIso(),
    });
    io.to('role:Manager').emit('cash_balance_updated', {
      newBalance: result.counted,
      delta: result.counted - result.expected,
      transactionType: 'closing',
      changedBy: employeeId,
      at: nowIso(),
    });
  }
  return result;
}

async function recordManualAdjustment({
  amount,
  direction,
  reason,
  employeeId,
  io = null,
}) {
  if (!reason || !reason.trim()) {
    throw new AppError(
      ERROR_CODES.VALIDATION_FAILED,
      'A reason is required for cash adjustments.',
    );
  }
  const type = direction === 'in' ? 'manual_in' : 'manual_out';
  const result = await recordCash({
    transactionType: type,
    direction,
    amount,
    employeeId,
    notes: reason.trim(),
    io,
  });
  await logActivity({
    entityType: 'cash_drawer',
    entityId: result.drawerId,
    action: 'cash_drawer.adjusted',
    performedBy: employeeId,
    newValue: { direction, amount: money(amount) },
    notes: reason.trim(),
  });
  return result;
}

// =======================================================================
// Session reconciliation summary (used by the close-drawer screen and the
// printable daily reconciliation report).
// =======================================================================
async function sessionSummary(sessionId) {
  const { rows: sessRows } = await query(
    `SELECT s.*, ou.username AS opened_by_username,
            cu.username AS closed_by_username
       FROM cash_drawer_sessions s
       LEFT JOIN users ou ON ou.id = s.opened_by
       LEFT JOIN users cu ON cu.id = s.closed_by
      WHERE s.id = $1`,
    [sessionId],
  );
  if (!sessRows.length) {
    throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, {
      status: 404,
    });
  }
  const session = shapeSession(sessRows[0]);

  const { rows: aggregates } = await query(
    `SELECT transaction_type, direction,
            COUNT(*)::int AS count,
            COALESCE(SUM(amount), 0)::numeric AS total
       FROM cash_drawer_transactions
      WHERE session_id = $1
      GROUP BY transaction_type, direction`,
    [sessionId],
  );

  const totals = { in: 0, out: 0, byType: {} };
  for (const a of aggregates) {
    if (a.transaction_type === 'opening' || a.transaction_type === 'closing') continue;
    const amount = Number(a.total);
    totals[a.direction] = money(totals[a.direction] + amount);
    const key = `${a.transaction_type}:${a.direction}`;
    totals.byType[key] = { count: a.count, total: amount };
  }
  totals.net = money(totals.in - totals.out);

  return { session, totals };
}

async function listSessionTransactions(sessionId, { limit = 50, offset = 0 } = {}) {
  const { rows } = await query(
    `SELECT t.*, u.username AS employee_username
       FROM cash_drawer_transactions t
       LEFT JOIN users u ON u.id = t.employee_id
      WHERE t.session_id = $1
      ORDER BY t.timestamp ASC
      LIMIT $2 OFFSET $3`,
    [sessionId, limit, offset],
  );
  return rows.map(shapeTransaction);
}

module.exports = {
  // lifecycle
  openDrawer,
  closeDrawer,
  // mutations
  recordCashIn,
  recordCashOut,
  recordManualAdjustment,
  postTransactionWith,
  // reads
  getDrawerState,
  getOpenSession,
  sessionSummary,
  listSessionTransactions,
  shapeTransaction,
  shapeSession,
  // constants
  DISCREPANCY_TOLERANCE,
};
