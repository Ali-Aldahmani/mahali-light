const { query, withTransaction } = require('../db/postgres');
const { AppError, ERROR_CODES } = require('../../shared/errorCodes');
const { logActivity } = require('../utils/activityLog');
const attendanceService = require('./attendanceService');
const notificationService = require('./notificationService');

const UAE_WEEKEND = new Set([5, 6]); // Fri / Sat
const LEAVE_TYPES = new Set(['annual', 'sick', 'unpaid', 'emergency']);
const BALANCE_BACKED = new Set(['annual', 'sick']);
const MAX_CARRY_OVER = 15;

function dateOnly(input) {
  if (!input) return null;
  if (input instanceof Date) return input.toISOString().slice(0, 10);
  return String(input).slice(0, 10);
}

function yearOf(dateStr) {
  return Number(String(dateStr).slice(0, 4));
}

function shapeLeave(row) {
  if (!row) return null;
  return {
    id: row.id,
    employeeId: row.employee_id,
    employeeName: row.employee_name || null,
    leaveType: row.leave_type,
    startDate: dateOnly(row.start_date),
    endDate: dateOnly(row.end_date),
    totalDays: Number(row.total_days),
    reason: row.reason,
    status: row.status,
    requestedBy: row.requested_by,
    requestedByUsername: row.requested_by_username || null,
    reviewedBy: row.reviewed_by,
    reviewedByUsername: row.reviewed_by_username || null,
    reviewedAt: row.reviewed_at,
    rejectionReason: row.rejection_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function shapeBalance(row) {
  if (!row) return null;
  return {
    id: row.id,
    employeeId: row.employee_id,
    year: row.year,
    leaveType: row.leave_type,
    entitledDays: row.entitled_days,
    usedDays: row.used_days,
    remainingDays: row.remaining_days,
    carriedOverDays: row.carried_over_days,
  };
}

// =======================================================================
// Working day calculation
// =======================================================================
async function calculateWorkingDays(startDate, endDate, client = null) {
  const start = new Date(`${dateOnly(startDate)}T00:00:00`);
  const end = new Date(`${dateOnly(endDate)}T00:00:00`);
  if (end < start) return 0;

  // Pull every holiday in the window in one shot so we don't pound the DB
  // per day. Empty result is fine.
  const q = client ? client.query.bind(client) : query;
  const { rows: holidayRows } = await q(
    `SELECT date FROM holidays
      WHERE date BETWEEN $1::date AND $2::date`,
    [dateOnly(startDate), dateOnly(endDate)],
  );
  const holidaySet = new Set(holidayRows.map((r) => dateOnly(r.date)));

  let count = 0;
  const cursor = new Date(start);
  while (cursor <= end) {
    const dow = cursor.getDay();
    const iso = cursor.toISOString().slice(0, 10);
    if (!UAE_WEEKEND.has(dow) && !holidaySet.has(iso)) count += 1;
    cursor.setDate(cursor.getDate() + 1);
  }
  return count;
}

// =======================================================================
// Leave balance helpers
// =======================================================================
async function ensureBalance(client, { employeeId, year, leaveType }) {
  const entitledDefault = leaveType === 'annual' ? 30 : leaveType === 'sick' ? 15 : 0;
  await client.query(
    `INSERT INTO leave_balances
       (employee_id, year, leave_type, entitled_days, used_days, remaining_days)
     VALUES ($1, $2, $3, $4, 0, $4)
     ON CONFLICT (employee_id, year, leave_type) DO NOTHING`,
    [employeeId, year, leaveType, entitledDefault],
  );
  const { rows } = await client.query(
    `SELECT * FROM leave_balances
      WHERE employee_id = $1 AND year = $2 AND leave_type = $3
      FOR UPDATE`,
    [employeeId, year, leaveType],
  );
  return rows[0];
}

async function getBalances(employeeId, year) {
  const types = ['annual', 'sick', 'unpaid', 'emergency'];
  return withTransaction(async (client) => {
    const balances = [];
    for (const t of types) {
      balances.push(await ensureBalance(client, { employeeId, year, leaveType: t }));
    }
    return balances.map(shapeBalance);
  });
}

async function updateEntitlements(employeeId, year, payload, userId) {
  return withTransaction(async (client) => {
    const updated = [];
    for (const [leaveType, entry] of Object.entries(payload || {})) {
      if (!LEAVE_TYPES.has(leaveType)) continue;
      const balance = await ensureBalance(client, { employeeId, year, leaveType });
      const entitled =
        entry.entitledDays != null ? Number(entry.entitledDays) : balance.entitled_days;
      const carriedOver =
        entry.carriedOverDays != null
          ? Number(entry.carriedOverDays)
          : balance.carried_over_days;
      const remaining = Math.max(0, entitled + carriedOver - balance.used_days);
      const { rows } = await client.query(
        `UPDATE leave_balances
            SET entitled_days = $1,
                carried_over_days = $2,
                remaining_days = $3
          WHERE id = $4
          RETURNING *`,
        [entitled, carriedOver, remaining, balance.id],
      );
      updated.push(rows[0]);
    }
    await logActivity({
      entityType: 'leave_balance',
      entityId: employeeId,
      action: 'leave_balance.updated',
      performedBy: userId,
      newValue: { year, payload },
    });
    return updated.map(shapeBalance);
  });
}

// =======================================================================
// Submit / approve / reject / cancel
// =======================================================================
async function submitLeave({
  employeeId,
  leaveType,
  startDate,
  endDate,
  reason,
  requestedBy,
  io = null,
}) {
  if (!LEAVE_TYPES.has(leaveType)) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'Invalid leave type.');
  }
  if (!reason || reason.trim().length < 5) {
    throw new AppError(
      ERROR_CODES.VALIDATION_FAILED,
      'Please provide a reason (at least 5 characters).',
    );
  }
  const start = dateOnly(startDate);
  const end = dateOnly(endDate);
  if (!start || !end || new Date(end) < new Date(start)) {
    throw new AppError(ERROR_CODES.BIZ_LEAVE_INVALID_RANGE, undefined, { status: 400 });
  }

  return withTransaction(async (client) => {
    const { rows: empRows } = await client.query(
      `SELECT id, name, is_active FROM employees WHERE id = $1`,
      [employeeId],
    );
    if (!empRows.length || !empRows[0].is_active) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, 'Employee not found.', {
        status: 404,
      });
    }
    const employee = empRows[0];

    const totalDays = await calculateWorkingDays(start, end, client);
    if (totalDays <= 0) {
      throw new AppError(
        ERROR_CODES.BIZ_LEAVE_INVALID_RANGE,
        'The selected range has no working days.',
      );
    }

    // Overlap check — block if the employee already has a pending or
    // approved leave that intersects this range.
    const { rows: overlapRows } = await client.query(
      `SELECT id, status, start_date, end_date
         FROM leaves
        WHERE employee_id = $1
          AND status IN ('pending','approved')
          AND start_date <= $3::date
          AND end_date >= $2::date`,
      [employeeId, start, end],
    );
    if (overlapRows.length) {
      throw new AppError(ERROR_CODES.BIZ_LEAVE_OVERLAP, undefined, {
        status: 409,
        details: { overlapIds: overlapRows.map((r) => r.id) },
      });
    }

    // Balance check for annual / sick.
    if (BALANCE_BACKED.has(leaveType)) {
      const year = yearOf(start);
      const balance = await ensureBalance(client, { employeeId, year, leaveType });
      const remaining =
        Number(balance.remaining_days) ||
        Math.max(
          0,
          Number(balance.entitled_days || 0) +
            Number(balance.carried_over_days || 0) -
            Number(balance.used_days || 0),
        );
      if (totalDays > remaining) {
        throw new AppError(
          ERROR_CODES.BIZ_INSUFFICIENT_LEAVE_BALANCE,
          `Requested ${totalDays} days, but only ${remaining} ${leaveType} day(s) remaining.`,
          {
            status: 409,
            details: { requested: totalDays, remaining, leaveType, year },
          },
        );
      }
    }

    const { rows } = await client.query(
      `INSERT INTO leaves
         (employee_id, leave_type, start_date, end_date, total_days,
          reason, status, requested_by)
       VALUES ($1,$2,$3::date,$4::date,$5,$6,'pending',$7)
       RETURNING *`,
      [
        employeeId,
        leaveType,
        start,
        end,
        totalDays,
        reason.trim(),
        requestedBy || null,
      ],
    );
    const leave = rows[0];

    await logActivity({
      entityType: 'leave',
      entityId: leave.id,
      action: 'leave.requested',
      performedBy: requestedBy,
      newValue: { leaveType, totalDays, startDate: start, endDate: end },
    });

    if (io) {
      const payload = {
        leaveId: leave.id,
        employeeId,
        employeeName: employee.name,
        leaveType,
        startDate: start,
        endDate: end,
        totalDays,
      };
      io.to('role:Manager').emit('leave_request_created', payload);
      io.to('role:Admin').emit('leave_request_created', payload);
    }

    try {
      await notificationService.notifyManagersAndAdmins({
        type: 'approval.leave_pending',
        category: 'approval',
        severity: 'info',
        title: `Leave request: ${employee.name}`,
        message: `${leaveType} (${totalDays} day${totalDays === 1 ? '' : 's'}), ${start} → ${end}.`,
        referenceType: 'leave',
        referenceId: leave.id,
        actionUrl: `/attendance?tab=leaves`,
        createdBy: leave.requested_by,
        skipForUserId: leave.requested_by,
      });
    } catch (_e) { /* best-effort */ }

    return shapeLeave({ ...leave, employee_name: employee.name });
  });
}

