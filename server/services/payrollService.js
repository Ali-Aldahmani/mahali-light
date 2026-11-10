const { query, withTransaction } = require('../db/postgres');
const { AppError, ERROR_CODES } = require('../../shared/errorCodes');
const { logActivity } = require('../utils/activityLog');
const { runOnce } = require('../utils/operations');
const { nextDocumentNumber } = require('../utils/docNumbers');
const { todayStoreDate, storeDate } = require('../utils/dates');
const journalService = require('./journalService');
const cashService = require('./cashService');
const bankService = require('./bankService');

// Payroll with accrual accounting (migration 063).
//
// Calculation per employee for a month:
//   base pay     monthly: base salary; daily: base x days worked;
//                hourly: base x hours worked
//   days worked  present + late + half of half days
//   absence      monthly staff only: (base / days in month) x (absent days +
//                unpaid leave days within the month)
//   overtime     overtime hours x hourly rate x the employee's multiplier;
//                hourly rate = base (hourly), base / standard hours (daily),
//                base / days in month / standard hours (monthly)
//   gross pay    base pay + monthly allowance + overtime - absence
//   net pay      gross - advance recovery - other deductions
//   employer     contribution rate % of base pay
// Approving accrues it in the month (see the migration for the entries);
// paying clears Salaries Payable; advances are receivables.

const money = (n) => {
  n = Number(n) || 0;
  return n < 0 ? -Math.round(-n * 100 + 1e-9) / 100 : Math.round(n * 100 + 1e-9) / 100;
};
const ACC = { wages: '5002', employer: '5018', payable: '2004', withheld: '2005', advances: '1006', cash: '1001', bank: '1002' };

function monthBounds(year, month) {
  const start = new Date(Date.UTC(year, month - 1, 1)).toISOString().slice(0, 10);
  const end = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  return { start, end, days: Number(end.slice(8)) };
}

function notFound(what) {
  return new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, `${what} not found.`, { status: 404 });
}

// ---------------------------------------------------------------- settings
function shapePay(e) {
  return {
    employeeId: e.id,
    name: e.name,
    roleTitle: e.role_title || null,
    isActive: e.is_active,
    salaryType: e.salary_type || 'monthly',
    baseSalary: Number(e.base_salary) || 0,
    monthlyAllowance: Number(e.monthly_allowance) || 0,
    employerContributionRate: Number(e.employer_contribution_rate) || 0,
    overtimeMultiplier: Number(e.overtime_multiplier) || 0,
    standardHours: Number(e.standard_hours) || 8,
    openAdvances: Number(e.open_advances) || 0,
  };
}

async function listPaySettings() {
  const { rows } = await query(
    `SELECT e.*, COALESCE((SELECT SUM(a.amount - a.recovered_amount) FROM employee_advances a
                            WHERE a.employee_id = e.id), 0)::float8 AS open_advances
       FROM employees e ORDER BY e.is_active DESC, e.name`,
  );
  return rows.map(shapePay);
}

const PAY_COLUMNS = {
  salaryType: 'salary_type',
  baseSalary: 'base_salary',
  monthlyAllowance: 'monthly_allowance',
  employerContributionRate: 'employer_contribution_rate',
  overtimeMultiplier: 'overtime_multiplier',
};

async function setPaySettings(employeeId, patch, { userId }) {
  return withTransaction(async (client) => {
    const { rows: [before] } = await client.query(`SELECT * FROM employees WHERE id = $1 FOR UPDATE`, [employeeId]);
    if (!before) throw notFound('Employee');
    const keys = Object.keys(PAY_COLUMNS).filter((k) => patch[k] !== undefined);
    if (!keys.length) return shapePay(before);
    const { rows: [after] } = await client.query(
      `UPDATE employees SET ${keys.map((k, i) => `${PAY_COLUMNS[k]} = $${i + 2}`).join(', ')}
        WHERE id = $1 RETURNING *`,
      [employeeId, ...keys.map((k) => patch[k])],
    );
    await logActivity({
      client, entityType: 'employee', entityId: employeeId, action: 'employee.pay_changed', performedBy: userId,
      oldValue: Object.fromEntries(keys.map((k) => [k, before[PAY_COLUMNS[k]]])),
      newValue: Object.fromEntries(keys.map((k) => [k, after[PAY_COLUMNS[k]]])),
    });
    return shapePay(after);
  });
}

