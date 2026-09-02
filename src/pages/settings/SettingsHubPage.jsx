import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import PageHeader from '../../components/ui/PageHeader.jsx';
import SettingsSection from '../../components/settings/SettingsSection.jsx';
import Input from '../../components/ui/Input.jsx';
import Textarea from '../../components/ui/Textarea.jsx';
import AppVersion from '../../components/settings/AppVersion.jsx';
import { useAppSettingsStore } from '../../store/appSettingsStore.js';
import { useAuthStore } from '../../store/authStore.js';
import { toast } from '../../store/toastStore.js';
import { fileUrl } from '../../config.js';

const NAV = [
  { id: 'store', label: 'Store profile' },
  { id: 'invoice', label: 'Invoice & POS' },
  { id: 'vat', label: 'VAT & finance' },
  { id: 'printers', label: 'Printers', link: '/settings/printers' },
  { id: 'network', label: 'Network' },
  { id: 'attendance', label: 'Attendance' },
  { id: 'notifications', label: 'Notifications', link: '/settings/notifications' },
  { id: 'backup', label: 'Backup', link: '/settings/backup' },
  { id: 'account', label: 'My account' },
  { id: 'about', label: 'About' },
];

export default function SettingsHubPage() {
  const [section, setSection] = useState('store');
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const settings = useAppSettingsStore((s) => s.settings);
  const fetch = useAppSettingsStore((s) => s.fetch);
  const save = useAppSettingsStore((s) => s.save);
  const role = useAuthStore((s) => s.user?.role);
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canEdit = role === 'Admin' || hasPermission('settings.edit');

  useEffect(() => {
    fetch().then((s) => setDraft({ ...s }));
  }, [fetch]);

  useEffect(() => {
    if (settings) setDraft({ ...settings });
  }, [settings]);

  const patch = (p) => setDraft((d) => ({ ...d, ...p }));

  async function handleSave(sec) {
    if (!canEdit) return;
    setSaving(true);
    try {
      await save({ ...draft, section: sec });
      toast.success('Settings saved.');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (!draft) {
    return <div className="p-8 text-ink-muted">Loading settings…</div>;
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" subtitle="Store configuration and preferences." />
      <div className="flex flex-col gap-6 lg:flex-row">
        <nav className="card w-full shrink-0 p-2 lg:w-56">
          {NAV.map((item) =>
            item.link ? (
              <Link
                key={item.id}
                to={item.link}
                className="block rounded-lg px-3 py-2 text-sm text-ink-muted hover:bg-surface-2"
              >
                {item.label} →
              </Link>
            ) : (
              <button
                key={item.id}
                type="button"
                onClick={() => setSection(item.id)}
                className={`block w-full rounded-lg px-3 py-2 text-left text-sm ${
                  section === item.id ? 'bg-accent-light text-accent font-medium' : 'text-ink-muted hover:bg-surface-2'
                }`}
              >
                {item.label}
              </button>
            ),
          )}
        </nav>
        <div className="min-w-0 flex-1">
          {section === 'store' && (
            <SettingsSection title="Store profile" onSave={() => handleSave('store_profile')} saving={saving}>
              <Input label="Store name" value={draft.store_name || ''} onChange={(e) => patch({ store_name: e.target.value })} disabled={!canEdit} />
              <Input label="Arabic name" value={draft.store_name_ar || ''} onChange={(e) => patch({ store_name_ar: e.target.value })} disabled={!canEdit} />
              <Textarea label="Address" value={draft.store_address || ''} onChange={(e) => patch({ store_address: e.target.value })} disabled={!canEdit} />
              <Input label="Phone" value={draft.store_phone || ''} onChange={(e) => patch({ store_phone: e.target.value })} disabled={!canEdit} />
              <Input label="Email" value={draft.store_email || ''} onChange={(e) => patch({ store_email: e.target.value })} disabled={!canEdit} />
              <Input label="TRN" value={draft.store_trn || ''} onChange={(e) => patch({ store_trn: e.target.value })} disabled={!canEdit} />
              {draft.store_logo_path && (
                <img src={fileUrl(draft.store_logo_path)} alt="Logo" className="h-16 object-contain" />
              )}
            </SettingsSection>
          )}
          {section === 'invoice' && (
            <SettingsSection title="Invoice & POS" onSave={() => handleSave('invoice_pos')} saving={saving}>
              <Input label="Invoice prefix" value={draft.invoice_prefix || ''} onChange={(e) => patch({ invoice_prefix: e.target.value })} disabled={!canEdit} />
              <Textarea label="Footer note" value={draft.invoice_footer_note || ''} onChange={(e) => patch({ invoice_footer_note: e.target.value })} disabled={!canEdit} />
              <Textarea label="Terms" value={draft.invoice_terms || ''} onChange={(e) => patch({ invoice_terms: e.target.value })} disabled={!canEdit} />
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={!!draft.invoice_auto_print} onChange={(e) => patch({ invoice_auto_print: e.target.checked })} disabled={!canEdit} />
                Auto-print receipt on confirm
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={!!draft.pos_require_customer} onChange={(e) => patch({ pos_require_customer: e.target.checked })} disabled={!canEdit} />
                Require customer for sales
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={!!draft.pos_allow_negative_stock} onChange={(e) => patch({ pos_allow_negative_stock: e.target.checked })} disabled={!canEdit} />
                Allow negative stock (not recommended)
              </label>
            </SettingsSection>
          )}
          {section === 'vat' && (
            <SettingsSection title="VAT & finance" onSave={() => handleSave('vat_finance')} saving={saving}>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={!!draft.vat_enabled} onChange={(e) => patch({ vat_enabled: e.target.checked })} disabled={!canEdit} />
                VAT enabled
              </label>
              <Input label="VAT rate (%)" type="number" value={draft.vat_rate} onChange={(e) => patch({ vat_rate: Number(e.target.value) })} disabled={!canEdit} />
              <Input label="VAT number" value={draft.vat_number || ''} onChange={(e) => patch({ vat_number: e.target.value })} disabled={!canEdit} />
              <Input label="Fiscal year starts (month 1-12)" type="number" value={draft.fiscal_year_start_month} onChange={(e) => patch({ fiscal_year_start_month: Number(e.target.value) })} disabled={!canEdit} />
            </SettingsSection>
          )}
          {section === 'network' && (
            <SettingsSection title="Network" description="Per-PC settings are stored in Electron appConfig on each machine.">
              <p className="text-sm text-ink-muted">
                PC identifier: <strong>{window.electron?.pcIdentifier || '—'}</strong>
              </p>
              <p className="text-sm text-ink-muted">
                Server: {window.electron?.serverIp || '—'}:{window.electron?.serverPort || 3000}
              </p>
              <button
                type="button"
                className="text-sm font-semibold text-accent"
                onClick={() => {
                  const ip = window.electron?.serverIp || '127.0.0.1';
                  const port = window.electron?.serverPort || 3000;
                  navigator.clipboard?.writeText(`Server IP: ${ip}:${port}`);
                  toast.success('Connection info copied.');
                }}
              >
                Copy connection info
              </button>
            </SettingsSection>
          )}
          {section === 'attendance' && (
            <SettingsSection title="Attendance" onSave={() => handleSave('attendance')} saving={saving}>
              <Input label="Work week starts (0=Sun)" type="number" value={draft.work_week_start} onChange={(e) => patch({ work_week_start: Number(e.target.value) })} disabled={!canEdit} />
              <p className="text-xs text-ink-muted">Weekend days default: Friday (5) and Saturday (6) for UAE.</p>
            </SettingsSection>
          )}
          {section === 'about' && (
            <SettingsSection title="About">
              <p className="text-lg font-semibold text-ink">A1 Smart Light POS</p>
              <p className="text-sm text-ink-muted">Built by Bytecra</p>
              <AppVersion />
            </SettingsSection>
          )}
        </div>
      </div>
    </div>
  );
}