async function approveLeave({ leaveId, managerId, io = null }) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT l.*, e.name AS employee_name
         FROM leaves l
         LEFT JOIN employees e ON e.id = l.employee_id
        WHERE l.id = $1 FOR UPDATE`,
      [leaveId],
    );
    if (!rows.length) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, { status: 404 });
    }
    const leave = rows[0];
    if (leave.status !== 'pending') {
      throw new AppError(ERROR_CODES.BIZ_LEAVE_NOT_PENDING, undefined, { status: 409 });
    }

    await client.query(
      `UPDATE leaves
          SET status = 'approved',
              reviewed_by = $1,
              reviewed_at = NOW(),
              rejection_reason = NULL,
              updated_at = NOW()
        WHERE id = $2`,
      [managerId, leaveId],
    );

    if (BALANCE_BACKED.has(leave.leave_type)) {
      const year = yearOf(dateOnly(leave.start_date));
      const balance = await ensureBalance(client, {
        employeeId: leave.employee_id,
        year,
        leaveType: leave.leave_type,
      });
      const newUsed = Number(balance.used_days || 0) + Number(leave.total_days);
      const newRemaining = Math.max(
        0,
        Number(balance.entitled_days || 0) +
          Number(balance.carried_over_days || 0) -
          newUsed,
      );
      await client.query(
        `UPDATE leave_balances
            SET used_days = $1,
                remaining_days = $2
          WHERE id = $3`,
        [newUsed, newRemaining, balance.id],
      );
    }

    await attendanceService.createLeaveAttendanceRecords(client, {
      employeeId: leave.employee_id,
      startDate: leave.start_date,
      endDate: leave.end_date,
      userId: managerId,
    });

    await logActivity({
      entityType: 'leave',
      entityId: leaveId,
      action: 'leave.approved',
      performedBy: managerId,
      newValue: { leaveType: leave.leave_type, totalDays: leave.total_days },
    });

    if (io) {
      const payload = {
        leaveId,
        employeeId: leave.employee_id,
        employeeName: leave.employee_name,
        status: 'approved',
        reviewedBy: managerId,
      };
      io.to('role:Manager').emit('leave_request_reviewed', payload);
      io.to('role:Admin').emit('leave_request_reviewed', payload);
      if (leave.requested_by) {
        io.to(`user:${leave.requested_by}`).emit('leave_request_reviewed', payload);
      }
    }

    if (leave.requested_by) {
      try {
        await notificationService.notifyUser(leave.requested_by, {
          type: 'attendance.leave_reviewed',
          category: 'attendance',
          severity: 'info',
          title: 'Leave approved',
          message: `Your ${leave.leave_type} leave (${leave.total_days}d) was approved.`,
          referenceType: 'leave',
          referenceId: leaveId,
          actionUrl: `/attendance?tab=leaves`,
          createdBy: managerId,
        });
      } catch (_e) { /* best-effort */ }
    }

    return shapeLeave({ ...leave, status: 'approved', reviewed_by: managerId });
  });
}

async function rejectLeave({ leaveId, managerId, reason, io = null }) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT l.*, e.name AS employee_name
         FROM leaves l
         LEFT JOIN employees e ON e.id = l.employee_id
        WHERE l.id = $1 FOR UPDATE`,
      [leaveId],
    );
    if (!rows.length) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, { status: 404 });
    }
    const leave = rows[0];
    if (leave.status !== 'pending') {
      throw new AppError(ERROR_CODES.BIZ_LEAVE_NOT_PENDING, undefined, { status: 409 });
    }
    if (!reason || reason.trim().length < 3) {
      throw new AppError(
        ERROR_CODES.VALIDATION_FAILED,
        'Please provide a rejection reason.',
      );
    }

    await client.query(
      `UPDATE leaves
          SET status = 'rejected',
              reviewed_by = $1,
              reviewed_at = NOW(),
              rejection_reason = $2,
              updated_at = NOW()
        WHERE id = $3`,
      [managerId, reason.trim(), leaveId],
    );

    await logActivity({
      entityType: 'leave',
      entityId: leaveId,
      action: 'leave.rejected',
      performedBy: managerId,
      notes: reason,
    });

    if (io) {
      const payload = {
        leaveId,
        employeeId: leave.employee_id,
        employeeName: leave.employee_name,
        status: 'rejected',
        rejectionReason: reason.trim(),
        reviewedBy: managerId,
      };
      io.to('role:Manager').emit('leave_request_reviewed', payload);
      if (leave.requested_by) {
        io.to(`user:${leave.requested_by}`).emit('leave_request_reviewed', payload);
      }
    }

    if (leave.requested_by) {
      try {
        await notificationService.notifyUser(leave.requested_by, {
          type: 'attendance.leave_reviewed',
          category: 'attendance',
          severity: 'warning',
          title: 'Leave rejected',
          message: `Reason: ${reason.trim()}`,
          referenceType: 'leave',
          referenceId: leaveId,
          actionUrl: `/attendance?tab=leaves`,
          createdBy: managerId,
        });
      } catch (_e) { /* best-effort */ }
    }

    return shapeLeave({
      ...leave,
      status: 'rejected',
      rejection_reason: reason.trim(),
    });
  });
}