// ------------------------------------------------------------- calculation
async function attendanceFor(client, { start, end }) {
  const { rows } = await client.query(
    `SELECT e.id, e.name, e.salary_type, e.base_salary, e.standard_hours, e.monthly_allowance,
            e.employer_contribution_rate, e.overtime_multiplier,
            COALESCE(a.days_worked, 0)::float8 AS days_worked, COALESCE(a.hours, 0)::float8 AS hours,
            COALESCE(a.overtime, 0)::float8 AS overtime, COALESCE(a.absent, 0)::float8 AS absent,
            COALESCE(l.unpaid, 0)::float8 AS unpaid,
            COALESCE((SELECT SUM(x.amount - x.recovered_amount) FROM employee_advances x
                       WHERE x.employee_id = e.id AND x.issued_date <= $2::date), 0)::float8 AS open_advances
       FROM employees e
       LEFT JOIN (
         SELECT employee_id,
                SUM(CASE WHEN status IN ('present', 'late') THEN 1 WHEN status = 'half_day' THEN 0.5 ELSE 0 END) AS days_worked,
                SUM(COALESCE(working_hours, 0)) AS hours,
                SUM(COALESCE(overtime_hours, 0)) AS overtime,
                SUM(CASE WHEN status = 'absent' THEN 1 ELSE 0 END) AS absent
           FROM attendance WHERE date BETWEEN $1::date AND $2::date GROUP BY employee_id
       ) a ON a.employee_id = e.id
       -- Unpaid leave counted only for the days inside the month.
       LEFT JOIN (
         SELECT employee_id,
                SUM(total_days * (LEAST(end_date, $2::date) - GREATEST(start_date, $1::date) + 1)::numeric
                    / NULLIF(end_date - start_date + 1, 0)) AS unpaid
           FROM leaves
          WHERE status = 'approved' AND leave_type = 'unpaid'
            AND start_date <= $2::date AND end_date >= $1::date
          GROUP BY employee_id
       ) l ON l.employee_id = e.id
      WHERE e.is_active = true AND (COALESCE(e.base_salary, 0) > 0 OR e.monthly_allowance > 0)
      ORDER BY e.name`,
    [start, end],
  );
  return rows;
}

function computeLine(emp, daysInMonth, overrides = {}) {
  const base = Number(emp.base_salary) || 0;
  const type = emp.salary_type || 'monthly';
  const std = Number(emp.standard_hours) || 8;
  const basePay = money(type === 'daily' ? base * emp.days_worked : type === 'hourly' ? base * emp.hours : base);
  const dayRate = base / daysInMonth;
  const absenceDays = type === 'monthly' ? Math.round((emp.absent + emp.unpaid) * 100) / 100 : 0;
  const absenceDeduction = money(Math.min(basePay, dayRate * absenceDays));
  const hourRate = type === 'hourly' ? base : type === 'daily' ? base / std : dayRate / std;
  const overtimePay = overrides.overtimePay != null
    ? money(overrides.overtimePay)
    : money(emp.overtime * hourRate * (Number(emp.overtime_multiplier) || 0));
  const allowances = money(overrides.allowances != null ? overrides.allowances : emp.monthly_allowance);
  const grossPay = money(Math.max(0, basePay + allowances + overtimePay - absenceDeduction));
  const otherDeductions = money(overrides.otherDeductions || 0);
  const maxRecovery = money(Math.max(0, Math.min(emp.open_advances, grossPay - otherDeductions)));
  const advanceRecovery = overrides.advanceRecovery != null ? money(overrides.advanceRecovery) : maxRecovery;
  if (advanceRecovery > maxRecovery + 0.001) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED,
      `Advance recovery for ${emp.name} can be at most ${maxRecovery.toFixed(2)}.`, { status: 400 });
  }
  const netPay = money(grossPay - advanceRecovery - otherDeductions);
  if (netPay < 0) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, `Deductions for ${emp.name} exceed the gross pay.`, { status: 400 });
  }
  return {
    basePay, allowances, overtimePay, absenceDeduction, grossPay, advanceRecovery, otherDeductions, netPay,
    absentDays: emp.absent, unpaidLeaveDays: Math.round(emp.unpaid * 100) / 100,
    employerContribution: money((basePay * (Number(emp.employer_contribution_rate) || 0)) / 100),
  };
}

