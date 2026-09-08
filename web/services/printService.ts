import { apiGet, apiPost } from './http';
import { getApiBase } from '@/lib/config';
import { useAuthStore } from '@/store/authStore';
import { tryHardwarePrint } from './hardwareAgentClient';

// Print integration. Actual printing happens client-side (Electron's
// webContents.print). The server endpoints are used to (re-)generate the
// PDFs and to advertise printer information. When the renderer isn't inside
// Electron, we degrade to "open the PDF in a new tab".

export function hasElectronPrint() {
  return Boolean(
    typeof window !== 'undefined' &&
      window.electron &&
      window.electron.printInvoice,
  );
}

export async function listLocalPrinters() {
  if (window.electron?.getPrinters) {
    try {
      const list = await window.electron.getPrinters();
      return list || [];
    } catch (_e) {
      return [];
    }
  }
  return [];
}

export function getLocalPrintSettings() {
  if (window.electron?.getPrintSettings) {
    return window.electron.getPrintSettings();
  }
  return Promise.resolve({
    defaultPrinter: null,
    thermalPrinter: null,
    silentPrint: false,
    autoPrintReceipt: false,
    printCopies: 1,
  });
}

export function saveLocalPrintSettings(patch: Record<string, any>) {
  if (window.electron?.setPrintSettings) {
    return window.electron.setPrintSettings(patch);
  }
  return Promise.resolve(null);
}

interface PrintOptions {
  printer?: string;
  copies?: number;
  silent?: boolean;
}

export async function printInvoice(invoiceId: string | number, options: PrintOptions = {}) {
  // Ensure the PDF is up to date.
  await apiPost(`/print/invoice/${invoiceId}`, options).catch(() => null);
  const token = useAuthStore.getState().token;
  const hw = await tryHardwarePrint({
    kind: 'invoice',
    invoiceId,
    token,
    printer: options.printer,
    copies: options.copies,
    silent: options.silent,
  });
  if (hw.used) return hw;
  if (hasElectronPrint()) {
    return window.electron!.printInvoice!({
      invoiceId,
      token,
      printer: options.printer,
      silent: options.silent,
      copies: options.copies,
    });
  }
  window.open(`${getApiBase()}/invoices/${invoiceId}/pdf`, '_blank');
  return { success: true, fallback: true };
}

export async function printReceipt(invoiceId: string | number, options: PrintOptions = {}) {
  await apiPost(`/print/receipt/${invoiceId}`, options).catch(() => null);
  const token = useAuthStore.getState().token;
  const hw = await tryHardwarePrint({
    kind: 'receipt',
    invoiceId,
    token,
    printer: options.printer,
    copies: options.copies,
    silent: options.silent,
  });
  if (hw.used) return hw;
  if (hasElectronPrint()) {
    return window.electron!.printReceipt!({
      invoiceId,
      token,
      printer: options.printer,
      silent: options.silent,
      copies: options.copies,
    });
  }
  window.open(`${getApiBase()}/invoices/${invoiceId}/receipt`, '_blank');
  return { success: true, fallback: true };
}

export function listServerPrinters() {
  return apiGet('/print/printers');
}
