import { useEffect, useState } from 'react';
import { Save } from 'lucide-react';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Button from '../../components/ui/Button.jsx';
import { useNotificationStore } from '../../store/notificationStore.js';
import SeverityIcon from '../../components/notifications/SeverityIcon.jsx';
import CategoryIcon from '../../components/notifications/CategoryIcon.jsx';

const CATEGORY_FIELDS = [
  { key: 'stock_alerts', label: 'Stock Alerts', category: 'stock' },
  { key: 'invoice_alerts', label: 'Invoice Alerts', category: 'invoice' },
  { key: 'return_alerts', label: 'Return Alerts', category: 'return' },
  { key: 'warranty_alerts', label: 'Warranty Alerts', category: 'warranty' },
  { key: 'attendance_alerts', label: 'Attendance Alerts', category: 'attendance' },
  { key: 'bill_alerts', label: 'Bill Reminders', category: 'bill' },
  { key: 'finance_alerts', label: 'Finance Alerts', category: 'finance' },
  { key: 'system_alerts', label: 'System Alerts', category: 'system' },
  { key: 'approval_alerts', label: 'Approval Requests', category: 'approval' },
  { key: 'report_alerts', label: 'Report Notifications', category: 'report' },
];

const SEVERITY_FIELDS = [
  { key: 'show_info', label: 'Info', severity: 'info' },
  { key: 'show_warning', label: 'Warnings', severity: 'warning' },
  { key: 'show_error', label: 'Errors', severity: 'error' },
  { key: 'show_critical', label: 'Critical', severity: 'critical' },
];

function Toggle({ checked, onChange, label, icon = null }) {
  return (
    <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3 hover:bg-surface-2">
      {icon}
      <span className="flex-1 text-sm text-ink">{label}</span>
      <input
        type="checkbox"
        checked={!!checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-5 w-5 cursor-pointer accent-accent"
      />
    </label>
  );
}

export default function NotificationPreferencesPage() {
  const preferences = useNotificationStore((s) => s.preferences);
  const fetchPreferences = useNotificationStore((s) => s.fetchPreferences);
  const updatePreferences = useNotificationStore((s) => s.updatePreferences);

  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!preferences) fetchPreferences();
  }, [preferences, fetchPreferences]);

  useEffect(() => {
    if (preferences) setDraft({ ...preferences });
  }, [preferences]);

  function patch(key, value) {
    setDraft((d) => ({ ...(d || {}), [key]: value }));
  }

  async function handleSave() {
    if (!draft) return;
    setSaving(true);
    try {
      await updatePreferences(draft);
    } finally {
      setSaving(false);
    }
  }

  if (!draft) {
    return <div className="text-sm text-ink-muted">Loading preferences…</div>;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Notification Preferences"
        subtitle="Choose which events make it through to your bell, panel, and sound."
        action={
          <Button onClick={handleSave} disabled={saving}>
            <Save size={14} />
            Save Preferences
          </Button>
        }
      />

      <section className="card p-5">
        <h2 className="mb-3 text-sm font-semibold text-ink">Categories</h2>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {CATEGORY_FIELDS.map((f) => (
            <Toggle
              key={f.key}
              checked={draft[f.key]}
              onChange={(v) => patch(f.key, v)}
              label={f.label}
              icon={<CategoryIcon category={f.category} size={14} withBg />}
            />
          ))}
        </div>
      </section>

      <section className="card p-5">
        <h2 className="mb-3 text-sm font-semibold text-ink">Severity</h2>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-4">
          {SEVERITY_FIELDS.map((f) => (
            <Toggle
              key={f.key}
              checked={draft[f.key]}
              onChange={(v) => patch(f.key, v)}
              label={f.label}
              icon={<SeverityIcon severity={f.severity} size={16} />}
            />
          ))}
        </div>
        <p className="mt-3 text-xs text-ink-muted">
          Critical notifications are always delivered, but you can choose
          whether they trigger a sound here.
        </p>
      </section>

      <section className="card p-5">
        <h2 className="mb-3 text-sm font-semibold text-ink">Sound</h2>
        <Toggle
          checked={draft.sound_enabled}
          onChange={(v) => patch('sound_enabled', v)}
          label="Play a subtle sound when new notifications arrive"
        />
      </section>
    </div>
  );
}