async function refreshTotals(client, runId) {
  const { rows: [run] } = await client.query(
    `UPDATE payroll_runs r SET
        gross_total = t.gross, deductions_total = t.deductions, net_total = t.net,
        employer_contributions_total = t.employer, paid_total = t.paid, updated_at = NOW()
       FROM (SELECT COALESCE(SUM(gross_pay), 0) AS gross,
                    COALESCE(SUM(advance_recovery + other_deductions), 0) AS deductions,
                    COALESCE(SUM(net_pay), 0) AS net, COALESCE(SUM(employer_contribution), 0) AS employer,
                    COALESCE(SUM(paid_amount), 0) AS paid
               FROM payroll_lines WHERE run_id = $1) t
      WHERE r.id = $1 RETURNING r.*`,
    [runId],
  );
  return run;
}

// --------------------------------------------------------------------- runs
function shapeRun(r, lines = null) {
  const out = {
    id: r.id,
    runNumber: r.run_number,
    periodYear: r.period_year,
    periodMonth: r.period_month,
    periodStart: storeDate(r.period_start),
    periodEnd: storeDate(r.period_end),
    status: r.status,
    grossTotal: Number(r.gross_total),
    deductionsTotal: Number(r.deductions_total),
    netTotal: Number(r.net_total),
    employerContributionsTotal: Number(r.employer_contributions_total),
    paidTotal: Number(r.paid_total),
    outstanding: money(Number(r.net_total) - Number(r.paid_total)),
    accrualEntryId: r.accrual_entry_id,
    reversalEntryId: r.reversal_entry_id,
    notes: r.notes,
    createdAt: r.created_at,
    approvedAt: r.approved_at,
    voidedAt: r.voided_at,
    voidReason: r.void_reason,
  };
  if (lines) {
    out.lines = lines.map((l) => ({
      id: l.id,
      employeeId: l.employee_id,
      employeeName: l.employee_name,
      salaryType: l.salary_type,
      baseSalary: Number(l.base_salary),
      daysWorked: Number(l.days_worked),
      hoursWorked: Number(l.hours_worked),
      overtimeHours: Number(l.overtime_hours),
      absentDays: Number(l.absent_days),
      unpaidLeaveDays: Number(l.unpaid_leave_days),
      basePay: Number(l.base_pay),
      allowances: Number(l.allowances),
      overtimePay: Number(l.overtime_pay),
      absenceDeduction: Number(l.absence_deduction),
      grossPay: Number(l.gross_pay),
      advanceRecovery: Number(l.advance_recovery),
      otherDeductions: Number(l.other_deductions),
      netPay: Number(l.net_pay),
      employerContribution: Number(l.employer_contribution),
      paidAmount: Number(l.paid_amount),
      outstanding: money(Number(l.net_pay) - Number(l.paid_amount)),
      notes: l.notes,
    }));
  }
  return out;
}

async function lockRun(client, runId) {
  const { rows: [run] } = await client.query(`SELECT * FROM payroll_runs WHERE id = $1 FOR UPDATE`, [runId]);
  if (!run) throw notFound('Payroll run');
  return run;
}

