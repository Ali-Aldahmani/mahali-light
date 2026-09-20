'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import PageHeader from '@/components/ui/PageHeader';
import SettingsSection from '@/components/settings/SettingsSection';
import Input from '@/components/ui/Input';
import Textarea from '@/components/ui/Textarea';
import AppVersion from '@/components/settings/AppVersion';
import Button from '@/components/ui/Button';
import { useAppSettingsStore } from '@/store/appSettingsStore';
import { useAuthStore } from '@/store/authStore';
import { toast } from '@/store/toastStore';
import { fileUrl } from '@/lib/config';
import {
  checkForAppUpdates,
  getUpdateInstallStatus,
  installAppUpdate,
  UPDATE_ACTIVE_STATES,
  type UpdateCheckResult,
  type UpdateInstallStatus,
} from '@/services/updateService';

const NAV: { id: string; label: string; link?: string }[] = [
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

const INSTALL_LABELS: Record<string, string> = {
  downloading: 'Downloading update…',
  installing: 'Installing files…',
  swapping: 'Replacing application files…',
  restarting: 'Restarting server…',
};

function formatBytes(n: number | null | undefined): string {
  if (!n || n <= 0) return '';
  const mb = n / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`;
}

export default function SettingsHubPage() {
  const [section, setSection] = useState('store');
  const [draft, setDraft] = useState<Record<string, any> | null>(null);
  const [saving, setSaving] = useState(false);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<UpdateCheckResult | null>(null);
  const [installStatus, setInstallStatus] = useState<UpdateInstallStatus | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const settings = useAppSettingsStore((s) => s.settings);
  const fetchSettings = useAppSettingsStore((s) => s.fetch);
  const save = useAppSettingsStore((s) => s.save);
  const role = useAuthStore((s) => s.user?.role);
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canEdit = role === 'Admin' || hasPermission('settings.edit');

  useEffect(() => {
    fetchSettings().then((s: any) => setDraft({ ...s }));
  }, [fetchSettings]);

  useEffect(() => {
    if (settings) setDraft({ ...settings });
  }, [settings]);

  useEffect(() => {
    return () => {
      if (pollTimer.current) clearInterval(pollTimer.current);
    };
  }, []);

  const patch = (p: Record<string, any>) => setDraft((d) => ({ ...d, ...p }));

  function stopPolling() {
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  }

  async function pollInstallStatus() {
    stopPolling();
    pollTimer.current = setInterval(async () => {
      try {
        const st = await getUpdateInstallStatus();
        setInstallStatus(st);
        if (st.state === 'done' || st.state === 'failed') {
          stopPolling();
          if (st.state === 'done') {
            toast.success(`Update v${st.version} installed. Reloading…`);
            // The server just restarted on new code; force a full reload
            // and send everyone back through login rather than trusting
            // whatever session state the old bundle was holding.
            setTimeout(() => {
              useAuthStore.getState().logoutLocal();
              window.location.href = '/login';
            }, 1500);
          } else {
            toast.error(st.error || 'Update install failed.');
          }
        }
      } catch (_e) {
        // Server is mid-restart — keep polling until it responds again.
      }
    }, 1000);
  }

  async function handleCheckUpdate() {
    if (role !== 'Admin') return;
    setCheckingUpdate(true);
    try {
      const res = await checkForAppUpdates();
      setUpdateInfo(res);
      if (!res.updateAvailable) {
        toast.success(`You're up to date (v${res.currentVersion}).`);
      }
    } catch (err: any) {
      setUpdateInfo(null);
      toast.error(err?.message || 'Unable to check for updates.');
    } finally {
      setCheckingUpdate(false);
    }
  }

  async function handleInstallUpdate() {
    const version = updateInfo?.latestVersion;
    if (!version) return;
    try {
      await installAppUpdate(version);
      setInstallStatus({
        state: 'downloading',
        version,
        message: 'Downloading update…',
        startedAt: new Date().toISOString(),
        finishedAt: null,
        error: null,
        progress: 0,
        bytesDownloaded: 0,
        bytesTotal: null,
      });
      pollInstallStatus();
    } catch (err: any) {
      toast.error(err?.message || 'Unable to start the update.');
    }
  }

  async function handleSave(sec: string) {
    if (!canEdit) return;
    setSaving(true);
    try {
      await save({ ...draft, section: sec });
      toast.success('Settings saved.');
    } catch (err: any) {
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
                href={item.link}
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
              <Input label="Store name" value={draft.store_name || ''} onChange={(e: any) => patch({ store_name: e.target.value })} disabled={!canEdit} />
              <Input label="Arabic name" value={draft.store_name_ar || ''} onChange={(e: any) => patch({ store_name_ar: e.target.value })} disabled={!canEdit} />
              <Textarea label="Address" value={draft.store_address || ''} onChange={(e: any) => patch({ store_address: e.target.value })} disabled={!canEdit} />
              <Input label="Phone" value={draft.store_phone || ''} onChange={(e: any) => patch({ store_phone: e.target.value })} disabled={!canEdit} />
              <Input label="Email" value={draft.store_email || ''} onChange={(e: any) => patch({ store_email: e.target.value })} disabled={!canEdit} />
              <Input label="TRN" value={draft.store_trn || ''} onChange={(e: any) => patch({ store_trn: e.target.value })} disabled={!canEdit} />
              {draft.store_logo_path && (
                <img src={fileUrl(draft.store_logo_path)} alt="Logo" className="h-16 object-contain" />
              )}
            </SettingsSection>
          )}
          {section === 'invoice' && (
            <SettingsSection title="Invoice & POS" onSave={() => handleSave('invoice_pos')} saving={saving}>
              <Input label="Invoice prefix" value={draft.invoice_prefix || ''} onChange={(e: any) => patch({ invoice_prefix: e.target.value })} disabled={!canEdit} />
              <Textarea label="Footer note" value={draft.invoice_footer_note || ''} onChange={(e: any) => patch({ invoice_footer_note: e.target.value })} disabled={!canEdit} />
              <Textarea label="Terms" value={draft.invoice_terms || ''} onChange={(e: any) => patch({ invoice_terms: e.target.value })} disabled={!canEdit} />
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
              <Input label="VAT rate (%)" type="number" value={draft.vat_rate} onChange={(e: any) => patch({ vat_rate: Number(e.target.value) })} disabled={!canEdit} />
              <Input label="VAT number" value={draft.vat_number || ''} onChange={(e: any) => patch({ vat_number: e.target.value })} disabled={!canEdit} />
              <Input label="Fiscal year starts (month 1-12)" type="number" value={draft.fiscal_year_start_month} onChange={(e: any) => patch({ fiscal_year_start_month: Number(e.target.value) })} disabled={!canEdit} />
            </SettingsSection>
          )}
          {section === 'network' && (
            <SettingsSection title="Network" description="Per-PC settings are stored in Electron appConfig on each machine.">
              <p className="text-sm text-ink-muted">
                PC identifier: <strong>{typeof window !== 'undefined' && window.electron?.pcIdentifier || '—'}</strong>
              </p>
              <p className="text-sm text-ink-muted">
                Server: {typeof window !== 'undefined' && window.electron?.serverIp || '—'}:{(typeof window !== 'undefined' && window.electron?.serverPort) || 3000}
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
              <Input label="Work week starts (0=Sun)" type="number" value={draft.work_week_start} onChange={(e: any) => patch({ work_week_start: Number(e.target.value) })} disabled={!canEdit} />
              <p className="text-xs text-ink-muted">Weekend days default: Friday (5) and Saturday (6) for UAE.</p>
            </SettingsSection>
          )}
          {section === 'about' && (
            <SettingsSection title="About">
              <p className="text-lg font-semibold text-ink">Mahali Light POS</p>
              <p className="text-sm text-ink-muted">Built by Bytecra</p>
              <AppVersion />

              {role === 'Admin' && (
                <>
                  <Button
                    size="sm"
                    variant="secondary"
                    className="mt-3"
                    loading={checkingUpdate}
                    disabled={installStatus !== null && UPDATE_ACTIVE_STATES.includes(installStatus.state)}
                    onClick={handleCheckUpdate}
                  >
                    Check for updates
                  </Button>

                  {updateInfo?.updateAvailable && updateInfo.latestVersion && (
                    <div className="mt-4 rounded-lg border border-accent/30 bg-accent-light p-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-accent">
                            Update available: v{updateInfo.latestVersion}
                          </p>
                          <p className="text-xs text-ink-muted">
                            Current: v{updateInfo.currentVersion}
                            {updateInfo.releaseUrl && ' — released on the public repo.'}
                          </p>
                        </div>
                        <Button
                          size="sm"
                          disabled={installStatus !== null && UPDATE_ACTIVE_STATES.includes(installStatus.state)}
                          onClick={handleInstallUpdate}
                        >
                          Install update
                        </Button>
                      </div>
                      {installStatus &&
                        (UPDATE_ACTIVE_STATES.includes(installStatus.state) ? (
                          installStatus.state === 'downloading' && installStatus.progress !== null ? (
                            <div className="mt-3">
                              <div className="h-2 w-full overflow-hidden rounded-full bg-ink/10">
                                <div
                                  className="h-full rounded-full bg-accent transition-all duration-300"
                                  style={{ width: `${installStatus.progress}%` }}
                                />
                              </div>
                              <p className="mt-1 text-xs text-ink-muted">
                                Downloading update… {installStatus.progress}%
                                {installStatus.bytesTotal
                                  ? ` (${formatBytes(installStatus.bytesDownloaded)} / ${formatBytes(installStatus.bytesTotal)})`
                                  : ''}
                              </p>
                            </div>
                          ) : (
                            <p className="mt-2 text-sm text-ink">
                              {INSTALL_LABELS[installStatus.state] || installStatus.message}
                            </p>
                          )
                        ) : installStatus.state === 'failed' ? (
                          <p className="mt-2 text-sm text-danger">
                            {installStatus.error || 'Update install failed.'}
                          </p>
                        ) : null)}
                    </div>
                  )}
                </>
              )}
            </SettingsSection>
          )}
        </div>
      </div>
    </div>
  );
}
