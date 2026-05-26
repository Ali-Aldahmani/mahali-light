const { query, withTransaction } = require('../db/postgres');
const { AppError, ERROR_CODES } = require('../../shared/errorCodes');
const { logActivity } = require('../utils/activityLog');

// UAE Friday/Saturday weekend. Sunday is the first working day.
// JS getDay(): 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
const UAE_WEEKEND = new Set([5, 6]);
const CORRECTION_WINDOW_DAYS = 30;

function money(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function todayDateString() {
  // Local server day; the store runs in Asia/Dubai timezone via OS TZ.
  return new Date().toISOString().slice(0, 10);
}

function dateOnly(input) {
  if (!input) return null;
  if (input instanceof Date) return input.toISOString().slice(0, 10);
  return String(input).slice(0, 10);
}

function isUaeWeekend(date) {
  const d = typeof date === 'string' ? new Date(`${date}T00:00:00`) : date;
  return UAE_WEEKEND.has(d.getDay());
}

async function isHoliday(client, dateStr) {
  const { rows } = await (client || { query }).query(
    `SELECT 1 FROM holidays WHERE date = $1::date LIMIT 1`,
    [dateStr],
  );
  return rows.length > 0;
}

function shapeAttendance(row) {
  if (!row) return null;
  return {
    id: row.id,
    employeeId: row.employee_id,
    employeeName: row.employee_name || null,
    roleTitle: row.role_title || null,
    date: dateOnly(row.date),
    checkIn: row.check_in,
    checkOut: row.check_out,
    checkInMethod: row.check_in_method,
    checkOutMethod: row.check_out_method,
    status: row.status,
    workingHours: row.working_hours != null ? Number(row.working_hours) : null,
    overtimeHours: row.overtime_hours != null ? Number(row.overtime_hours) : 0,
    lateMinutes: row.late_minutes != null ? Number(row.late_minutes) : 0,
    shortageHours: row.shortage_hours != null ? Number(row.shortage_hours) : 0,
    notes: row.notes,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// =======================================================================
// Check in / out
// =======================================================================

// Auto check-in fired by the auth login route. Idempotent: if the employee
// already has a record for today (whether opened via an earlier login or
// manually created by a manager) we simply leave it alone.
async function checkIn({ employeeId, method = 'app_login', userId = null, io = null }) {
  if (!employeeId) return null;
  return withTransaction(async (client) => {
    const date = todayDateString();

    const { rows: empRows } = await client.query(
      `SELECT id, name, shift_start, late_threshold_mins, is_active
         FROM employees WHERE id = $1 FOR UPDATE`,
      [employeeId],
    );
    if (!empRows.length || !empRows[0].is_active) return null;
    const employee = empRows[0];

    // Already a record for today? Don't overwrite — multi-PC logins should
    // not affect the original check_in time.
    const { rows: existingRows } = await client.query(
      `SELECT * FROM attendance
        WHERE employee_id = $1 AND date = $2::date`,
      [employeeId, date],
    );
    if (existingRows.length) {
      return shapeAttendance({ ...existingRows[0], employee_name: employee.name });
    }

    const now = new Date();
    const shiftStart = employee.shift_start || '09:00:00';
    const thresholdMins = employee.late_threshold_mins ?? 15;

    // shift_start in DB is a TIME — convert to a Date on today's date so we
    // can compare against `now` for tardiness.
    const [hh, mm, ss] = String(shiftStart).split(':');
    const shiftDate = new Date(now);
    shiftDate.setHours(Number(hh) || 0, Number(mm) || 0, Number(ss) || 0, 0);

    const diffMs = now - shiftDate;
    const diffMin = Math.round(diffMs / 60000);
    let status = 'present';
    let lateMinutes = 0;
    if (diffMin > thresholdMins) {
      status = 'late';
      lateMinutes = diffMin;
    }

    const { rows } = await client.query(
      `INSERT INTO attendance
         (employee_id, date, check_in, check_in_method,
          status, late_minutes, created_by, updated_by)
       VALUES ($1, $2::date, $3, $4, $5, $6, $7, $7)
       ON CONFLICT (employee_id, date) DO NOTHING
       RETURNING *`,
      [employeeId, date, now.toISOString(), method, status, lateMinutes, userId],
    );
    if (!rows.length) {
      // Lost the race; fetch what's actually stored.
      const { rows: again } = await client.query(
        `SELECT * FROM attendance WHERE employee_id = $1 AND date = $2::date`,
        [employeeId, date],
      );
      return shapeAttendance({ ...again[0], employee_name: employee.name });
    }

    await logActivity({
      entityType: 'attendance',
      entityId: rows[0].id,
      action: 'attendance.checked_in',
      performedBy: userId,
      newValue: { status, lateMinutes, method },
      notes: `Auto check-in (${method})`,
    });

    if (io) {
      const payload = {
        employeeId,
        employeeName: employee.name,
        time: now.toISOString(),
        status,
        lateMinutes,
      };
      io.to('role:Manager').emit('attendance_checked_in', payload);
      io.to('role:Admin').emit('attendance_checked_in', payload);
    }

    return shapeAttendance({ ...rows[0], employee_name: employee.name });
  });
}

// Auto check-out fired by logout (method=app_logout), timeout (method=timeout),
// or manual close-of-day (method=manual / timeout). Updates the open record;
// silently skips if there's nothing to close.
async function checkOut({
  employeeId,
  method = 'app_logout',
  userId = null,
  io = null,
  at = null,
}) {
  if (!employeeId) return null;
  return withTransaction(async (client) => {
    const date = todayDateString();
    const { rows: empRows } = await client.query(
      `SELECT id, name, standard_hours FROM employees WHERE id = $1`,
      [employeeId],
    );
    if (!empRows.length) return null;
    const employee = empRows[0];

    const { rows: attRows } = await client.query(
      `SELECT * FROM attendance
        WHERE employee_id = $1 AND date = $2::date
        FOR UPDATE`,
      [employeeId, date],
    );
    if (!attRows.length) return null;
    const att = attRows[0];
    if (!att.check_in || att.check_out) {
      // No open session to close.
      return shapeAttendance({ ...att, employee_name: employee.name });
    }

    const checkOutAt = at ? new Date(at) : new Date();
    const workingMs = checkOutAt - new Date(att.check_in);
    const workingHours = money(Math.max(0, workingMs / (60 * 60 * 1000)));
    const standardHours = Number(employee.standard_hours || 8);
    const overtimeHours = money(Math.max(0, workingHours - standardHours));
    let shortageHours = 0;
    if (att.status !== 'leave' && att.status !== 'absent') {
      shortageHours = money(Math.max(0, standardHours - workingHours));
    }

    const { rows } = await client.query(
      `UPDATE attendance
          SET check_out = $1,
              check_out_method = $2,
              working_hours = $3,
              overtime_hours = $4,
              shortage_hours = $5,
              updated_by = $6,
              updated_at = NOW()
        WHERE id = $7
        RETURNING *`,
      [
        checkOutAt.toISOString(),
        method,
        workingHours,
        overtimeHours,
        shortageHours,
        userId,
        att.id,
      ],
    );

    await logActivity({
      entityType: 'attendance',
      entityId: att.id,
      action: 'attendance.checked_out',
      performedBy: userId,
      newValue: { workingHours, overtimeHours, method },
      notes: `Check-out (${method})`,
    });

    if (io) {
      const payload = {
        employeeId,
        employeeName: employee.name,
        time: checkOutAt.toISOString(),
        workingHours,
        overtimeHours,
        method,
      };
      io.to('role:Manager').emit('attendance_checked_out', payload);
      io.to('role:Admin').emit('attendance_checked_out', payload);
    }

    return shapeAttendance({ ...rows[0], employee_name: employee.name });
  });
}

// "Best effort" wrappers — used by the auth login/logout flows so a transient
// DB hiccup never blocks a sign-in. Errors are logged and swallowed.
async function checkInSafe(params) {
  try {
    return await checkIn(params);
  } catch (err) {
    console.warn('[attendanceService] checkIn failed:', err.code || err.message);
    return null;
  }
}
async function checkOutSafe(params) {
  try {
    return await checkOut(params);
  } catch (err) {
    console.warn('[attendanceService] checkOut failed:', err.code || err.message);
    return null;
  }
}

// =======================================================================
// Manual entry / update by a manager
// =======================================================================
async function upsertManualAttendance({
  employeeId,
  date,
  checkIn: ci,
  checkOut: co,
  status = 'present',
  notes = null,
  userId,
}) {
  if (!employeeId || !date) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'employeeId and date are required.');
  }
  return withTransaction(async (client) => {
    const { rows: empRows } = await client.query(
      `SELECT id, name, standard_hours, shift_start, late_threshold_mins
         FROM employees WHERE id = $1`,
      [employeeId],
    );
    if (!empRows.length) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, 'Employee not found.', {
        status: 404,
      });
    }
    const employee = empRows[0];

    let workingHours = null;
    let overtimeHours = 0;
    let shortageHours = 0;
    let lateMinutes = 0;
    if (ci) {
      const shiftStart = String(employee.shift_start || '09:00:00');
      const [hh, mm, ss] = shiftStart.split(':');
      const shiftDate = new Date(ci);
      shiftDate.setHours(Number(hh) || 0, Number(mm) || 0, Number(ss) || 0, 0);
      const diff = Math.round((new Date(ci) - shiftDate) / 60000);
      const threshold = employee.late_threshold_mins ?? 15;
      if (diff > threshold) lateMinutes = diff;
    }
    if (ci && co) {
      const ms = new Date(co) - new Date(ci);
      workingHours = money(Math.max(0, ms / (60 * 60 * 1000)));
      const std = Number(employee.standard_hours || 8);
      overtimeHours = money(Math.max(0, workingHours - std));
      if (status !== 'leave' && status !== 'absent') {
        shortageHours = money(Math.max(0, std - workingHours));
      }
    }

    const { rows } = await client.query(
      `INSERT INTO attendance
         (employee_id, date, check_in, check_out, check_in_method, check_out_method,
          status, working_hours, overtime_hours, late_minutes, shortage_hours,
          notes, created_by, updated_by)
       VALUES ($1,$2::date,$3,$4,'manual','manual',$5,$6,$7,$8,$9,$10,$11,$11)
       ON CONFLICT (employee_id, date) DO UPDATE
         SET check_in = EXCLUDED.check_in,
             check_out = EXCLUDED.check_out,
             check_in_method = COALESCE(EXCLUDED.check_in_method, attendance.check_in_method),
             check_out_method = COALESCE(EXCLUDED.check_out_method, attendance.check_out_method),
             status = EXCLUDED.status,
             working_hours = EXCLUDED.working_hours,
             overtime_hours = EXCLUDED.overtime_hours,
             late_minutes = EXCLUDED.late_minutes,
             shortage_hours = EXCLUDED.shortage_hours,
             notes = COALESCE(EXCLUDED.notes, attendance.notes),
             updated_by = EXCLUDED.updated_by,
             updated_at = NOW()
        RETURNING *`,
      [
        employeeId,
        dateOnly(date),
        ci || null,
        co || null,
        status,
        workingHours,
        overtimeHours,
        lateMinutes,
        shortageHours,
        notes,
        userId,
      ],
    );

    await logActivity({
      entityType: 'attendance',
      entityId: rows[0].id,
      action: 'attendance.manual_entry',
      performedBy: userId,
      newValue: { status, workingHours },
      notes,
    });
    return shapeAttendance({ ...rows[0], employee_name: employee.name });
  });
}

