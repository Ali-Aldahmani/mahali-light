import { toast } from '../store/toastStore.js';

export function hasElectronPrint() {
  return false;
}

export async function listLocalPrinters() {
  return [
    { name: 'EPSON TM-T88VI (Thermal POS Receipt 80mm)', isDefault: true },
    { name: 'HP LaserJet Pro M404dn (Showroom A4)', isDefault: false },
    { name: 'Canon imageRUNNER 2625i (Accounts Office)', isDefault: false },
  ];
}

export function getLocalPrintSettings() {
  return Promise.resolve({
    defaultPrinter: 'HP LaserJet Pro M404dn (Showroom A4)',
    thermalPrinter: 'EPSON TM-T88VI (Thermal POS Receipt 80mm)',
    silentPrint: false,
    autoPrintReceipt: true,
    printCopies: 1,
  });
}

export function saveLocalPrintSettings(patch) {
  toast.success('Print settings saved in memory');
  return Promise.resolve(patch);
}

export async function printInvoice(invoiceId, options = {}) {
  toast.success(`Sent invoice to printer: ${options.printer || 'Default Printer'}`);
  return { success: true };
}

export async function printReceipt(invoiceId, options = {}) {
  toast.success(`Printing thermal receipt (Invoice #${invoiceId})`);
  return { success: true };
}

export function listServerPrinters() {
  return listLocalPrinters();
}
