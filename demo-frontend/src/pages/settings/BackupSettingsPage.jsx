import { useEffect, useMemo, useState } from 'react';
import {
  Activity, Database, Server, ShieldCheck, Trash2, Loader2, History,
} from 'lucide-react';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Button from '../../components/ui/Button.jsx';
import Input from '../../components/ui/Input.jsx';
import Tabs from '../../components/ui/Tabs.jsx';
import { useAuthStore } from '../../store/authStore.js';
import { useBackupStore } from '../../store/backupStore.js';
import BackupStatusCard from '../../components/backup/BackupStatusCard.jsx';
import BackupJobRow from '../../components/backup/BackupJobRow.jsx';
import RetentionSlider from '../../components/backup/RetentionSlider.jsx';
import RestoreConfirmModal from '../../components/backup/RestoreConfirmModal.jsx';
import { downloadBackup } from '../../services/backupService.js';
import { toast } from '../../store/toastStore.js';

const TABS = [
  { value: 'status', label: 'Status', icon: <Activity size={14} /> },
  { value: 'history', label: 'History', icon: <History size={14} /> },
  { value: 'settings', label: 'Settings', icon: <Database size={14} /> },
];

function Toggle({ checked, onChange, label, helper }) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-card border border-border bg-surface px-3 py-2.5 cursor-pointer">
      <span>
        <span className="block text-sm font-medium text-ink">{label}</span>
        {helper && <span className="block text-xs text-ink-muted">{helper}</span>}
      </span>
      <span
        role="switch"
        aria-checked={checked}
        onClick={() => onChange?.(!checked)}
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
          checked ? 'bg-accent' : 'bg-surface-2'
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
            checked ? 'translate-x-4' : 'translate-x-0.5'
          }`}
        />
      </span>
    </label>
  );
}

export default function BackupSettingsPage() {
  const role = useAuthStore((s) => s.user?.role);
  const hasPerm = useAuthStore((s) => s.hasPermission);
  const canConfigure = role === 'Admin' || hasPerm('backup.configure');
  const canRestore = role === 'Admin' || hasPerm('backup.restore');

  const [tab, setTab] = useState('status');
  const [draft, setDraft] = useState(null);
  const [restoreJob, setRestoreJob] = useState(null);
  const [nasTesting, setNasTesting] = useState(false);

  const jobs = useBackupStore((s) => s.jobs);
  const loadingJobs = useBackupStore((s) => s.loadingJobs);
  const settings = useBackupStore((s) => s.settings);
  const destinations = useBackupStore((s) => s.destinations);
  const diskUsage = useBackupStore((s) => s.diskUsage);
  const usbDrives = useBackupStore((s) => s.usbDrives);

  const fetchJobs = useBackupStore((s) => s.fetchJobs);
  const fetchSettings = useBackupStore((s) => s.fetchSettings);
  const fetchDestinations = useBackupStore((s) => s.fetchDestinations);
  const fetchDiskUsage = useBackupStore((s) => s.fetchDiskUsage);
  const fetchUsbDrives = useBackupStore((s) => s.fetchUsbDrives);
  const runBackup = useBackupStore((s) => s.runBackup);
  const saveSettings = useBackupStore((s) => s.saveSettings);
  const testNas = useBackupStore((s) => s.testNasConnection);
  const triggerRestore = useBackupStore((s) => s.triggerRestore);
  const cleanupRetention = useBackupStore((s) => s.cleanupRetention);

  useEffect(() => {
    fetchJobs();
    fetchSettings();
    fetchDestinations();
    fetchDiskUsage();
    fetchUsbDrives();
    const id = setInterval(() => {
      fetchDestinations();
      fetchDiskUsage();
      fetchUsbDrives();
    }, 30000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (settings && !draft) setDraft({ ...settings });
  }, [settings, draft]);

  const lastJob = jobs?.[0] || null;
  const isRunning = useMemo(() => jobs?.some((j) => j.status === 'running'), [jobs]);

  // Poll for running jobs.
  useEffect(() => {
    if (!isRunning) return undefined;
    const id = setInterval(() => fetchJobs(), 5000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRunning]);

  const dirty = useMemo(() => {
    if (!draft || !settings) return false;
    const compareKeys = [
      'schedule_6h_enabled', 'schedule_nightly_enabled', 'schedule_weekly_enabled', 'schedule_monthly_enabled',
      'local_enabled', 'local_path',
      'nas_enabled', 'nas_ip', 'nas_path', 'nas_username',
      'usb_enabled', 'usb_auto_detect',
      'retention_6h_days', 'retention_nightly_days', 'retention_weekly_weeks',
      'notify_on_success', 'notify_on_failure',
      'compression_enabled', 'compression_level',
      'encryption_enabled',
      'pg_dump_path', 'pg_restore_path',
    ];
    return compareKeys.some((k) => draft[k] !== settings[k])
      || (draft.nas_password && draft.nas_password.length > 0);
  }, [draft, settings]);

  const handleSave = async () => {
    if (!draft) return;
    const patch = {};
    Object.keys(draft).forEach((k) => {
      if (k === 'updated_at' || k === 'id') return;
      patch[k] = draft[k];
    });
    if (!patch.nas_password) delete patch.nas_password;
    await saveSettings(patch);
    setDraft((d) => ({ ...d, nas_password: '' }));
    fetchSettings();
  };

  const handleDownload = async (job) => {
    try {
      await downloadBackup(job.id, job.job_number);
    } catch (err) {
      toast.error(err.message || 'Download failed.');
    }
  };

  const handleConfirmRestore = async (job) => {
    setRestoreJob(null);
    await triggerRestore(job.id, 120);
  };

  if (!draft) {
    return (
      <div className="flex h-64 items-center justify-center text-ink-muted">
        <Loader2 className="mr-2 animate-spin" /> Loading backup settings…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Backup & restore"
        subtitle="Manage scheduled backups, off-site copies, retention and disaster recovery."
      />

      <Tabs items={TABS} value={tab} onChange={setTab} />

      {tab === 'status' && (
        <BackupStatusCard
          lastJob={lastJob}
          diskUsage={diskUsage}
          destinations={destinations}
          settings={settings}
          isRunning={isRunning}
          onRunBackup={(t) => runBackup(t)}
        />
      )}

      {tab === 'history' && (
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold text-ink">Backup history</h2>
            <Button variant="ghost" size="sm" onClick={() => fetchJobs()}>
              Refresh
            </Button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-surface-2 text-xs uppercase tracking-wide text-ink-muted">
                <tr>
                  <th className="px-3 py-2">Job</th>
                  <th className="px-3 py-2">Started</th>
                  <th className="px-3 py-2">Size</th>
                  <th className="px-3 py-2">Destinations</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loadingJobs && (
                  <tr>
                    <td className="px-3 py-6 text-center text-ink-muted" colSpan={6}>
                      Loading…
                    </td>
                  </tr>
                )}
                {!loadingJobs && (!jobs || jobs.length === 0) && (
                  <tr>
                    <td className="px-3 py-6 text-center text-ink-muted" colSpan={6}>
                      No backups have been run yet.
                    </td>
                  </tr>
                )}
                {jobs?.map((job) => (
                  <BackupJobRow
                    key={job.id}
                    job={job}
                    canDownload
                    canRestore={canRestore}
                    onDownload={handleDownload}
                    onRestore={(j) => setRestoreJob(j)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'settings' && (
        <SettingsForm
          draft={draft}
          setDraft={setDraft}
          canConfigure={canConfigure}
          usbDrives={usbDrives}
          nasTesting={nasTesting}
          onTestNas={async () => {
            setNasTesting(true);
            try {
              await testNas({
                nas_ip: draft.nas_ip,
                nas_path: draft.nas_path,
              });
            } finally {
              setNasTesting(false);
            }
          }}
          onRetentionCleanup={cleanupRetention}
        />
      )}

      {tab === 'settings' && dirty && canConfigure && (
        <div className="sticky bottom-4 z-10 flex justify-end">
          <div className="card flex items-center gap-3 px-4 py-3 shadow-pop">
            <span className="text-sm text-ink-muted">You have unsaved changes.</span>
            <Button variant="secondary" onClick={() => setDraft({ ...settings, nas_password: '' })}>
              Discard
            </Button>
            <Button onClick={handleSave}>
              <ShieldCheck size={14} /> Save settings
            </Button>
          </div>
        </div>
      )}

      <RestoreConfirmModal
        open={Boolean(restoreJob)}
        job={restoreJob}
        onCancel={() => setRestoreJob(null)}
        onConfirm={handleConfirmRestore}
      />
    </div>
  );
}

function SectionCard({ title, icon, children }) {
  return (
    <section className="card p-5">
      <header className="mb-3 flex items-center gap-2">
        {icon}
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
      </header>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function SettingsForm({ draft, setDraft, canConfigure, usbDrives, nasTesting, onTestNas, onRetentionCleanup }) {
  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <SectionCard title="Schedules" icon={<Activity size={16} className="text-accent" />}>
        <Toggle
          checked={!!draft.schedule_6h_enabled}
          onChange={(v) => set({ schedule_6h_enabled: v })}
          label="6-hour DB backup"
          helper="Database-only sweep every 6 hours."
        />
        <Toggle
          checked={!!draft.schedule_nightly_enabled}
          onChange={(v) => set({ schedule_nightly_enabled: v })}
          label="Nightly full backup"
          helper="Full backup at 02:00 every night."
        />
        <Toggle
          checked={!!draft.schedule_weekly_enabled}
          onChange={(v) => set({ schedule_weekly_enabled: v })}
          label="Weekly full backup"
          helper="Full backup every Sunday at 03:00."
        />
        <Toggle
          checked={!!draft.schedule_monthly_enabled}
          onChange={(v) => set({ schedule_monthly_enabled: v })}
          label="Monthly archive"
          helper="Permanent archive on the 1st of each month."
        />
      </SectionCard>

      <SectionCard title="Destinations" icon={<Server size={16} className="text-accent" />}>
        <Toggle
          checked={!!draft.local_enabled}
          onChange={(v) => set({ local_enabled: v })}
          label="Local disk"
          helper="Stores backups on the server PC."
        />
        <Input
          label="Local path"
          value={draft.local_path || ''}
          onChange={(e) => set({ local_path: e.target.value })}
          disabled={!canConfigure}
          hint="Absolute or relative path. Default ./backups."
        />

        <div className="mt-4">
          <Toggle
            checked={!!draft.nas_enabled}
            onChange={(v) => set({ nas_enabled: v })}
            label="NAS (network storage)"
            helper="UNC or mounted share copy after each backup."
          />
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Input
            label="NAS IP"
            value={draft.nas_ip || ''}
            onChange={(e) => set({ nas_ip: e.target.value })}
            placeholder="192.168.50.51"
          />
          <Input
            label="NAS path"
            value={draft.nas_path || ''}
            onChange={(e) => set({ nas_path: e.target.value })}
            placeholder="/volume1/pos-backups"
          />
          <Input
            label="NAS username"
            value={draft.nas_username || ''}
            onChange={(e) => set({ nas_username: e.target.value })}
          />
          <Input
            label="NAS password"
            type="password"
            value={draft.nas_password || ''}
            onChange={(e) => set({ nas_password: e.target.value })}
            placeholder={draft.nas_password_set ? '••••••••' : 'Set new password'}
          />
        </div>
        <Button variant="secondary" size="sm" onClick={onTestNas} loading={nasTesting} disabled={!draft.nas_enabled}>
          Test NAS connection
        </Button>

        <div className="mt-4">
          <Toggle
            checked={!!draft.usb_enabled}
            onChange={(v) => set({ usb_enabled: v })}
            label="USB drive"
            helper="Copy to any plugged-in removable drive."
          />
          <Toggle
            checked={!!draft.usb_auto_detect}
            onChange={(v) => set({ usb_auto_detect: v })}
            label="Auto-detect drives"
            helper="Disable to manually choose a drive only."
          />
          <div className="mt-2 rounded-card border border-border bg-surface-2/40 p-3 text-xs text-ink-muted">
            {usbDrives?.length ? (
              <ul className="space-y-1">
                {usbDrives.map((d) => (
                  <li key={d.device}>
                    <span className="font-medium text-ink">{d.description}</span>{' '}
                    — {d.mountpoint}
                  </li>
                ))}
              </ul>
            ) : (
              'No removable drives detected.'
            )}
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Retention" icon={<Trash2 size={16} className="text-accent" />}>
        <RetentionSlider
          label="6-hour backups"
          value={draft.retention_6h_days}
          min={1}
          max={30}
          unit="days"
          onChange={(v) => set({ retention_6h_days: v })}
        />
        <RetentionSlider
          label="Nightly backups"
          value={draft.retention_nightly_days}
          min={7}
          max={120}
          unit="days"
          onChange={(v) => set({ retention_nightly_days: v })}
        />
        <RetentionSlider
          label="Weekly backups"
          value={draft.retention_weekly_weeks}
          min={4}
          max={52}
          unit="weeks"
          onChange={(v) => set({ retention_weekly_weeks: v })}
        />
        <RetentionSlider
          label="Monthly archives"
          value={120}
          min={120}
          max={120}
          unit="months"
          locked
          helper="Monthly archives are kept forever and never auto-purged."
        />
        <Button variant="secondary" size="sm" onClick={onRetentionCleanup}>
          Run retention cleanup now
        </Button>
      </SectionCard>

      <SectionCard title="Compression & notifications" icon={<Database size={16} className="text-accent" />}>
        <Toggle
          checked={!!draft.compression_enabled}
          onChange={(v) => set({ compression_enabled: v })}
          label="Enable compression"
          helper="Smaller archives but slower CPU."
        />
        <RetentionSlider
          label="Compression level"
          value={draft.compression_level}
          min={1}
          max={9}
          unit="(1 fast → 9 small)"
          onChange={(v) => set({ compression_level: v })}
        />
        <Toggle
          checked={!!draft.notify_on_success}
          onChange={(v) => set({ notify_on_success: v })}
          label="Notify on success"
        />
        <Toggle
          checked={!!draft.notify_on_failure}
          onChange={(v) => set({ notify_on_failure: v })}
          label="Notify on failure"
        />
        <Input
          label="pg_dump path override"
          value={draft.pg_dump_path || ''}
          onChange={(e) => set({ pg_dump_path: e.target.value })}
          placeholder="(empty = use PATH)"
          hint="Optional. Use only if pg_dump is not on the server's PATH."
        />
        <Input
          label="pg_restore path override"
          value={draft.pg_restore_path || ''}
          onChange={(e) => set({ pg_restore_path: e.target.value })}
          placeholder="(empty = use PATH)"
        />
      </SectionCard>
    </div>
  );
}