// =======================================================================
// Correction requests
// =======================================================================
async function submitCorrection({
  attendanceId,
  requestedBy,
  reason,
  requestNote,
  newCheckIn = null,
  newCheckOut = null,
  io = null,
}) {
  if (!requestNote || requestNote.trim().length < 5) {
    throw new AppError(
      ERROR_CODES.VALIDATION_FAILED,
      'A detailed note is required (at least 5 characters).',
    );
  }
  return withTransaction(async (client) => {
    const { rows: attRows } = await client.query(
      `SELECT a.*, e.name AS employee_name
         FROM attendance a
         LEFT JOIN employees e ON e.id = a.employee_id
        WHERE a.id = $1`,
      [attendanceId],
    );
    if (!attRows.length) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, { status: 404 });
    }
    const att = attRows[0];

    const recordDate = new Date(dateOnly(att.date));
    const today = new Date(todayDateString());
    const ageDays = Math.floor((today - recordDate) / (24 * 60 * 60 * 1000));
    if (ageDays > CORRECTION_WINDOW_DAYS) {
      throw new AppError(ERROR_CODES.BIZ_CORRECTION_TOO_OLD, undefined, {
        status: 409,
        details: { ageDays, windowDays: CORRECTION_WINDOW_DAYS },
      });
    }

    const { rows } = await client.query(
      `INSERT INTO attendance_corrections
         (attendance_id, requested_by, reason, request_note,
          old_check_in, old_check_out, new_check_in, new_check_out)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [
        attendanceId,
        requestedBy,
        reason,
        requestNote.trim(),
        att.check_in,
        att.check_out,
        newCheckIn || null,
        newCheckOut || null,
      ],
    );

    await logActivity({
      entityType: 'attendance_correction',
      entityId: rows[0].id,
      action: 'attendance.correction_requested',
      performedBy: requestedBy,
      newValue: { reason },
    });

    if (io) {
      const payload = {
        correctionId: rows[0].id,
        attendanceId,
        employeeId: att.employee_id,
        employeeName: att.employee_name,
        date: dateOnly(att.date),
        reason,
      };
      io.to('role:Manager').emit('correction_request_created', payload);
      io.to('role:Admin').emit('correction_request_created', payload);
    }

    return rows[0];
  });
}

async function reviewCorrection({
  correctionId,
  decision, // 'approved' | 'rejected'
  reviewerId,
  rejectionReason = null,
  io = null,
}) {
  return withTransaction(async (client) => {
    const { rows: corrRows } = await client.query(
      `SELECT c.*, a.employee_id, a.date AS attendance_date,
              e.name AS employee_name
         FROM attendance_corrections c
         JOIN attendance a ON a.id = c.attendance_id
         LEFT JOIN employees e ON e.id = a.employee_id
        WHERE c.id = $1 FOR UPDATE`,
      [correctionId],
    );
    if (!corrRows.length) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, { status: 404 });
    }
    const corr = corrRows[0];
    if (corr.status !== 'pending') {
      throw new AppError(
        ERROR_CODES.BIZ_INVALID_STATE,
        'This correction has already been reviewed.',
        { status: 409 },
      );
    }

    await client.query(
      `UPDATE attendance_corrections
          SET status = $1,
              reviewed_by = $2,
              reviewed_at = NOW(),
              rejection_reason = $3
        WHERE id = $4`,
      [decision, reviewerId, decision === 'rejected' ? rejectionReason : null, correctionId],
    );

    if (decision === 'approved') {
      await upsertManualAttendance({
        employeeId: corr.employee_id,
        date: dateOnly(corr.attendance_date),
        checkIn: corr.new_check_in,
        checkOut: corr.new_check_out,
        // Preserve the existing status — corrections only adjust the times.
        status:
          (
            await client.query(
              `SELECT status FROM attendance WHERE id = $1`,
              [corr.attendance_id],
            )
          ).rows[0]?.status || 'present',
        notes: `Corrected via request: ${corr.request_note}`,
        userId: reviewerId,
      });
    }

    await logActivity({
      entityType: 'attendance_correction',
      entityId: correctionId,
      action:
        decision === 'approved'
          ? 'attendance.correction_approved'
          : 'attendance.correction_rejected',
      performedBy: reviewerId,
      newValue: { decision },
      notes: rejectionReason,
    });

    if (io) {
      const payload = {
        correctionId,
        attendanceId: corr.attendance_id,
        employeeId: corr.employee_id,
        employeeName: corr.employee_name,
        status: decision,
        rejectionReason,
      };
      io.to('role:Manager').emit('correction_request_reviewed', payload);
      if (corr.requested_by) {
        io.to(`user:${corr.requested_by}`).emit('correction_request_reviewed', payload);
      }
    }

    return { ...corr, status: decision, rejection_reason: rejectionReason };
  });
}

// =======================================================================
// Daily sweep — mark absentees + auto-close still-checked-in records
// =======================================================================
async function markAbsentForDay({ date = null, io = null } = {}) {
  const day = date || todayDateString();
  if (isUaeWeekend(day)) {
    return { dryRun: true, reason: 'weekend', day, marked: 0 };
  }
  if (await isHoliday(null, day)) {
    return { dryRun: true, reason: 'holiday', day, marked: 0 };
  }

  return withTransaction(async (client) => {
    // Auto-close any record still open (no check-out) at end-of-day.
    const { rows: openRows } = await client.query(
      `SELECT a.id, a.employee_id, a.check_in, e.standard_hours
         FROM attendance a
         JOIN employees e ON e.id = a.employee_id
        WHERE a.date = $1::date
          AND a.check_in IS NOT NULL
          AND a.check_out IS NULL`,
      [day],
    );
    for (const r of openRows) {
      const standardHours = Number(r.standard_hours || 8);
      const ci = new Date(r.check_in);
      const endOfDay = new Date(`${day}T23:59:00`);
      const ms = endOfDay - ci;
      const workingHours = money(Math.max(0, ms / (60 * 60 * 1000)));
      const overtime = money(Math.max(0, workingHours - standardHours));
      const shortage = money(Math.max(0, standardHours - workingHours));
      await client.query(
        `UPDATE attendance
            SET check_out = $1,
                check_out_method = 'timeout',
                working_hours = $2,
                overtime_hours = $3,
                shortage_hours = $4,
                updated_at = NOW()
          WHERE id = $5`,
        [endOfDay.toISOString(), workingHours, overtime, shortage, r.id],
      );
    }

    // Mark absent: every active employee with NO attendance row today AND
    // no approved leave covering today.
    const { rows: absentRows } = await client.query(
      `INSERT INTO attendance (employee_id, date, status)
       SELECT e.id, $1::date, 'absent'
         FROM employees e
        WHERE e.is_active = true
          AND NOT EXISTS (
            SELECT 1 FROM attendance a
             WHERE a.employee_id = e.id AND a.date = $1::date
          )
          AND NOT EXISTS (
            SELECT 1 FROM leaves l
             WHERE l.employee_id = e.id
               AND l.status = 'approved'
               AND $1::date BETWEEN l.start_date AND l.end_date
          )
       ON CONFLICT (employee_id, date) DO NOTHING
       RETURNING employee_id`,
      [day],
    );

    if (absentRows.length) {
      await logActivity({
        entityType: 'attendance',
        entityId: null,
        action: 'attendance.marked_absent',
        performedBy: null,
        newValue: { date: day, count: absentRows.length },
        notes: `Batch marked ${absentRows.length} employees absent on ${day}.`,
      });
    }

    if (io) {
      io.to('role:Manager').emit('attendance_day_finalized', {
        date: day,
        markedAbsent: absentRows.length,
        autoClosed: openRows.length,
      });
      io.to('role:Admin').emit('attendance_day_finalized', {
        date: day,
        markedAbsent: absentRows.length,
        autoClosed: openRows.length,
      });
    }

    return {
      day,
      marked: absentRows.length,
      autoClosed: openRows.length,
    };
  });
}

// =======================================================================
// Reads
// =======================================================================

// Today's roster + per-status totals — fuels the Today tab and the dashboard
// quick-look counters.
async function getTodaySnapshot() {
  const day = todayDateString();
  const { rows } = await query(
    `SELECT e.id AS employee_id, e.name AS employee_name, e.role_title,
            e.shift_start, e.shift_end, e.standard_hours,
            a.id AS attendance_id,
            a.check_in, a.check_out, a.check_in_method, a.check_out_method,
            COALESCE(a.status,
              CASE WHEN EXISTS (
                SELECT 1 FROM leaves l
                 WHERE l.employee_id = e.id AND l.status = 'approved'
                   AND $1::date BETWEEN l.start_date AND l.end_date
              ) THEN 'leave' ELSE 'not_checked_in' END
            ) AS status,
            a.working_hours, a.overtime_hours, a.late_minutes, a.shortage_hours
       FROM employees e
       LEFT JOIN attendance a ON a.employee_id = e.id AND a.date = $1::date
      WHERE e.is_active = true
      ORDER BY e.name ASC`,
    [day],
  );

  const counters = {
    present: 0,
    late: 0,
    absent: 0,
    leave: 0,
    notCheckedIn: 0,
  };
  for (const r of rows) {
    if (r.status === 'present') counters.present += 1;
    else if (r.status === 'late') counters.late += 1;
    else if (r.status === 'absent') counters.absent += 1;
    else if (r.status === 'leave') counters.leave += 1;
    else counters.notCheckedIn += 1;
  }

  return {
    date: day,
    counters,
    employees: rows.map((r) => ({
      employeeId: r.employee_id,
      employeeName: r.employee_name,
      roleTitle: r.role_title,
      shiftStart: r.shift_start,
      shiftEnd: r.shift_end,
      standardHours: Number(r.standard_hours || 8),
      attendanceId: r.attendance_id,
      checkIn: r.check_in,
      checkOut: r.check_out,
      checkInMethod: r.check_in_method,
      checkOutMethod: r.check_out_method,
      status: r.status,
      workingHours: r.working_hours != null ? Number(r.working_hours) : null,
      overtimeHours: r.overtime_hours != null ? Number(r.overtime_hours) : 0,
      lateMinutes: r.late_minutes != null ? Number(r.late_minutes) : 0,
      shortageHours: r.shortage_hours != null ? Number(r.shortage_hours) : 0,
    })),
  };
}

// Monthly sheet: each row is an employee, each column is a day in the month.
async function getMonthlySheet({ month, year, employeeId = null }) {
  const start = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const end = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

  const empClause = employeeId ? `AND e.id = $3` : '';
  const params = employeeId ? [start, end, employeeId] : [start, end];

  const { rows: empRows } = await query(
    `SELECT id, name, role_title, standard_hours
       FROM employees
      WHERE is_active = true
      ${employeeId ? 'AND id = $1' : ''}
      ORDER BY name ASC`,
    employeeId ? [employeeId] : [],
  );

  const { rows: attRows } = await query(
    `SELECT a.* FROM attendance a
       JOIN employees e ON e.id = a.employee_id
      WHERE a.date BETWEEN $1::date AND $2::date
        ${empClause}
      ORDER BY a.date ASC`,
    params,
  );

  const { rows: holidayRows } = await query(
    `SELECT date, name, type FROM holidays
      WHERE date BETWEEN $1::date AND $2::date`,
    [start, end],
  );

  // Build a fast lookup by employee+day so the UI doesn't have to scan.
  const byEmployee = new Map();
  for (const e of empRows) {
    byEmployee.set(e.id, {
      employeeId: e.id,
      employeeName: e.name,
      roleTitle: e.role_title,
      standardHours: Number(e.standard_hours || 8),
      days: {},
      summary: {
        present: 0,
        late: 0,
        absent: 0,
        leave: 0,
        totalHours: 0,
        overtimeHours: 0,
        shortageHours: 0,
      },
    });
  }
  for (const a of attRows) {
    const bucket = byEmployee.get(a.employee_id);
    if (!bucket) continue;
    const day = Number(dateOnly(a.date).slice(8, 10));
    bucket.days[day] = shapeAttendance(a);
    if (a.status === 'present') bucket.summary.present += 1;
    else if (a.status === 'late') bucket.summary.late += 1;
    else if (a.status === 'absent') bucket.summary.absent += 1;
    else if (a.status === 'leave') bucket.summary.leave += 1;
    bucket.summary.totalHours = money(
      bucket.summary.totalHours + Number(a.working_hours || 0),
    );
    bucket.summary.overtimeHours = money(
      bucket.summary.overtimeHours + Number(a.overtime_hours || 0),
    );
    bucket.summary.shortageHours = money(
      bucket.summary.shortageHours + Number(a.shortage_hours || 0),
    );
  }

  return {
    month,
    year,
    daysInMonth: lastDay,
    holidays: holidayRows.map((h) => ({
      date: dateOnly(h.date),
      name: h.name,
      type: h.type,
    })),
    rows: [...byEmployee.values()],
  };
}

async function getEmployeeSummary({ employeeId, month, year }) {
  const sheet = await getMonthlySheet({ month, year, employeeId });
  return sheet.rows[0] || null;
}

async function listAttendance({
  employeeId = null,
  status = null,
  from = null,
  to = null,
  month = null,
  year = null,
  limit = 50,
  offset = 0,
}) {
  const parts = [];
  const params = [];
  let i = 1;
  if (employeeId) {
    parts.push(`a.employee_id = $${i++}`);
    params.push(employeeId);
  }
  if (status) {
    parts.push(`a.status = $${i++}`);
    params.push(status);
  }
  if (from) {
    parts.push(`a.date >= $${i++}::date`);
    params.push(from);
  }
  if (to) {
    parts.push(`a.date <= $${i++}::date`);
    params.push(to);
  }
  if (month && year) {
    parts.push(
      `a.date >= make_date($${i++}::int, $${i++}::int, 1)
       AND a.date < (make_date($${i - 2}::int, $${i - 1}::int, 1) + INTERVAL '1 month')`,
    );
    params.push(year, month);
  }
  const where = parts.length ? `WHERE ${parts.join(' AND ')}` : '';
  const { rows } = await query(
    `SELECT a.*, e.name AS employee_name, e.role_title
       FROM attendance a
       LEFT JOIN employees e ON e.id = a.employee_id
       ${where}
       ORDER BY a.date DESC, e.name ASC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset],
  );
  const { rows: tot } = await query(
    `SELECT COUNT(*)::int AS total FROM attendance a ${where}`,
    params,
  );
  return { rows: rows.map(shapeAttendance), total: tot[0].total };
}