async function loadRun(runId, client = null) {
  const exec = client || { query };
  const { rows: [run] } = await exec.query(`SELECT * FROM payroll_runs WHERE id = $1`, [runId]);
  if (!run) throw notFound('Payroll run');
  const { rows: lines } = await exec.query(`SELECT * FROM payroll_lines WHERE run_id = $1 ORDER BY employee_name`, [runId]);
  return shapeRun(run, lines);
}

async function listRuns() {
  const { rows } = await query(`SELECT * FROM payroll_runs ORDER BY period_year DESC, period_month DESC, created_at DESC`);
  return rows.map((r) => shapeRun(r));
}

/** A draft run for a month, calculated from pay settings and attendance. */
async function createRun({ year, month, notes = null }, { userId, requestKey = null }) {
  return withTransaction(async (client) => {
    const { result } = await runOnce(client, {
      scope: 'payroll_run_create', key: requestKey, payload: { year, month }, userId,
    }, async () => {
      const b = monthBounds(year, month);
      const { rows: live } = await client.query(
        `SELECT id FROM payroll_runs WHERE period_year = $1 AND period_month = $2 AND status <> 'voided' FOR UPDATE`,
        [year, month],
      );
      if (live.length) {
        throw new AppError(ERROR_CODES.BIZ_INVALID_STATE,
          'This month already has a payroll run. Void it before preparing another.', { status: 409 });
      }
      const { formatted } = await nextDocumentNumber(client, 'PAY', year, { padWidth: 4 });
      const { rows: [run] } = await client.query(
        `INSERT INTO payroll_runs (run_number, period_year, period_month, period_start, period_end, notes, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [formatted, year, month, b.start, b.end, notes, userId],
      );
      for (const emp of await attendanceFor(client, b)) {
        const c = computeLine(emp, b.days);
        await client.query(
          `INSERT INTO payroll_lines
             (run_id, employee_id, employee_name, salary_type, base_salary, days_worked, hours_worked,
              overtime_hours, absent_days, unpaid_leave_days, base_pay, allowances, overtime_pay,
              absence_deduction, gross_pay, advance_recovery, other_deductions, net_pay, employer_contribution)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
          [run.id, emp.id, emp.name, emp.salary_type || 'monthly', Number(emp.base_salary) || 0, emp.days_worked,
            emp.hours, emp.overtime, c.absentDays, c.unpaidLeaveDays, c.basePay, c.allowances, c.overtimePay,
            c.absenceDeduction, c.grossPay, c.advanceRecovery, c.otherDeductions, c.netPay, c.employerContribution],
        );
      }
      await refreshTotals(client, run.id);
      await logActivity({
        client, entityType: 'payroll_run', entityId: run.id, action: 'payroll.run_created', performedBy: userId,
        newValue: { runNumber: formatted, year, month },
      });
      return loadRun(run.id, client);
    });
    return result;
  });
}

