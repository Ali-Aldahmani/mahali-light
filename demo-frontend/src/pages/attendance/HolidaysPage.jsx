import { useEffect, useState } from 'react';
import { Trash2, Plus, CalendarDays, List } from 'lucide-react';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Button from '../../components/ui/Button.jsx';
import Select from '../../components/ui/Select.jsx';
import Badge from '../../components/ui/Badge.jsx';
import SlideOver from '../../components/ui/SlideOver.jsx';
import Input from '../../components/ui/Input.jsx';
import ConfirmDialog from '../../components/ui/ConfirmDialog.jsx';
import {
  addHoliday,
  listHolidays,
  removeHoliday,
} from '../../services/holidayService.js';
import { useAuthStore } from '../../store/authStore.js';
import { toast } from '../../store/toastStore.js';
import { cn } from '../../utils/cn.js';

function yearOptions() {
  const now = new Date().getFullYear();
  const arr = [];
  for (let y = now - 1; y <= now + 2; y += 1) arr.push({ value: y, label: String(y) });
  return arr;
}

function fmtDate(input) {
  return new Date(`${input}T00:00:00`).toLocaleDateString('en-AE', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function AddHolidaySlideOver({ open, onClose, onSaved }) {
  const [name, setName] = useState('');
  const [date, setDate] = useState(todayIso());
  const [type, setType] = useState('public');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return;
    setName('');
    setDate(todayIso());
    setType('public');
    setError(null);
  }, [open]);

  async function save() {
    if (!name.trim()) {
      setError('Name is required.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await addHoliday({ name, date, type });
      toast.success('Holiday added.');
      onSaved?.();
      onClose();
    } catch (err) {
      setError(err.message || 'Failed to add holiday.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SlideOver
      open={open}
      onClose={onClose}
      title="Add holiday"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={save} loading={busy}>
            Add holiday
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input
          label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Founder's Day"
          required
        />
        <Input
          label="Date"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          required
        />
        <Select
          label="Type"
          value={type}
          onChange={setType}
          options={[
            { value: 'public', label: 'Public' },
            { value: 'company', label: 'Company' },
          ]}
          searchable={false}
          required
        />
        {error && (
          <div className="rounded-input bg-error-light p-2 text-xs text-error">{error}</div>
        )}
      </div>
    </SlideOver>
  );
}

function CalendarView({ year, holidays }) {
  // Build a 12-month grid with the holidays marked.
  const monthNames = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  const byDate = new Map(holidays.map((h) => [h.date, h]));

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
      {monthNames.map((name, idx) => {
        const month = idx + 1;
        const days = new Date(year, month, 0).getDate();
        const first = new Date(year, idx, 1).getDay();
        return (
          <div key={month} className="rounded-card border border-border bg-surface p-3 shadow-card">
            <p className="mb-2 text-sm font-semibold">{name}</p>
            <div className="grid grid-cols-7 gap-1 text-center text-[10px] text-ink-muted">
              {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
                <span key={i}>{d}</span>
              ))}
              {Array.from({ length: first }).map((_, i) => (
                <span key={`pad-${i}`} />
              ))}
              {Array.from({ length: days }).map((_, i) => {
                const day = i + 1;
                const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                const h = byDate.get(iso);
                const dow = new Date(`${iso}T00:00:00`).getDay();
                const isWeekend = dow === 5 || dow === 6;
                return (
                  <span
                    key={day}
                    title={h ? `${h.name} (${h.type})` : ''}
                    className={cn(
                      'inline-flex h-6 w-6 items-center justify-center rounded-md text-[11px]',
                      h
                        ? h.type === 'company'
                          ? 'bg-accent-light text-accent'
                          : 'bg-rose-100 text-rose-700'
                        : isWeekend
                        ? 'bg-surface-2 text-ink-muted'
                        : 'text-ink',
                    )}
                  >
                    {day}
                  </span>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function HolidaysPage() {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canEdit = hasPermission('attendance.mark_manual');

  const [year, setYear] = useState(new Date().getFullYear());
  const [view, setView] = useState('list');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setLoading(true);
    try {
      const res = await listHolidays({ year });
      setItems(res || []);
    } catch (err) {
      toast.error(err.message || 'Failed to load holidays.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year]);

  async function onDelete() {
    if (!deleting) return;
    setBusy(true);
    try {
      await removeHoliday(deleting.id);
      toast.success('Holiday removed.');
      setDeleting(null);
      refresh();
    } catch (err) {
      toast.error(err.message || 'Failed to remove.');
    } finally {
      setBusy(false);
    }
  }

  const todayIsoStr = todayIso();
  const upcoming = items.filter((h) => h.date >= todayIsoStr).slice(0, 4);

  return (
    <div>
      <PageHeader
        title="Holidays"
        subtitle="UAE public holidays + company-defined off days."
        action={
          <div className="flex items-end gap-2">
            <Select
              label="Year"
              value={year}
              onChange={setYear}
              options={yearOptions()}
              searchable={false}
              containerClassName="w-28"
            />
            <div className="inline-flex overflow-hidden rounded-input border border-border">
              <button
                type="button"
                onClick={() => setView('list')}
                className={cn(
                  'inline-flex items-center gap-1.5 px-3 py-2 text-sm',
                  view === 'list' ? 'bg-accent-light text-accent' : 'bg-surface text-ink-muted',
                )}
              >
                <List size={14} /> List
              </button>
              <button
                type="button"
                onClick={() => setView('calendar')}
                className={cn(
                  'inline-flex items-center gap-1.5 px-3 py-2 text-sm',
                  view === 'calendar' ? 'bg-accent-light text-accent' : 'bg-surface text-ink-muted',
                )}
              >
                <CalendarDays size={14} /> Calendar
              </button>
            </div>
            {canEdit && (
              <Button onClick={() => setOpen(true)}>
                <Plus className="mr-1 h-4 w-4" /> Add holiday
              </Button>
            )}
          </div>
        }
      />

      {upcoming.length > 0 && (
        <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          {upcoming.map((h) => (
            <div
              key={h.id}
              className="rounded-card border border-border bg-surface p-3 shadow-card"
            >
              <p className="text-xs text-ink-muted">Upcoming</p>
              <p className="truncate text-sm font-semibold">{h.name}</p>
              <p className="text-xs text-ink-muted">{fmtDate(h.date)}</p>
            </div>
          ))}
        </div>
      )}

      {loading ? (
        <div className="rounded-card border border-border bg-surface p-8 text-center text-sm text-ink-muted">
          Loading holidays…
        </div>
      ) : view === 'calendar' ? (
        <CalendarView year={year} holidays={items} />
      ) : items.length === 0 ? (
        <div className="rounded-card border border-border bg-surface p-8 text-center text-sm text-ink-muted">
          No holidays in {year}.
        </div>
      ) : (
        <div className="overflow-hidden rounded-card border border-border bg-surface shadow-card">
          <table className="min-w-full text-sm">
            <thead className="bg-surface-2">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-ink-muted">
                  Date
                </th>
                <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-ink-muted">
                  Name
                </th>
                <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-ink-muted">
                  Type
                </th>
                <th className="px-4 py-2 text-right text-xs font-semibold uppercase tracking-wider text-ink-muted">
                  {canEdit ? 'Actions' : ''}
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((h) => (
                <tr key={h.id} className="border-t border-border">
                  <td className="px-4 py-3 text-ink-muted tabular-nums">{fmtDate(h.date)}</td>
                  <td className="px-4 py-3 font-medium">{h.name}</td>
                  <td className="px-4 py-3">
                    <Badge tone={h.type === 'company' ? 'accent' : 'muted'} size="sm">
                      {h.type}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {canEdit && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDeleting(h)}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-error" />
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <AddHolidaySlideOver
        open={open}
        onClose={() => setOpen(false)}
        onSaved={refresh}
      />

      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={onDelete}
        variant="danger"
        title="Remove holiday?"
        description={deleting ? `${deleting.name} (${deleting.date}) will be removed.` : ''}
        confirmLabel="Remove"
        loading={busy}
      />
    </div>
  );
}
