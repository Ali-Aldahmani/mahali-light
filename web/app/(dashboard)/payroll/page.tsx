'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import PageHeader from '@/components/ui/PageHeader';
import Tabs from '@/components/ui/Tabs';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import RequirePermission from '@/components/guards/RequirePermission';
import { BankAccountSelect } from '@/components/payments/BankTenderFields';
import { useAuthStore } from '@/store/authStore';
import { toast } from '@/store/toastStore';
import { formatCurrency, formatDate } from '@/lib/utils/format';
import { cn } from '@/lib/utils/cn';
import {
  approvePayrollRun, createPayrollRun, deletePayrollDraft, getPayrollRun, issueAdvance, listAdvances,
  listPayrollRuns, listPaySettings, payPayrollRun, setPaySettings, updatePayrollLine, voidPayrollRun,
} from '@/services/payrollService';

const newKey = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
const money = (v: any) => formatCurrency(Number(v) || 0);
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const STATUS_TONE: Record<string, string> = {
  draft: 'bg-surface-2 text-ink-muted', approved: 'bg-amber-100 text-amber-700',
  partially_paid: 'bg-amber-100 text-amber-700', paid: 'bg-success-light text-success', voided: 'bg-error-light text-error',
};
const TH = 'px-3 py-2 text-left text-xs font-semibold text-ink-muted whitespace-nowrap';
const THR = `${TH} text-right`;
const TD = 'px-3 py-2 align-top';
const TDR = `${TD} text-right whitespace-nowrap`;

function Status({ status }: { status: string }) {
  return <span className={cn('rounded-full px-2 py-0.5 text-xs capitalize', STATUS_TONE[status])}>{status.replace('_', ' ')}</span>;
}