/** Adjusts one line of a draft run: allowances, overtime, deductions, recovery. */
async function updateLine(runId, lineId, patch, { userId }) {
  return withTransaction(async (client) => {
    const run = await lockRun(client, runId);
    if (run.status !== 'draft') {
      throw new AppError(ERROR_CODES.BIZ_INVALID_STATE, 'Only a draft payroll run can be changed.', { status: 409 });
    }
    const { rows: [line] } = await client.query(`SELECT * FROM payroll_lines WHERE id = $1 AND run_id = $2 FOR UPDATE`, [lineId, runId]);
    if (!line) throw notFound('Payroll line');
    const b = monthBounds(run.period_year, run.period_month);
    const emp = (await attendanceFor(client, b)).find((e) => e.id === line.employee_id) || {
      id: line.employee_id, name: line.employee_name, salary_type: line.salary_type, base_salary: line.base_salary,
      standard_hours: 8, monthly_allowance: line.allowances, employer_contribution_rate: 0, overtime_multiplier: 0,
      days_worked: Number(line.days_worked), hours: Number(line.hours_worked), overtime: Number(line.overtime_hours),
      absent: Number(line.absent_days), unpaid: Number(line.unpaid_leave_days), open_advances: 0,
    };
    const c = computeLine(emp, b.days, {
      allowances: patch.allowances ?? Number(line.allowances),
      overtimePay: patch.overtimePay ?? Number(line.overtime_pay),
      otherDeductions: patch.otherDeductions ?? Number(line.other_deductions),
      advanceRecovery: patch.advanceRecovery ?? Number(line.advance_recovery),
    });
    await client.query(
      `UPDATE payroll_lines SET allowances = $2, overtime_pay = $3, gross_pay = $4, advance_recovery = $5,
              other_deductions = $6, net_pay = $7, notes = COALESCE($8, notes)
        WHERE id = $1`,
      [lineId, c.allowances, c.overtimePay, c.grossPay, c.advanceRecovery, c.otherDeductions, c.netPay, patch.notes ?? null],
    );
    await refreshTotals(client, runId);
    await logActivity({
      client, entityType: 'payroll_run', entityId: runId, action: 'payroll.line_adjusted', performedBy: userId,
      oldValue: { employee: line.employee_name, allowances: line.allowances, overtimePay: line.overtime_pay,
        otherDeductions: line.other_deductions, advanceRecovery: line.advance_recovery },
      newValue: { employee: line.employee_name, ...patch },
    });
    return loadRun(runId, client);
  });
}

async function deleteDraft(runId, { userId }) {
  return withTransaction(async (client) => {
    const run = await lockRun(client, runId);
    if (run.status !== 'draft') {
      throw new AppError(ERROR_CODES.BIZ_INVALID_STATE, 'Only a draft payroll run can be deleted; void an approved one.', { status: 409 });
    }
    await client.query(`DELETE FROM payroll_runs WHERE id = $1`, [runId]);
    await logActivity({ client, entityType: 'payroll_run', entityId: runId, action: 'payroll.draft_deleted', performedBy: userId,
      oldValue: { runNumber: run.run_number } });
    return { deleted: true };
  });
}

/**
 * Approves a draft run: the month's salaries are accrued, dated the last day
 * of the month, and advances it recovers are taken off oldest first.
 */
async function approveRun(runId, { userId }) {
  return withTransaction(async (client) => {
    const run = await lockRun(client, runId);
    if (run.status !== 'draft') {
      throw new AppError(ERROR_CODES.BIZ_INVALID_STATE, 'This payroll run is not a draft.', { status: 409 });
    }
    const { rows: lines } = await client.query(`SELECT * FROM payroll_lines WHERE run_id = $1 FOR UPDATE`, [runId]);
    if (!lines.length) {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'This payroll run has no employees to pay.', { status: 400 });
    }
    const sum = (k) => money(lines.reduce((s, l) => s + Number(l[k]), 0));
    const gross = sum('gross_pay');
    const employer = sum('employer_contribution');
    const net = sum('net_pay');
    const recovered = sum('advance_recovery');
    const withheld = money(sum('other_deductions') + employer);
    const account = (code) => journalService.getAccountIdByCode(code, client);
    const linesOut = [
      { accountId: await account(ACC.wages), debit: gross, credit: 0 },
      { accountId: await account(ACC.employer), debit: employer, credit: 0 },
      { accountId: await account(ACC.payable), debit: 0, credit: net },
      { accountId: await account(ACC.advances), debit: 0, credit: recovered },
      { accountId: await account(ACC.withheld), debit: 0, credit: withheld },
    ].filter((l) => l.debit > 0 || l.credit > 0);
    const date = storeDate(run.period_end);
    await journalService.ensurePeriodsForDate(date, client);
    const posted = await journalService.postJournalEntryWith(client, {
      referenceType: 'payroll_run', referenceId: runId, date,
      description: `Payroll ${run.run_number} accrued for ${String(run.period_month).padStart(2, '0')}/${run.period_year}`,
      lines: linesOut, userId,
    });
    // Advances recovered, oldest first.
    for (const l of lines) {
      let left = money(l.advance_recovery);
      if (left <= 0) continue;
      const { rows: advances } = await client.query(
        `SELECT id, amount, recovered_amount FROM employee_advances
          WHERE employee_id = $1 AND recovered_amount < amount ORDER BY issued_date, created_at FOR UPDATE`,
        [l.employee_id],
      );
      for (const a of advances) {
        if (left <= 0) break;
        const take = money(Math.min(left, Number(a.amount) - Number(a.recovered_amount)));
        await client.query(`UPDATE employee_advances SET recovered_amount = recovered_amount + $2 WHERE id = $1`, [a.id, take]);
        await client.query(`INSERT INTO payroll_advance_recoveries (line_id, advance_id, amount) VALUES ($1, $2, $3)`, [l.id, a.id, take]);
        left = money(left - take);
      }
      if (left > 0.001) {
        throw new AppError(ERROR_CODES.VALIDATION_FAILED,
          `${l.employee_name} no longer has ${Number(l.advance_recovery).toFixed(2)} of advances to recover.`, { status: 409 });
      }
    }
    await client.query(
      `UPDATE payroll_runs SET status = 'approved', approved_by = $2, approved_at = NOW(), accrual_entry_id = $3, updated_at = NOW()
        WHERE id = $1`,
      [runId, userId, posted?.entry?.id || null],
    );
    await logActivity({
      client, entityType: 'payroll_run', entityId: runId, action: 'payroll.approved', performedBy: userId,
      newValue: { runNumber: run.run_number, gross, net, employer, recovered, withheld },
    });
    return loadRun(runId, client);
  });
}