async function cancelLeave({ leaveId, requesterId, io = null }) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM leaves WHERE id = $1 FOR UPDATE`,
      [leaveId],
    );
    if (!rows.length) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, { status: 404 });
    }
    const leave = rows[0];
    if (leave.status !== 'pending') {
      throw new AppError(ERROR_CODES.BIZ_LEAVE_NOT_PENDING, undefined, { status: 409 });
    }
    if (requesterId && leave.requested_by && requesterId !== leave.requested_by) {
      throw new AppError(
        ERROR_CODES.BIZ_INVALID_STATE,
        'Only the original requester can cancel this leave.',
        { status: 403 },
      );
    }

    await client.query(
      `UPDATE leaves
          SET status = 'cancelled',
              updated_at = NOW()
        WHERE id = $1`,
      [leaveId],
    );

    await logActivity({
      entityType: 'leave',
      entityId: leaveId,
      action: 'leave.cancelled',
      performedBy: requesterId,
    });

    if (io) {
      io.to('role:Manager').emit('leave_request_reviewed', {
        leaveId,
        employeeId: leave.employee_id,
        status: 'cancelled',
      });
    }

    return shapeLeave({ ...leave, status: 'cancelled' });
  });
}

// =======================================================================
// Carry-over year-end action
// =======================================================================
async function carryOverAnnual({ fromYear, toYear, userId }) {
  return withTransaction(async (client) => {
    const { rows: prev } = await client.query(
      `SELECT * FROM leave_balances
        WHERE year = $1 AND leave_type = 'annual'`,
      [fromYear],
    );
    const results = [];
    for (const p of prev) {
      const remaining = Math.max(
        0,
        Number(p.entitled_days || 0) +
          Number(p.carried_over_days || 0) -
          Number(p.used_days || 0),
      );
      const carry = Math.min(MAX_CARRY_OVER, remaining);
      // Ensure the row for the new year exists with the default entitlement.
      const next = await ensureBalance(client, {
        employeeId: p.employee_id,
        year: toYear,
        leaveType: 'annual',
      });
      const newRemaining = Math.max(
        0,
        Number(next.entitled_days || 0) +
          carry -
          Number(next.used_days || 0),
      );
      await client.query(
        `UPDATE leave_balances
            SET carried_over_days = $1,
                remaining_days = $2
          WHERE id = $3`,
        [carry, newRemaining, next.id],
      );
      results.push({ employeeId: p.employee_id, carriedOver: carry });
    }
    await logActivity({
      entityType: 'leave_balance',
      entityId: null,
      action: 'leave_balance.carry_over',
      performedBy: userId,
      newValue: { fromYear, toYear, count: results.length },
    });
    return { fromYear, toYear, count: results.length, results };
  });
}

// =======================================================================
// Reads
// =======================================================================
async function listLeaves({
  employeeId = null,
  status = null,
  leaveType = null,
  from = null,
  to = null,
  limit = 50,
  offset = 0,
}) {
  const parts = [];
  const params = [];
  let i = 1;
  if (employeeId) {
    parts.push(`l.employee_id = $${i++}`);
    params.push(employeeId);
  }
  if (status) {
    parts.push(`l.status = $${i++}`);
    params.push(status);
  }
  if (leaveType) {
    parts.push(`l.leave_type = $${i++}`);
    params.push(leaveType);
  }
  if (from) {
    parts.push(`l.end_date >= $${i++}::date`);
    params.push(from);
  }
  if (to) {
    parts.push(`l.start_date <= $${i++}::date`);
    params.push(to);
  }
  const where = parts.length ? `WHERE ${parts.join(' AND ')}` : '';
  const { rows } = await query(
    `SELECT l.*, e.name AS employee_name,
            ru.username AS requested_by_username,
            rv.username AS reviewed_by_username
       FROM leaves l
       LEFT JOIN employees e ON e.id = l.employee_id
       LEFT JOIN users ru ON ru.id = l.requested_by
       LEFT JOIN users rv ON rv.id = l.reviewed_by
       ${where}
       ORDER BY l.created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset],
  );
  const { rows: tot } = await query(
    `SELECT COUNT(*)::int AS total FROM leaves l ${where}`,
    params,
  );
  return { rows: rows.map(shapeLeave), total: tot[0].total };
}

