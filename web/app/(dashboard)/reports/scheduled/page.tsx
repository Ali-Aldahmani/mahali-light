'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Plus, Play, Trash2, Pencil } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import Button from '@/components/ui/Button';
import Table from '@/components/ui/Table';
import Badge from '@/components/ui/Badge';
import SlideOver from '@/components/ui/SlideOver';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Spinner from '@/components/ui/Spinner';
import EmptyState from '@/components/ui/EmptyState';
import RequirePermission from '@/components/guards/RequirePermission';
import {
  REPORT_CATEGORIES,
  listSchedules,
  createSchedule,
  updateSchedule,
  deleteSchedule,
  runScheduleNow,
} from '@/services/reportService';
import { listEmployees } from '@/services/employeeService';
import { toast } from '@/store/toastStore';

const FREQUENCIES = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
];
const FORMATS = [
  { value: 'pdf', label: 'PDF' },
  { value: 'csv', label: 'CSV' },
  { value: 'excel', label: 'Excel' },
];
const WEEKDAYS = [
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
  { value: 7, label: 'Sunday' },
];

function fmtDateTime(value: string | null | undefined) {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const REPORT_OPTIONS = REPORT_CATEGORIES.flatMap((cat: any) =>
  cat.reports.map((r: any) => ({ value: r.type, label: `${cat.title} · ${r.label}` })),
);

function ScheduledReportsPageInner() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<any>(null); // null | { ... } (or "new")
  const [employees, setEmployees] = useState<any[]>([]);

  async function refresh() {
    try {
      setLoading(true);
      const list = await listSchedules();
      setItems(list);
    } catch (err: any) {
      toast.error(err.message || 'Failed to load schedules.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    listEmployees({ limit: 100, isActive: true })
      .then((res: any) => {
        const list = Array.isArray(res) ? res : res?.data || [];
        setEmployees(list.filter((e: any) => e.email));
      })
      .catch(() => setEmployees([]));
  }, []);

  async function toggleActive(item: any) {
    try {
      await updateSchedule(item.id, { is_active: !item.is_active });
      toast.success('Schedule updated.');
      refresh();
    } catch (err: any) {
      toast.error(err.message || 'Update failed.');
    }
  }

  async function runNow(item: any) {
    try {
      await runScheduleNow(item.id);
      toast.success('Report generated.');
      refresh();
    } catch (err: any) {
      toast.error(err.message || 'Run failed.');
    }
  }

  async function remove(item: any) {
    if (!window.confirm(`Delete schedule for "${item.report_type}"?`)) return;
    try {
      await deleteSchedule(item.id);
      toast.success('Schedule removed.');
      refresh();
    } catch (err: any) {
      toast.error(err.message || 'Delete failed.');
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Scheduled Reports"
        subtitle="Auto-deliver reports on a recurring schedule."
        action={
          <div className="flex gap-2">
            <Link href="/reports">
              <Button variant="secondary" leftIcon={<ArrowLeft size={16} />}>
                Reports
              </Button>
            </Link>
            <Button leftIcon={<Plus size={16} />} onClick={() => setEditing('new')}>
              Schedule Report
            </Button>
          </div>
        }
      />

      {loading ? (
        <div className="card border border-border p-12 flex items-center justify-center">
          <Spinner size="md" className="text-accent" />
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          title="No scheduled reports yet"
          description="Set up automated PDF/CSV/Excel delivery on a daily, weekly, or monthly cadence."
          action={
            <Button leftIcon={<Plus size={16} />} onClick={() => setEditing('new')}>
              Schedule Report
            </Button>
          }
        />
      ) : (
        <Table
          columns={[
            { key: 'report_type', header: 'Report' },
            { key: 'frequency', header: 'Frequency' },
            { key: 'send_time', header: 'Time' },
            {
              key: 'recipients',
              header: 'Recipients',
              render: (r: any) => `${r.recipients?.length || 0} recipient(s)`,
            },
            { key: 'format', header: 'Format', render: (r: any) => r.format?.toUpperCase() },
            {
              key: 'last_sent_at',
              header: 'Last Sent',
              render: (r: any) => fmtDateTime(r.last_sent_at),
            },
            {
              key: 'last_status',
              header: 'Status',
              render: (r: any) =>
                r.last_status ? (
                  <Badge tone={r.last_status === 'success' ? 'success' : 'error'} dot>
                    {r.last_status}
                  </Badge>
                ) : (
                  <Badge tone="muted">never</Badge>
                ),
            },
            {
              key: 'is_active',
              header: 'Active',
              render: (r: any) => (
                <button
                  type="button"
                  onClick={() => toggleActive(r)}
                  className={
                    'h-5 w-9 rounded-full transition relative ' +
                    (r.is_active ? 'bg-success' : 'bg-surface-2 border border-border')
                  }
                  aria-label="Toggle active"
                >
                  <span
                    className={
                      'absolute top-0.5 h-4 w-4 rounded-full bg-white transition ' +
                      (r.is_active ? 'left-4' : 'left-0.5')
                    }
                  />
                </button>
              ),
            },
            {
              key: 'actions',
              header: '',
              sortable: false,
              render: (r: any) => (
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" leftIcon={<Play size={14} />} onClick={() => runNow(r)}>
                    Run
                  </Button>
                  <Button size="sm" variant="ghost" leftIcon={<Pencil size={14} />} onClick={() => setEditing(r)}>
                    Edit
                  </Button>
                  <Button size="sm" variant="ghost" leftIcon={<Trash2 size={14} />} onClick={() => remove(r)}>
                    Delete
                  </Button>
                </div>
              ),
            },
          ]}
          rows={items}
          rowKey={(r: any) => r.id}
        />
      )}

      <ScheduleEditor
        open={Boolean(editing)}
        schedule={editing === 'new' ? null : editing}
        employees={employees}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          refresh();
        }}
      />
    </div>
  );
}