/**
 * Pays net salaries of an approved run: every line with something
 * outstanding, or just `lineIds`. Clears Salaries Payable; no expense.
 */
async function payRun(runId, { lineIds = null, method, bankAccountId = null, paidDate = null, allowOverdraft = false },
  { userId, requestKey = null }) {
  if (!['cash', 'bank'].includes(method)) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'Pay salaries in cash or by bank.', { status: 400 });
  }
  if (method === 'bank' && !bankAccountId) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'Choose the bank account salaries are paid from.', { status: 400 });
  }
  return withTransaction(async (client) => {
    const { result } = await runOnce(client, {
      scope: 'payroll_payment', key: requestKey, payload: { runId, lineIds, method, bankAccountId, paidDate }, userId,
    }, async () => {
      const run = await lockRun(client, runId);
      if (!['approved', 'partially_paid'].includes(run.status)) {
        throw new AppError(ERROR_CODES.BIZ_INVALID_STATE, 'Only an approved payroll run can be paid.', { status: 409 });
      }
      const { rows: lines } = await client.query(
        `SELECT * FROM payroll_lines WHERE run_id = $1 AND net_pay > paid_amount
            AND ($2::uuid[] IS NULL OR id = ANY($2)) ORDER BY employee_name FOR UPDATE`,
        [runId, lineIds && lineIds.length ? lineIds : null],
      );
      if (!lines.length) {
        throw new AppError(ERROR_CODES.BIZ_INVALID_STATE, 'Nothing is left to pay on these lines.', { status: 409 });
      }
      const date = paidDate || todayStoreDate();
      const payable = await journalService.getAccountIdByCode(ACC.payable, client);
      const money_ = await journalService.getAccountIdByCode(method === 'cash' ? ACC.cash : ACC.bank, client);
      const paid = [];
      for (const l of lines) {
        const amount = money(Number(l.net_pay) - Number(l.paid_amount));
        const { rows: [p] } = await client.query(
          `INSERT INTO payroll_payments (run_id, line_id, amount, method, bank_account_id, paid_date, paid_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
          [runId, l.id, amount, method, method === 'bank' ? bankAccountId : null, date, userId],
        );
        const entry = await journalService.postJournalEntryWith(client, {
          referenceType: 'payroll_payment', referenceId: p.id, date,
          description: `Salary paid to ${l.employee_name} (${run.run_number})`,
          lines: [{ accountId: payable, debit: amount, credit: 0 }, { accountId: money_, debit: 0, credit: amount }],
          userId,
        });
        await client.query(`UPDATE payroll_payments SET journal_entry_id = $2 WHERE id = $1`, [p.id, entry?.entry?.id || null]);
        if (method === 'cash') {
          await cashService.recordCashOut({
            client, allowAutoOpen: false, transactionType: 'expense', amount,
            referenceType: 'payroll_payment', referenceId: p.id, employeeId: userId,
            notes: `Salary: ${l.employee_name} (${run.run_number})`,
          });
        } else {
          await bankService.recordBankOut({
            client, bankAccountId, transactionType: 'expense', amount,
            referenceType: 'payroll_payment', referenceId: p.id, employeeId: userId,
            description: `Salary: ${l.employee_name} (${run.run_number})`, allowOverdraft,
          });
        }
        await client.query(`UPDATE payroll_lines SET paid_amount = paid_amount + $2 WHERE id = $1`, [l.id, amount]);
        paid.push({ lineId: l.id, employee: l.employee_name, amount });
      }
      const totals = await refreshTotals(client, runId);
      const status = money(Number(totals.paid_total)) >= money(Number(totals.net_total)) ? 'paid' : 'partially_paid';
      await client.query(`UPDATE payroll_runs SET status = $2 WHERE id = $1`, [runId, status]);
      await logActivity({
        client, entityType: 'payroll_run', entityId: runId, action: 'payroll.paid', performedBy: userId,
        newValue: { method, paidDate: date, payments: paid },
      });
      return loadRun(runId, client);
    });
    return result;
  });
}

/**
 * Voids a run. A draft is just marked void; an approved run with no salary
 * paid gets its accrual reversed (dated today) and its advance recoveries put
 * back. A run with payments can't be voided: correct it in the next run.
 */
async function voidRun(runId, { reason, userId }) {
  if (!reason || String(reason).trim().length < 5) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'Say why the payroll run is voided.', { status: 400 });
  }
  return withTransaction(async (client) => {
    const run = await lockRun(client, runId);
    if (run.status === 'voided') {
      throw new AppError(ERROR_CODES.BIZ_INVALID_STATE, 'This payroll run is already void.', { status: 409 });
    }
    if (Number(run.paid_total) > 0) {
      throw new AppError(ERROR_CODES.BIZ_INVALID_STATE,
        'Salaries on this run were paid; correct it with an adjustment in the next run instead.', { status: 409 });
    }
    let reversalId = null;
    if (run.status === 'approved' && run.accrual_entry_id) {
      const rev = await journalService.reverseJournalEntryWith(client, run.accrual_entry_id, {
        description: `Reversal of payroll ${run.run_number}: ${String(reason).trim()}`.slice(0, 250),
        date: todayStoreDate(), userId,
      });
      reversalId = rev?.entry?.id || null;
      const { rows: recoveries } = await client.query(
        `SELECT r.advance_id, r.amount FROM payroll_advance_recoveries r
           JOIN payroll_lines l ON l.id = r.line_id WHERE l.run_id = $1`,
        [runId],
      );
      for (const r of recoveries) {
        await client.query(`UPDATE employee_advances SET recovered_amount = recovered_amount - $2 WHERE id = $1`, [r.advance_id, r.amount]);
      }
      await client.query(
        `DELETE FROM payroll_advance_recoveries WHERE line_id IN (SELECT id FROM payroll_lines WHERE run_id = $1)`, [runId],
      );
    }
    await client.query(
      `UPDATE payroll_runs SET status = 'voided', voided_by = $2, voided_at = NOW(), void_reason = $3,
              reversal_entry_id = $4, updated_at = NOW() WHERE id = $1`,
      [runId, userId, String(reason).trim(), reversalId],
    );
    await logActivity({
      client, entityType: 'payroll_run', entityId: runId, action: 'payroll.voided', performedBy: userId,
      newValue: { runNumber: run.run_number, reason: String(reason).trim(), reversed: Boolean(reversalId) },
    });
    return loadRun(runId, client);
  });
}

// ----------------------------------------------------------------- advances
async function listAdvances() {
  const { rows } = await query(
    `SELECT a.*, e.name AS employee_name FROM employee_advances a JOIN employees e ON e.id = a.employee_id
      ORDER BY a.issued_date DESC, a.created_at DESC`,
  );
  return rows.map((a) => ({
    id: a.id, employeeId: a.employee_id, employeeName: a.employee_name, amount: Number(a.amount),
    recovered: Number(a.recovered_amount), outstanding: money(Number(a.amount) - Number(a.recovered_amount)),
    issuedDate: storeDate(a.issued_date), method: a.method, notes: a.notes,
  }));
}

/** An advance to an employee: a receivable, not an expense. */
async function issueAdvance({ employeeId, amount, method, bankAccountId = null, issuedDate = null, notes = null, allowOverdraft = false },
  { userId, requestKey = null }) {
  const amt = money(amount);
  if (!(amt > 0)) throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'The advance must be more than zero.', { status: 400 });
  if (!['cash', 'bank'].includes(method)) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'Pay the advance in cash or by bank.', { status: 400 });
  }
  if (method === 'bank' && !bankAccountId) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'Choose the bank account the advance is paid from.', { status: 400 });
  }
  return withTransaction(async (client) => {
    const { result } = await runOnce(client, {
      scope: 'employee_advance', key: requestKey, payload: { employeeId, amt, method, bankAccountId, issuedDate }, userId,
    }, async () => {
      const { rows: [emp] } = await client.query(`SELECT id, name FROM employees WHERE id = $1`, [employeeId]);
      if (!emp) throw notFound('Employee');
      const date = issuedDate || todayStoreDate();
      const { rows: [a] } = await client.query(
        `INSERT INTO employee_advances (employee_id, amount, issued_date, method, bank_account_id, notes, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [employeeId, amt, date, method, method === 'bank' ? bankAccountId : null, notes, userId],
      );
      const entry = await journalService.postJournalEntryWith(client, {
        referenceType: 'employee_advance', referenceId: a.id, date,
        description: `Salary advance to ${emp.name}`,
        lines: [
          { accountId: await journalService.getAccountIdByCode(ACC.advances, client), debit: amt, credit: 0 },
          { accountId: await journalService.getAccountIdByCode(method === 'cash' ? ACC.cash : ACC.bank, client), debit: 0, credit: amt },
        ],
        userId,
      });
      await client.query(`UPDATE employee_advances SET journal_entry_id = $2 WHERE id = $1`, [a.id, entry?.entry?.id || null]);
      if (method === 'cash') {
        await cashService.recordCashOut({
          client, allowAutoOpen: false, transactionType: 'expense', amount: amt,
          referenceType: 'employee_advance', referenceId: a.id, employeeId: userId, notes: `Advance: ${emp.name}`,
        });
      } else {
        await bankService.recordBankOut({
          client, bankAccountId, transactionType: 'expense', amount: amt,
          referenceType: 'employee_advance', referenceId: a.id, employeeId: userId,
          description: `Advance: ${emp.name}`, allowOverdraft,
        });
      }
      await logActivity({
        client, entityType: 'employee', entityId: employeeId, action: 'payroll.advance_issued', performedBy: userId,
        newValue: { advanceId: a.id, amount: amt, method, date },
      });
      return { id: a.id, employeeId, employeeName: emp.name, amount: amt, recovered: 0, outstanding: amt, issuedDate: date, method };
    });
    return result;
  });
}

module.exports = {
  listPaySettings, setPaySettings, listRuns, loadRun, createRun, updateLine, deleteDraft,
  approveRun, payRun, voidRun, listAdvances, issueAdvance, computeLine, monthBounds,
};