async function getLeave(id) {
  const { rows } = await query(
    `SELECT l.*, e.name AS employee_name,
            ru.username AS requested_by_username,
            rv.username AS reviewed_by_username
       FROM leaves l
       LEFT JOIN employees e ON e.id = l.employee_id
       LEFT JOIN users ru ON ru.id = l.requested_by
       LEFT JOIN users rv ON rv.id = l.reviewed_by
      WHERE l.id = $1`,
    [id],
  );
  if (!rows.length) {
    throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, { status: 404 });
  }
  return shapeLeave(rows[0]);
}

async function upcomingApprovedLeaves(employeeId) {
  const today = new Date().toISOString().slice(0, 10);
  const { rows } = await query(
    `SELECT * FROM leaves
      WHERE employee_id = $1
        AND status = 'approved'
        AND end_date >= $2::date
      ORDER BY start_date ASC`,
    [employeeId, today],
  );
  return rows.map(shapeLeave);
}

module.exports = {
  submitLeave,
  approveLeave,
  rejectLeave,
  cancelLeave,
  calculateWorkingDays,
  getBalances,
  updateEntitlements,
  carryOverAnnual,
  listLeaves,
  getLeave,
  upcomingApprovedLeaves,
  shapeLeave,
  shapeBalance,
};
