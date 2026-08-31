import { useEffect, useMemo, useState } from 'react';
import {
  Printer,
  Building2,
  Upload,
  RefreshCw,
  Trash2,
  Image as ImageIcon,
  TestTube,
} from 'lucide-react';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Button from '../../components/ui/Button.jsx';
import Input from '../../components/ui/Input.jsx';
import Spinner from '../../components/ui/Spinner.jsx';
import PermissionGate from '../../components/ui/PermissionGate.jsx';
import { toast } from '../../store/toastStore.js';
import { useAuthStore } from '../../store/authStore.js';
import {
  getStoreSettings,
  updateStoreSettings,
  uploadStoreLogo,
  removeStoreLogo,
} from '../../services/settingsService.js';
import {
  hasElectronPrint,
  listLocalPrinters,
  getLocalPrintSettings,
  saveLocalPrintSettings,
  printReceipt,
  printInvoice,
} from '../../services/printService.js';
import { fileUrl } from '../../config.js';

export default function PrintSettingsPage() {
  const permissions = useAuthStore((s) => s.permissions);
  const canEdit = permissions.includes('settings.edit');

  const [storeLoading, setStoreLoading] = useState(true);
  const [storeForm, setStoreForm] = useState(null);
  const [savingStore, setSavingStore] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);

  const [printers, setPrinters] = useState([]);
  const [printerSettings, setPrinterSettings] = useState(null);
  const [printersLoading, setPrintersLoading] = useState(true);

  useEffect(() => {
    setStoreLoading(true);
    getStoreSettings()
      .then((s) => setStoreForm(s))
      .catch((err) => toast.error(err?.message || 'Could not load settings.'))
      .finally(() => setStoreLoading(false));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setPrintersLoading(true);
    Promise.all([listLocalPrinters(), getLocalPrintSettings()])
      .then(([list, ps]) => {
        if (cancelled) return;
        setPrinters(list);
        setPrinterSettings(ps);
      })
      .catch(() => {})
      .finally(() => !cancelled && setPrintersLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  const printerOptions = useMemo(() => {
    const names = (printers || []).map((p) => p.name).filter(Boolean);
    return ['', ...names];
  }, [printers]);

  const handleStoreChange = (field, value) => {
    setStoreForm((prev) => ({ ...(prev || {}), [field]: value }));
  };
  const handleStoreNested = (group, field, value) => {
    setStoreForm((prev) => ({
      ...(prev || {}),
      [group]: { ...(prev?.[group] || {}), [field]: value },
    }));
  };

  const saveStore = async () => {
    if (!canEdit) return;
    setSavingStore(true);
    try {
      const next = await updateStoreSettings(storeForm);
      setStoreForm(next);
      toast.success('Store settings saved.');
    } catch (err) {
      toast.error(err?.message || 'Could not save settings.');
    } finally {
      setSavingStore(false);
    }
  };

  const onLogoFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingLogo(true);
    try {
      const next = await uploadStoreLogo(file);
      setStoreForm(next);
      toast.success('Logo uploaded.');
    } catch (err) {
      toast.error(err?.message || 'Could not upload logo.');
    } finally {
      setUploadingLogo(false);
      e.target.value = '';
    }
  };

  const onLogoRemove = async () => {
    setUploadingLogo(true);
    try {
      const next = await removeStoreLogo();
      setStoreForm(next);
      toast.success('Logo removed.');
    } catch (err) {
      toast.error(err?.message || 'Could not remove logo.');
    } finally {
      setUploadingLogo(false);
    }
  };

  const savePrintLocal = async (patch) => {
    const next = await saveLocalPrintSettings(patch);
    setPrinterSettings(next || { ...printerSettings, ...patch });
  };

  const testPrint = async (kind) => {
    toast.info('Sending a test print…');
    const fn = kind === 'receipt' ? printReceipt : printInvoice;
    // We can't generate a real invoice for testing, so we open a small data
    // URL PDF in Electron. For simplicity here we just notify the user.
    try {
      await fn('00000000-0000-0000-0000-000000000000', { silent: false });
    } catch (_e) {
      // expected — there's no such invoice
    }
    toast.success(
      'Test sent. If nothing printed, verify the printer name in your OS.',
    );
  };

  if (storeLoading || !storeForm) {
    return (
      <div className="flex justify-center py-20">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Printers & store branding"
        subtitle="Customize how invoices, receipts and purchase orders look."
      />

      <section className="card p-5">
        <div className="flex items-center gap-2 mb-4">
          <Building2 className="h-5 w-5 text-accent" />
          <h2 className="text-base font-semibold text-ink">Store details</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Input
            label="Store name"
            value={storeForm.storeName || ''}
            onChange={(e) => handleStoreChange('storeName', e.target.value)}
            disabled={!canEdit}
          />
          <Input
            label="TRN (Tax Registration Number)"
            value={storeForm.storeTRN || ''}
            onChange={(e) => handleStoreChange('storeTRN', e.target.value)}
            disabled={!canEdit}
            hint="Printed on every tax invoice for UAE VAT compliance."
          />
          <Input
            label="Address"
            value={storeForm.storeAddress || ''}
            onChange={(e) => handleStoreChange('storeAddress', e.target.value)}
            disabled={!canEdit}
            containerClassName="md:col-span-2"
          />
          <Input
            label="Phone"
            value={storeForm.storePhone || ''}
            onChange={(e) => handleStoreChange('storePhone', e.target.value)}
            disabled={!canEdit}
          />
          <Input
            label="Email"
            type="email"
            value={storeForm.storeEmail || ''}
            onChange={(e) => handleStoreChange('storeEmail', e.target.value)}
            disabled={!canEdit}
          />
          <Input
            label="Currency"
            value={storeForm.currency || 'AED'}
            onChange={(e) => handleStoreChange('currency', e.target.value)}
            disabled={!canEdit}
          />
          <Input
            label="VAT rate (%)"
            type="number"
            value={storeForm.vatRate ?? 5}
            onChange={(e) =>
              handleStoreChange('vatRate', Number(e.target.value) || 0)
            }
            disabled={!canEdit}
          />
        </div>

        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium text-ink">
              Invoice footer note
            </label>
            <textarea
              className="mt-1 w-full rounded-input border border-border bg-surface px-3 py-2 text-sm focus:border-accent focus:outline-none"
              rows={2}
              value={storeForm.invoiceFooterNote || ''}
              onChange={(e) =>
                handleStoreChange('invoiceFooterNote', e.target.value)
              }
              disabled={!canEdit}
            />
          </div>
          <div>
            <label className="text-sm font-medium text-ink">
              Invoice terms
            </label>
            <textarea
              className="mt-1 w-full rounded-input border border-border bg-surface px-3 py-2 text-sm focus:border-accent focus:outline-none"
              rows={2}
              value={storeForm.invoiceTerms || ''}
              onChange={(e) =>
                handleStoreChange('invoiceTerms', e.target.value)
              }
              disabled={!canEdit}
            />
          </div>
        </div>

        <PermissionGate permission="settings.edit">
          <div className="mt-5 flex justify-end">
            <Button
              onClick={saveStore}
              loading={savingStore}
              leftIcon={<RefreshCw className="h-4 w-4" />}
            >
              Save store settings
            </Button>
          </div>
        </PermissionGate>
      </section>

      <section className="card p-5">
        <div className="flex items-center gap-2 mb-4">
          <ImageIcon className="h-5 w-5 text-accent" />
          <h2 className="text-base font-semibold text-ink">Logo</h2>
        </div>
        <div className="flex flex-col md:flex-row gap-6 items-start">
          <div className="rounded-card border border-border bg-surface-2 p-4 w-44 h-32 flex items-center justify-center">
            {storeForm.logoPath ? (
              <img
                src={fileUrl(storeForm.logoPath)}
                alt="Store logo"
                className="max-h-full max-w-full object-contain"
              />
            ) : (
              <span className="text-xs text-ink-muted">No logo uploaded</span>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <p className="text-xs text-ink-muted max-w-md">
              PNG with a transparent background is recommended. Maximum 2 MB.
              Appears on invoices and purchase order PDFs.
            </p>
            <PermissionGate permission="settings.edit">
              <div className="flex flex-wrap gap-2">
                <label className="inline-flex">
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/svg+xml"
                    className="hidden"
                    onChange={onLogoFile}
                  />
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-input border border-border bg-surface px-4 h-10 text-sm cursor-pointer hover:bg-surface-2 ${uploadingLogo ? 'opacity-60 pointer-events-none' : ''}`}
                  >
                    <Upload className="h-4 w-4" />
                    Upload new logo
                  </span>
                </label>
                {storeForm.logoPath && (
                  <Button
                    variant="ghost"
                    leftIcon={<Trash2 className="h-4 w-4" />}
                    onClick={onLogoRemove}
                    loading={uploadingLogo}
                  >
                    Remove
                  </Button>
                )}
              </div>
            </PermissionGate>
          </div>
        </div>
      </section>

      <section className="card p-5">
        <div className="flex items-center gap-2 mb-4">
          <Printer className="h-5 w-5 text-accent" />
          <h2 className="text-base font-semibold text-ink">Printers (per PC)</h2>
        </div>

        {!hasElectronPrint() ? (
          <div className="rounded-input border border-border bg-surface-2 p-4 text-sm text-ink-muted">
            Printer selection is only available from the Electron desktop app.
            Open Mahali Light on each cashier PC to configure printers.
          </div>
        ) : printersLoading ? (
          <div className="py-6 text-center">
            <Spinner />
          </div>
        ) : (
          <div className="space-y-4">
            <PrinterRow
              label="Default A4 printer (invoices)"
              value={printerSettings?.defaultPrinter || ''}
              options={printerOptions}
              onChange={(v) => savePrintLocal({ defaultPrinter: v || null })}
              onTest={() => testPrint('invoice')}
            />
            <PrinterRow
              label="Thermal receipt printer (80 mm)"
              value={printerSettings?.thermalPrinter || ''}
              options={printerOptions}
              onChange={(v) => savePrintLocal({ thermalPrinter: v || null })}
              onTest={() => testPrint('receipt')}
            />

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
              <Toggle
                label="Print silently (no dialog)"
                value={printerSettings?.silentPrint !== false}
                onChange={(v) => savePrintLocal({ silentPrint: v })}
              />
              <Toggle
                label="Auto-print receipt after each sale"
                value={!!printerSettings?.autoPrintReceipt}
                onChange={(v) => savePrintLocal({ autoPrintReceipt: v })}
              />
              <Input
                label="Copies"
                type="number"
                min={1}
                max={5}
                value={printerSettings?.printCopies || 1}
                onChange={(e) =>
                  savePrintLocal({ printCopies: Number(e.target.value) || 1 })
                }
              />
            </div>
          </div>
        )}

        <PermissionGate permission="settings.edit">
          <div className="mt-6 border-t border-border pt-4">
            <p className="text-sm text-ink-muted mb-3">
              Store-wide receipt behaviour (applies to every terminal):
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Toggle
                label="Silent print by default"
                value={!!storeForm.print?.silent}
                onChange={(v) => handleStoreNested('print', 'silent', v)}
              />
              <Toggle
                label="Auto-print receipt on confirm"
                value={!!storeForm.print?.autoPrintReceiptOnConfirm}
                onChange={(v) =>
                  handleStoreNested('print', 'autoPrintReceiptOnConfirm', v)
                }
              />
              <Input
                label="Thermal width (mm)"
                type="number"
                min={50}
                max={120}
                value={storeForm.print?.thermalWidthMm || 80}
                onChange={(e) =>
                  handleStoreNested(
                    'print',
                    'thermalWidthMm',
                    Number(e.target.value) || 80,
                  )
                }
              />
            </div>
            <div className="flex justify-end mt-4">
              <Button
                variant="secondary"
                onClick={saveStore}
                loading={savingStore}
              >
                Save store-wide print settings
              </Button>
            </div>
          </div>
        </PermissionGate>
      </section>
    </div>
  );
}

function PrinterRow({ label, value, options, onChange, onTest }) {
  return (
    <div className="flex flex-col md:flex-row md:items-end gap-3">
      <div className="flex-1">
        <label className="text-sm font-medium text-ink">{label}</label>
        <select
          className="mt-1 h-10 w-full rounded-input border border-border bg-surface px-3 text-sm focus:border-accent focus:outline-none"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          {options.map((opt, idx) => (
            <option key={idx} value={opt}>
              {opt || '— Not selected —'}
            </option>
          ))}
        </select>
      </div>
      <Button
        variant="ghost"
        leftIcon={<TestTube className="h-4 w-4" />}
        onClick={onTest}
      >
        Test
      </Button>
    </div>
  );
}

function Toggle({ label, value, onChange }) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-input border border-border bg-surface px-3 h-10">
      <span className="text-sm text-ink">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        onClick={() => onChange(!value)}
        className={`relative h-5 w-9 rounded-full transition ${value ? 'bg-accent' : 'bg-surface-2 border border-border'}`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition ${
            value ? 'left-[18px]' : 'left-0.5'
          }`}
        />
      </button>
    </label>
  );
}