function ScheduleEditor({
  open,
  schedule,
  employees,
  onClose,
  onSaved,
}: {
  open: boolean;
  schedule: any;
  employees: any[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<any>(() => initial(schedule));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setForm(initial(schedule));
  }, [open, schedule]);

  function set(patch: any) {
    setForm((cur: any) => ({ ...cur, ...patch }));
  }

  async function save() {
    try {
      setSaving(true);
      const payload = {
        report_type: form.report_type,
        frequency: form.frequency,
        send_time: form.send_time,
        day_of_week: form.frequency === 'weekly' ? Number(form.day_of_week) || 1 : null,
        day_of_month: form.frequency === 'monthly' ? Number(form.day_of_month) || 1 : null,
        recipients: form.recipientIds
          .map((id: any) => employees.find((e) => e.id === id))
          .filter(Boolean)
          .map((e: any) => ({ employee_id: e.id, name: e.name, email: e.email })),
        format: form.format,
        filters: {},
        is_active: form.is_active,
      };
      if (!payload.recipients.length) {
        toast.error('Pick at least one recipient with an email.');
        return;
      }
      if (schedule?.id) {
        await updateSchedule(schedule.id, payload);
        toast.success('Schedule updated.');
      } else {
        await createSchedule(payload);
        toast.success('Schedule created.');
      }
      onSaved();
    } catch (err: any) {
      toast.error(err.message || 'Save failed.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <SlideOver
      open={open}
      onClose={onClose}
      title={schedule?.id ? 'Edit Schedule' : 'New Scheduled Report'}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} loading={saving}>
            Save Schedule
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <div>
          <label className="text-sm font-medium text-ink">Report</label>
          <Select
            value={form.report_type}
            onChange={(v: any) => set({ report_type: v })}
            options={REPORT_OPTIONS}
            placeholder="Select report…"
            className="mt-1"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-sm font-medium text-ink">Frequency</label>
            <Select
              value={form.frequency}
              onChange={(v: any) => set({ frequency: v })}
              options={FREQUENCIES}
              searchable={false}
              className="mt-1"
            />
          </div>
          <div>
            <label className="text-sm font-medium text-ink">Send Time</label>
            <Input
              type="time"
              value={form.send_time}
              onChange={(e: any) => set({ send_time: e.target.value })}
              className="mt-1"
            />
          </div>
        </div>

        {form.frequency === 'weekly' && (
          <div>
            <label className="text-sm font-medium text-ink">Day of Week</label>
            <Select
              value={form.day_of_week}
              onChange={(v: any) => set({ day_of_week: v })}
              options={WEEKDAYS}
              searchable={false}
              className="mt-1"
            />
          </div>
        )}

        {form.frequency === 'monthly' && (
          <div>
            <label className="text-sm font-medium text-ink">Day of Month (1–28)</label>
            <Input
              type="number"
              min={1}
              max={28}
              value={form.day_of_month}
              onChange={(e: any) => set({ day_of_month: Number(e.target.value) })}
              className="mt-1"
            />
          </div>
        )}

        <div>
          <label className="text-sm font-medium text-ink">Format</label>
          <Select
            value={form.format}
            onChange={(v: any) => set({ format: v })}
            options={FORMATS}
            searchable={false}
            className="mt-1"
          />
        </div>

        <div>
          <label className="text-sm font-medium text-ink">Recipients</label>
          <p className="text-xs text-ink-muted mt-0.5">
            Only employees with an email on file are listed.
          </p>
          {employees.length === 0 ? (
            <p className="text-sm text-ink-muted py-2">
              No employees with email available.
            </p>
          ) : (
            <div className="mt-2 max-h-56 overflow-y-auto border border-border rounded-card divide-y divide-border">
              {employees.map((emp) => (
                <label key={emp.id} className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-surface-2">
                  <input
                    type="checkbox"
                    checked={form.recipientIds.includes(emp.id)}
                    onChange={(e) => {
                      const next = e.target.checked
                        ? [...form.recipientIds, emp.id]
                        : form.recipientIds.filter((id: any) => id !== emp.id);
                      set({ recipientIds: next });
                    }}
                  />
                  <span className="text-sm flex-1">{emp.name}</span>
                  <span className="text-xs text-ink-muted">{emp.email}</span>
                </label>
              ))}
            </div>
          )}
        </div>

        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={form.is_active}
            onChange={(e) => set({ is_active: e.target.checked })}
          />
          <span className="text-sm">Active</span>
        </label>
      </div>
    </SlideOver>
  );
}

function initial(schedule: any) {
  if (!schedule) {
    return {
      report_type: 'sales_summary',
      frequency: 'monthly',
      send_time: '08:00',
      day_of_week: 1,
      day_of_month: 1,
      format: 'pdf',
      recipientIds: [],
      is_active: true,
    };
  }
  return {
    report_type: schedule.report_type,
    frequency: schedule.frequency,
    send_time: (schedule.send_time || '08:00').slice(0, 5),
    day_of_week: schedule.day_of_week || 1,
    day_of_month: schedule.day_of_month || 1,
    format: schedule.format,
    recipientIds: (schedule.recipients || []).map((r: any) => r.employee_id).filter(Boolean),
    is_active: schedule.is_active,
  };
}

export default function ScheduledReportsPage() {
  return (
    <RequirePermission permission="report.schedule">
      <ScheduledReportsPageInner />
    </RequirePermission>
  );
}