async function listCorrections({ status = null, employeeId = null, limit = 50, offset = 0 }) {
  const parts = [];
  const params = [];
  let i = 1;
  if (status) {
    parts.push(`c.status = $${i++}`);
    params.push(status);
  }
  if (employeeId) {
    parts.push(`a.employee_id = $${i++}`);
    params.push(employeeId);
  }
  const where = parts.length ? `WHERE ${parts.join(' AND ')}` : '';
  const { rows } = await query(
    `SELECT c.*, a.employee_id, a.date AS attendance_date,
            e.name AS employee_name,
            ru.username AS requested_by_username,
            rv.username AS reviewed_by_username
       FROM attendance_corrections c
       JOIN attendance a ON a.id = c.attendance_id
       LEFT JOIN employees e ON e.id = a.employee_id
       LEFT JOIN users ru ON ru.id = c.requested_by
       LEFT JOIN users rv ON rv.id = c.reviewed_by
       ${where}
       ORDER BY c.created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset],
  );
  const { rows: tot } = await query(
    `SELECT COUNT(*)::int AS total
       FROM attendance_corrections c
       JOIN attendance a ON a.id = c.attendance_id ${where}`,
    params,
  );
  return {
    rows: rows.map((r) => ({
      id: r.id,
      attendanceId: r.attendance_id,
      employeeId: r.employee_id,
      employeeName: r.employee_name,
      attendanceDate: dateOnly(r.attendance_date),
      requestedBy: r.requested_by,
      requestedByUsername: r.requested_by_username,
      reason: r.reason,
      requestNote: r.request_note,
      oldCheckIn: r.old_check_in,
      oldCheckOut: r.old_check_out,
      newCheckIn: r.new_check_in,
      newCheckOut: r.new_check_out,
      status: r.status,
      reviewedBy: r.reviewed_by,
      reviewedByUsername: r.reviewed_by_username,
      reviewedAt: r.reviewed_at,
      rejectionReason: r.rejection_reason,
      createdAt: r.created_at,
    })),
    total: tot[0].total,
  };
}

// =======================================================================
// Helpers exported for the leave service
// =======================================================================
async function createLeaveAttendanceRecords(client, { employeeId, startDate, endDate, userId }) {
  // For each working day inside [startDate, endDate] not already covered
  // (and not a weekend / holiday — those don't consume the leave allotment
  // anyway) insert a status='leave' attendance row.
  const start = new Date(`${dateOnly(startDate)}T00:00:00`);
  const end = new Date(`${dateOnly(endDate)}T00:00:00`);
  const cursor = new Date(start);
  while (cursor <= end) {
    const day = cursor.toISOString().slice(0, 10);
    const weekend = UAE_WEEKEND.has(cursor.getDay());
    const holiday = await isHoliday(client, day);
    if (!weekend && !holiday) {
      await client.query(
        `INSERT INTO attendance (employee_id, date, status, created_by, updated_by)
         VALUES ($1, $2::date, 'leave', $3, $3)
         ON CONFLICT (employee_id, date) DO UPDATE
           SET status = 'leave',
               updated_by = $3,
               updated_at = NOW()`,
        [employeeId, day, userId || null],
      );
    }
    cursor.setDate(cursor.getDate() + 1);
  }
}

module.exports = {
  checkIn,
  checkOut,
  checkInSafe,
  checkOutSafe,
  upsertManualAttendance,
  submitCorrection,
  reviewCorrection,
  markAbsentForDay,
  getTodaySnapshot,
  getMonthlySheet,
  getEmployeeSummary,
  listAttendance,
  listCorrections,
  createLeaveAttendanceRecords,
  isUaeWeekend,
  isHoliday,
  shapeAttendance,
};
