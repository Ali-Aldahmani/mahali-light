import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Pencil } from 'lucide-react';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Button from '../../components/ui/Button.jsx';
import Input from '../../components/ui/Input.jsx';
import Select from '../../components/ui/Select.jsx';
import SlideOver from '../../components/ui/SlideOver.jsx';
import ConfirmDialog from '../../components/ui/ConfirmDialog.jsx';
import LeaveBalanceBar from '../../components/ui/LeaveBalanceBar.jsx';
import {
  carryOverYear,
  listAllBalances,
  updateEmployeeBalances,
} from '../../services/leaveBalanceService.js';
import { useAuthStore } from '../../store/authStore.js';
import { toast } from '../../store/toastStore.js';

function yearOptions() {
  const now = new Date().getFullYear();
  const arr = [];
  for (let y = now - 2; y <= now + 1; y += 1) arr.push({ value: y, label: String(y) });
  return arr;
}

function EditEntitlementsSlideOver({ open, onClose, row, year, onSaved }) {
  const [annual, setAnnual] = useState(0);
  const [sick, setSick] = useState(0);
  const [carried, setCarried] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || !row) return;
    setAnnual(row.balances?.annual?.entitledDays ?? 30);
    setSick(row.balances?.sick?.entitledDays ?? 15);
    setCarried(row.balances?.annual?.carriedOverDays ?? 0);
  }, [open, row]);

  async function save() {
    setBusy(true);
    try {
      await updateEmployeeBalances(row.employeeId, year, {
        annual: { entitledDays: Number(annual), carriedOverDays: Number(carried) },
        sick: { entitledDays: Number(sick) },
      });
      toast.success('Entitlements updated.');
      onSaved?.();
      onClose();
    } catch (err) {
      toast.error(err.message || 'Failed to update.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SlideOver
      open={open}
      onClose={onClose}
      title="Edit entitlements"
      subtitle={row?.employeeName}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={save} loading={busy}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input
          label="Annual entitlement (days)"
          type="number"
          min={0}
          max={60}
          value={annual}
          onChange={(e) => setAnnual(e.target.value)}
        />
        <Input
          label="Sick entitlement (days)"
          type="number"
          min={0}
          max={60}
          value={sick}
          onChange={(e) => setSick(e.target.value)}
        />
        <Input
          label="Annual carry-over (days)"
          type="number"
          min={0}
          max={30}
          value={carried}
          onChange={(e) => setCarried(e.target.value)}
          hint="Carried from the previous year (max 15)."
        />
      </div>
    </SlideOver>
  );
}

function balanceCell(b) {
  if (!b) return <span className="text-ink-muted">—</span>;
  const remaining = b.remainingDays ?? Math.max(0, (b.entitledDays || 0) + (b.carriedOverDays || 0) - (b.usedDays || 0));
  return (
    <div className="text-sm">
      <p className="font-semibold tabular-nums">
        {remaining}
        <span className="ml-1 font-normal text-ink-muted">
          / {(b.entitledDays || 0) + (b.carriedOverDays || 0)}
        </span>
      </p>
      <LeaveBalanceBar
        used={b.usedDays || 0}
        total={b.entitledDays || 0}
        carriedOver={b.carriedOverDays || 0}
        size="sm"
        showLabel={false}
        className="mt-1"
      />
    </div>
  );
}

export default function LeaveBalancesPage() {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canEdit = hasPermission('attendance.mark_manual');

  const [year, setYear] = useState(new Date().getFullYear());
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState({});
  const [editing, setEditing] = useState(null);
  const [confirmCarry, setConfirmCarry] = useState(false);
  const [carryBusy, setCarryBusy] = useState(false);

  async function refresh() {
    setLoading(true);
    try {
      const res = await listAllBalances(year);
      setRows(res?.rows || []);
    } catch (err) {
      toast.error(err.message || 'Failed to load balances.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year]);

  async function carryOver() {
    setCarryBusy(true);
    try {
      const result = await carryOverYear(year, year + 1);
      toast.success(`Carried over for ${result.count} employee(s).`);
      setConfirmCarry(false);
      refresh();
    } catch (err) {
      toast.error(err.message || 'Failed to carry over.');
    } finally {
      setCarryBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Leave balances"
        subtitle="Manage employee leave entitlements and run year-end carry-over."
        action={
          <div className="flex items-end gap-3">
            <Select
              label="Year"
              value={year}
              onChange={setYear}
              options={yearOptions()}
              searchable={false}
              containerClassName="w-28"
            />
            {canEdit && (
              <Button variant="secondary" onClick={() => setConfirmCarry(true)}>
                Carry over to {year + 1}
              </Button>
            )}
          </div>
        }
      />

      {loading ? (
        <div className="rounded-card border border-border bg-surface p-8 text-center text-sm text-ink-muted">
          Loading balances…
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-card border border-border bg-surface p-8 text-center text-sm text-ink-muted">
          No active employees.
        </div>
      ) : (
        <div className="overflow-hidden rounded-card border border-border bg-surface shadow-card">
          <table className="min-w-full text-sm">
            <thead className="bg-surface-2">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-ink-muted"></th>
                <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-ink-muted">
                  Employee
                </th>
                <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-ink-muted">
                  Annual
                </th>
                <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-ink-muted">
                  Sick
                </th>
                <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-ink-muted">
                  Unpaid
                </th>
                <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-ink-muted">
                  Emergency
                </th>
                <th className="px-4 py-2 text-right text-xs font-semibold uppercase tracking-wider text-ink-muted">
                  {canEdit ? 'Edit' : ''}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const isOpen = Boolean(expanded[row.employeeId]);
                return (
                  <FragmentRow
                    key={row.employeeId}
                    row={row}
                    isOpen={isOpen}
                    onToggle={() =>
                      setExpanded((cur) => ({ ...cur, [row.employeeId]: !isOpen }))
                    }
                    canEdit={canEdit}
                    onEdit={() => setEditing(row)}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <EditEntitlementsSlideOver
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        row={editing}
        year={year}
        onSaved={refresh}
      />

      <ConfirmDialog
        open={confirmCarry}
        onClose={() => setConfirmCarry(false)}
        onConfirm={carryOver}
        title={`Carry over to ${year + 1}?`}
        description={`Unused annual days will move to ${year + 1} (max 15 days per employee).`}
        confirmLabel="Carry over"
        loading={carryBusy}
      />
    </div>
  );
}

function FragmentRow({ row, isOpen, onToggle, canEdit, onEdit }) {
  return (
    <>
      <tr className="border-t border-border align-top">
        <td className="px-4 py-3">
          <button
            type="button"
            onClick={onToggle}
            className="inline-flex h-6 w-6 items-center justify-center rounded-md text-ink-muted hover:bg-surface-2"
          >
            {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        </td>
        <td className="px-4 py-3">
          <p className="font-medium">{row.employeeName}</p>
          {row.roleTitle && <p className="text-xs text-ink-muted">{row.roleTitle}</p>}
        </td>
        <td className="min-w-[180px] px-4 py-3">{balanceCell(row.balances?.annual)}</td>
        <td className="min-w-[180px] px-4 py-3">{balanceCell(row.balances?.sick)}</td>
        <td className="px-4 py-3 text-ink-muted">
          {row.balances?.unpaid?.usedDays || 0} used
        </td>
        <td className="px-4 py-3 text-ink-muted">
          {row.balances?.emergency?.usedDays || 0} used
        </td>
        <td className="px-4 py-3 text-right">
          {canEdit && (
            <Button variant="ghost" size="sm" onClick={onEdit}>
              <Pencil className="mr-1 h-3.5 w-3.5" />
              Edit
            </Button>
          )}
        </td>
      </tr>
      {isOpen && (
        <tr className="border-t border-border bg-surface-2">
          <td colSpan={7} className="px-4 py-3">
            <div className="grid grid-cols-2 gap-4 text-xs md:grid-cols-4">
              {['annual', 'sick', 'unpaid', 'emergency'].map((t) => {
                const b = row.balances?.[t];
                if (!b) return null;
                return (
                  <div key={t} className="rounded-input bg-surface p-3">
                    <p className="mb-1 text-xs font-medium capitalize text-ink-muted">
                      {t}
                    </p>
                    <div className="space-y-0.5">
                      <Stat label="Entitled" value={b.entitledDays} />
                      <Stat label="Used" value={b.usedDays} />
                      <Stat label="Remaining" value={b.remainingDays} />
                      <Stat label="Carried over" value={b.carriedOverDays} />
                    </div>
                  </div>
                );
              })}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function Stat({ label, value }) {
  return (
    <div className="flex justify-between">
      <span className="text-ink-muted">{label}</span>
      <span className="font-medium tabular-nums">{value ?? 0}</span>
    </div>
  );
}