// ------------------------------------------------------------------- runs
function RunsTab() {
  const can = useAuthStore((s) => s.hasPermission);
  const [runs, setRuns] = useState<any[]>([]);
  const [open, setOpen] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const now = new Date();
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const [year, setYear] = useState(String(prev.getFullYear()));
  const [month, setMonth] = useState(String(prev.getMonth() + 1));
  const [method, setMethod] = useState('bank');
  const [bankAccountId, setBankAccountId] = useState<string | null>(null);
  const createKey = useRef(newKey());
  const payKey = useRef(newKey());

  const load = useCallback(() => { listPayrollRuns().then((r: any) => setRuns(r || [])).catch(() => {}); }, []);
  useEffect(() => { load(); }, [load]);
  const openRun = (id: string) => getPayrollRun(id).then(setOpen).catch((e: any) => toast.error(e?.message || 'Could not open the run.'));

  async function act(fn: () => Promise<any>, done: string) {
    setBusy(true);
    try {
      const r = await fn();
      if (r?.id) setOpen(r);
      toast.success(done);
      load();
    } catch (e: any) {
      toast.error(e?.message || 'That did not work.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {can('payroll.manage') && (
        <div className="flex flex-wrap items-end gap-2 rounded-card border border-border bg-surface p-3">
          <Select label="Month" value={month} onChange={(v: any) => setMonth(v)} options={MONTHS.map((m, i) => ({ value: String(i + 1), label: m }))} className="min-w-[140px]" />
          <Input label="Year" type="number" value={year} onChange={(e: any) => setYear(e.target.value)} className="w-24" />
          <Button loading={busy} onClick={() => act(async () => {
            const r = await createPayrollRun({ year: Number(year), month: Number(month) }, createKey.current);
            createKey.current = newKey();
            return r;
          }, 'Payroll prepared from attendance.')}>Prepare payroll</Button>
          <p className="basis-full text-xs text-ink-muted">
            Salaries are accrued as an expense and a liability when the run is approved, dated the last day of the month. Paying clears the liability.
          </p>
        </div>
      )}

      <div className="overflow-x-auto rounded-card border border-border bg-surface">
        <table className="w-full text-sm">
          <thead className="bg-surface-2"><tr>
            <th className={TH}>Run</th><th className={TH}>Month</th><th className={TH}>Status</th>
            <th className={THR}>Gross</th><th className={THR}>Net pay</th><th className={THR}>Paid</th><th className={THR}>Owed</th><th className={TH} />
          </tr></thead>
          <tbody>
            {runs.length === 0 && <tr><td colSpan={8} className="px-3 py-6 text-center text-ink-muted">No payroll runs yet.</td></tr>}
            {runs.map((r) => (
              <tr key={r.id} className="border-t border-border">
                <td className={`${TD} font-mono`}>{r.runNumber}</td>
                <td className={TD}>{MONTHS[r.periodMonth - 1]} {r.periodYear}</td>
                <td className={TD}><Status status={r.status} /></td>
                <td className={TDR}>{money(r.grossTotal)}</td>
                <td className={TDR}>{money(r.netTotal)}</td>
                <td className={TDR}>{money(r.paidTotal)}</td>
                <td className={TDR}>{money(r.outstanding)}</td>
                <td className={TDR}><Button size="sm" variant="secondary" onClick={() => openRun(r.id)}>Open</Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {open && (
        <div className="space-y-3 rounded-card border border-border bg-surface p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="font-semibold text-ink">
              {open.runNumber} · {MONTHS[open.periodMonth - 1]} {open.periodYear} <Status status={open.status} />
            </div>
            <div className="flex flex-wrap gap-2">
              {open.status === 'draft' && can('payroll.approve') && (
                <Button loading={busy} onClick={() => act(() => approvePayrollRun(open.id), 'Payroll approved and accrued.')}>Approve and accrue</Button>
              )}
              {open.status === 'draft' && can('payroll.manage') && (
                <Button variant="secondary" disabled={busy} onClick={() => act(async () => { await deletePayrollDraft(open.id); setOpen(null); return null; }, 'Draft deleted.')}>Delete draft</Button>
              )}
              {['draft', 'approved'].includes(open.status) && open.paidTotal === 0 && can('payroll.approve') && (
                <Button variant="secondary" disabled={busy} onClick={() => {
                  const reason = window.prompt('Why is this payroll run voided?');
                  if (reason && reason.trim().length >= 5) act(() => voidPayrollRun(open.id, reason.trim()), 'Payroll voided.');
                }}>Void</Button>
              )}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-2"><tr>
                <th className={TH}>Employee</th><th className={THR}>Days</th><th className={THR}>Base</th>
                <th className={THR}>Allowances</th><th className={THR}>Overtime</th><th className={THR}>Absence</th>
                <th className={THR}>Gross</th><th className={THR}>Advance</th><th className={THR}>Other ded.</th>
                <th className={THR}>Net</th><th className={THR}>Employer</th><th className={THR}>Paid</th>
              </tr></thead>
              <tbody>
                {open.lines.map((l: any) => (
                  <tr key={l.id} className="border-t border-border">
                    <td className={TD}>{l.employeeName}<div className="text-xs capitalize text-ink-muted">{l.salaryType}</div></td>
                    <td className={TDR}>{l.daysWorked}{l.absentDays + l.unpaidLeaveDays > 0 && <div className="text-xs text-ink-muted">{l.absentDays} absent · {l.unpaidLeaveDays} unpaid</div>}</td>
                    <td className={TDR}>{money(l.basePay)}</td>
                    <EditableCell run={open} line={l} field="allowances" onSaved={setOpen} />
                    <EditableCell run={open} line={l} field="overtimePay" onSaved={setOpen} />
                    <td className={TDR}>{l.absenceDeduction ? `−${money(l.absenceDeduction)}` : '—'}</td>
                    <td className={`${TDR} font-medium`}>{money(l.grossPay)}</td>
                    <EditableCell run={open} line={l} field="advanceRecovery" onSaved={setOpen} />
                    <EditableCell run={open} line={l} field="otherDeductions" onSaved={setOpen} />
                    <td className={`${TDR} font-semibold`}>{money(l.netPay)}</td>
                    <td className={TDR}>{money(l.employerContribution)}</td>
                    <td className={TDR}>{money(l.paidAmount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr className="border-t border-border font-semibold">
                <td className={TD}>Total</td><td className={TD} colSpan={5} /><td className={TDR}>{money(open.grossTotal)}</td>
                <td className={TD} colSpan={2} /><td className={TDR}>{money(open.netTotal)}</td>
                <td className={TDR}>{money(open.employerContributionsTotal)}</td><td className={TDR}>{money(open.paidTotal)}</td>
              </tr></tfoot>
            </table>
          </div>

          {['approved', 'partially_paid'].includes(open.status) && can('payroll.pay') && (
            <div className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
              <Select label="Pay by" value={method} onChange={(v: any) => setMethod(v)} options={[{ value: 'bank', label: 'Bank transfer' }, { value: 'cash', label: 'Cash' }]} className="min-w-[160px]" />
              {method === 'bank' && <div className="min-w-[220px]"><BankAccountSelect value={bankAccountId} onChange={setBankAccountId} /></div>}
              <Button loading={busy} onClick={() => act(async () => {
                const r = await payPayrollRun(open.id, { method, bankAccountId: method === 'bank' ? bankAccountId : null }, payKey.current);
                payKey.current = newKey();
                return r;
              }, 'Salaries paid.')}>Pay {money(open.outstanding)} owed</Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function EditableCell({ run, line, field, onSaved }: { run: any; line: any; field: string; onSaved: (r: any) => void }) {
  const can = useAuthStore((s) => s.hasPermission);
  const editable = run.status === 'draft' && can('payroll.manage');
  const [value, setValue] = useState(String(line[field] ?? 0));
  useEffect(() => setValue(String(line[field] ?? 0)), [line, field]);
  if (!editable) return <td className={TDR}>{Number(line[field]) ? money(line[field]) : '—'}</td>;
  return (
    <td className={TDR}>
      <input
        type="number" min={0} step="0.01" value={value} aria-label={`${field} for ${line.employeeName}`}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => {
          if (Number(value) === Number(line[field])) return;
          updatePayrollLine(run.id, line.id, { [field]: Number(value) || 0 })
            .then(onSaved)
            .catch((e: any) => { toast.error(e?.message || 'Could not change the line.'); setValue(String(line[field])); });
        }}
        className="h-8 w-24 rounded-input border border-border px-2 text-right text-sm"
      />
    </td>
  );
}

// ------------------------------------------------------------ pay settings
function PaySettingsTab() {
  const can = useAuthStore((s) => s.hasPermission);
  const [rows, setRows] = useState<any[]>([]);
  const load = useCallback(() => { listPaySettings().then((r: any) => setRows(r || [])).catch(() => {}); }, []);
  useEffect(() => { load(); }, [load]);
  const save = (r: any, patch: any) => setPaySettings(r.employeeId, patch)
    .then(() => { toast.success(`Pay updated for ${r.name}.`); load(); })
    .catch((e: any) => toast.error(e?.message || 'Could not save.'));
  return (
    <div className="overflow-x-auto rounded-card border border-border bg-surface">
      <table className="w-full text-sm">
        <thead className="bg-surface-2"><tr>
          <th className={TH}>Employee</th><th className={TH}>Pay type</th><th className={THR}>Base salary / rate</th>
          <th className={THR}>Monthly allowance</th><th className={THR}>Employer contribution %</th><th className={THR}>Overtime ×</th><th className={THR}>Open advances</th>
        </tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.employeeId} className={cn('border-t border-border', !r.isActive && 'opacity-60')}>
              <td className={TD}>{r.name}{r.roleTitle && <div className="text-xs text-ink-muted">{r.roleTitle}</div>}</td>
              <td className={TD}>
                {can('payroll.manage') ? (
                  <select aria-label={`Pay type for ${r.name}`} value={r.salaryType} onChange={(e) => save(r, { salaryType: e.target.value })}
                    className="h-8 rounded-input border border-border px-2 text-sm">
                    <option value="monthly">Monthly</option><option value="daily">Daily</option><option value="hourly">Hourly</option>
                  </select>
                ) : <span className="capitalize">{r.salaryType}</span>}
              </td>
              {(['baseSalary', 'monthlyAllowance', 'employerContributionRate', 'overtimeMultiplier'] as const).map((f) => (
                <td key={f} className={TDR}>
                  {can('payroll.manage') ? (
                    <input type="number" min={0} step="0.01" defaultValue={r[f]} aria-label={`${f} for ${r.name}`}
                      onBlur={(e) => { if (Number(e.target.value) !== Number(r[f])) save(r, { [f]: Number(e.target.value) || 0 }); }}
                      className="h-8 w-28 rounded-input border border-border px-2 text-right text-sm" />
                  ) : f.endsWith('Rate') || f === 'overtimeMultiplier' ? r[f] : money(r[f])}
                </td>
              ))}
              <td className={TDR}>{money(r.openAdvances)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------- advances
function AdvancesTab() {
  const can = useAuthStore((s) => s.hasPermission);
  const [rows, setRows] = useState<any[]>([]);
  const [employees, setEmployees] = useState<any[]>([]);
  const [form, setForm] = useState<any>({ employeeId: '', amount: '', method: 'bank', bankAccountId: null, notes: '' });
  const [busy, setBusy] = useState(false);
  const k = useRef(newKey());
  const load = useCallback(() => {
    listAdvances().then((r: any) => setRows(r || [])).catch(() => {});
    listPaySettings().then((r: any) => setEmployees((r || []).filter((e: any) => e.isActive))).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);
  async function submit() {
    setBusy(true);
    try {
      await issueAdvance({ ...form, amount: Number(form.amount), bankAccountId: form.method === 'bank' ? form.bankAccountId : null }, k.current);
      k.current = newKey();
      toast.success('Advance paid. It is recovered through payroll.');
      setForm({ ...form, amount: '', notes: '' });
      load();
    } catch (e: any) {
      toast.error(e?.message || 'Could not pay the advance.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-4">
      {can('payroll.pay') && (
        <div className="flex flex-wrap items-end gap-2 rounded-card border border-border bg-surface p-3">
          <Select label="Employee" value={form.employeeId} onChange={(v: any) => setForm({ ...form, employeeId: v })}
            options={employees.map((e) => ({ value: e.employeeId, label: e.name }))} className="min-w-[200px]" />
          <Input label="Amount (AED)" type="number" min="0" step="0.01" value={form.amount} onChange={(e: any) => setForm({ ...form, amount: e.target.value })} className="w-32" />
          <Select label="Paid by" value={form.method} onChange={(v: any) => setForm({ ...form, method: v })}
            options={[{ value: 'bank', label: 'Bank transfer' }, { value: 'cash', label: 'Cash' }]} className="min-w-[150px]" />
          {form.method === 'bank' && <div className="min-w-[220px]"><BankAccountSelect value={form.bankAccountId} onChange={(id) => setForm((f: any) => ({ ...f, bankAccountId: id }))} /></div>}
          <Button loading={busy} disabled={!form.employeeId || !(Number(form.amount) > 0)} onClick={submit}>Pay advance</Button>
          <p className="basis-full text-xs text-ink-muted">An advance is money the employee owes back, not an expense. Payroll recovers it from their pay.</p>
        </div>
      )}
      <div className="overflow-x-auto rounded-card border border-border bg-surface">
        <table className="w-full text-sm">
          <thead className="bg-surface-2"><tr>
            <th className={TH}>Date</th><th className={TH}>Employee</th><th className={THR}>Amount</th><th className={THR}>Recovered</th><th className={THR}>Outstanding</th>
          </tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-ink-muted">No advances.</td></tr>}
            {rows.map((a) => (
              <tr key={a.id} className="border-t border-border">
                <td className={TD}>{formatDate(a.issuedDate)}</td><td className={TD}>{a.employeeName}</td>
                <td className={TDR}>{money(a.amount)}</td><td className={TDR}>{money(a.recovered)}</td><td className={`${TDR} font-medium`}>{money(a.outstanding)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function PayrollPage() {
  const [tab, setTab] = useState('runs');
  return (
    <RequirePermission permission="payroll.view">
      <div className="space-y-4">
        <PageHeader title="Payroll" subtitle="Salaries from attendance, accrued in their month, paid against the liability." />
        <Tabs
          items={[{ value: 'runs', label: 'Payroll runs' }, { value: 'pay', label: 'Pay settings' }, { value: 'advances', label: 'Advances' }]}
          value={tab}
          onChange={setTab}
        />
        {tab === 'runs' && <RunsTab />}
        {tab === 'pay' && <PaySettingsTab />}
        {tab === 'advances' && <AdvancesTab />}
      </div>
    </RequirePermission>
  );
}
