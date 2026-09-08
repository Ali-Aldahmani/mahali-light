'use client';

import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import Select from '@/components/ui/Select';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import MonthlyCalendarTable from '@/components/ui/MonthlyCalendarTable';
import AttendanceStatusBadge from '@/components/ui/AttendanceStatusBadge';
import { getMonthlySheet } from '@/services/attendanceService';
import { listEmployees } from '@/services/employeeService';
import { toast } from '@/store/toastStore';

interface EmployeeOption {
  id: string;
  name: string;
}

interface MonthlyRow {
  employeeName: string;
  roleTitle?: string;
  days?: Record<number, { status?: string }>;
  summary?: {
    present?: number;
    late?: number;
    absent?: number;
    leave?: number;
    totalHours?: number;
    overtimeHours?: number;
    shortageHours?: number;
  };
}

interface MonthlySheet {
  daysInMonth: number;
  holidays?: unknown[];
  rows: MonthlyRow[];
}

interface OpenCell {
  row?: { employeeName?: string };
  day?: { dateStr?: string; isHoliday?: boolean };
  record?: {
    status: string;
    lateMinutes?: number;
    checkIn?: string;
    checkOut?: string;
    workingHours?: number;
    overtimeHours?: number;
    shortageHours?: number;
    notes?: string;
  } | null;
}

const MONTHS = [
  { value: 1, label: 'January' },
  { value: 2, label: 'February' },
  { value: 3, label: 'March' },
  { value: 4, label: 'April' },
  { value: 5, label: 'May' },
  { value: 6, label: 'June' },
  { value: 7, label: 'July' },
  { value: 8, label: 'August' },
  { value: 9, label: 'September' },
  { value: 10, label: 'October' },
  { value: 11, label: 'November' },
  { value: 12, label: 'December' },
];

function yearOptions() {
  const current = new Date().getFullYear();
  const arr = [];
  for (let y = current - 2; y <= current + 1; y += 1) {
    arr.push({ value: y, label: String(y) });
  }
  return arr;
}

function fmtTime(input?: string | null) {
  return input
    ? new Date(input).toLocaleTimeString('en-AE', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      })
    : '—';
}

// Build a CSV export of the monthly sheet. Phase 14 will produce real
// xlsx — until then a CSV gives managers something they can open in Excel.
function exportCsv({
  month,
  year,
  daysInMonth,
  rows,
}: {
  month: number;
  year: number;
  daysInMonth: number;
  rows: MonthlyRow[];
}) {
  const header = ['Employee', 'Role'];
  for (let d = 1; d <= daysInMonth; d += 1) header.push(String(d));
  header.push('P', 'L', 'A', 'LE', 'Total hrs', 'OT hrs', 'Short hrs');

  const lines = [header.join(',')];
  for (const row of rows) {
    const cells: (string | number)[] = [
      JSON.stringify(row.employeeName),
      JSON.stringify(row.roleTitle || ''),
    ];
    for (let d = 1; d <= daysInMonth; d += 1) {
      const rec = row.days?.[d];
      cells.push(rec?.status?.[0]?.toUpperCase() || '');
    }
    cells.push(
      row.summary?.present || 0,
      row.summary?.late || 0,
      row.summary?.absent || 0,
      row.summary?.leave || 0,
      (row.summary?.totalHours || 0).toFixed(1),
      (row.summary?.overtimeHours || 0).toFixed(1),
      (row.summary?.shortageHours || 0).toFixed(1),
    );
    lines.push(cells.join(','));
  }

  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `attendance-${year}-${String(month).padStart(2, '0')}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

export default function MonthlyTab() {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [data, setData] = useState<MonthlySheet | null>(null);
  const [loading, setLoading] = useState(false);
  const [openCell, setOpenCell] = useState<OpenCell | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await listEmployees({ limit: 200, isActive: true });
        setEmployees(res?.data || []);
      } catch (_e) {
        setEmployees([]);
      }
    })();
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const sheet = await getMonthlySheet({ month, year, employeeId });
        if (!cancelled) setData(sheet);
      } catch (err: any) {
        toast.error(err.message || 'Failed to load monthly sheet.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [month, year, employeeId]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Select
          label="Month"
          value={month}
          onChange={setMonth}
          options={MONTHS}
          searchable={false}
          containerClassName="w-44"
        />
        <Select
          label="Year"
          value={year}
          onChange={setYear}
          options={yearOptions()}
          searchable={false}
          containerClassName="w-32"
        />
        <Select
          label="Employee"
          value={employeeId}
          onChange={setEmployeeId}
          options={[
            { value: null, label: 'All employees' },
            ...employees.map((e) => ({ value: e.id, label: e.name })),
          ]}
          containerClassName="w-64"
        />
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              data &&
              exportCsv({ month, year, daysInMonth: data.daysInMonth, rows: data.rows })
            }
            disabled={!data || !data.rows?.length}
          >
            <Download className="mr-1.5 h-4 w-4" />
            Export CSV
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="rounded-card border border-border bg-surface p-8 text-center text-sm text-ink-muted">
          Loading sheet…
        </div>
      ) : (
        <MonthlyCalendarTable
          month={month}
          year={year}
          daysInMonth={data?.daysInMonth || 31}
          holidays={data?.holidays || []}
          rows={data?.rows || []}
          onCellClick={(cell: OpenCell) => setOpenCell(cell)}
        />
      )}

      <Modal
        open={Boolean(openCell)}
        onClose={() => setOpenCell(null)}
        title={`${openCell?.row?.employeeName || ''} — ${openCell?.day?.dateStr || ''}`}
        size="sm"
      >
        {openCell?.record ? (
          <div className="space-y-3 text-sm">
            <div className="flex items-center justify-between rounded-input bg-surface-2 p-3">
              <span className="text-ink-muted">Status</span>
              <AttendanceStatusBadge
                status={openCell.record.status}
                lateMinutes={openCell.record.lateMinutes}
                size="md"
              />
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-input bg-surface-2 p-3">
                <p className="text-xs text-ink-muted">Check-in</p>
                <p className="tabular-nums">{fmtTime(openCell.record.checkIn)}</p>
              </div>
              <div className="rounded-input bg-surface-2 p-3">
                <p className="text-xs text-ink-muted">Check-out</p>
                <p className="tabular-nums">{fmtTime(openCell.record.checkOut)}</p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div>
                <p className="text-xs text-ink-muted">Worked</p>
                <p className="tabular-nums">
                  {(openCell.record.workingHours || 0).toFixed(2)} h
                </p>
              </div>
              <div>
                <p className="text-xs text-ink-muted">Overtime</p>
                <p className="tabular-nums">
                  {(openCell.record.overtimeHours || 0).toFixed(2)} h
                </p>
              </div>
              <div>
                <p className="text-xs text-ink-muted">Shortage</p>
                <p className="tabular-nums">
                  {(openCell.record.shortageHours || 0).toFixed(2)} h
                </p>
              </div>
            </div>
            {openCell.record.notes && (
              <div className="rounded-input border border-border p-3 text-xs text-ink-muted">
                {openCell.record.notes}
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-ink-muted">
            {openCell?.day?.isHoliday
              ? 'Public holiday — no record expected.'
              : 'No attendance record for this day.'}
          </p>
        )}
      </Modal>
    </div>
  );
}
