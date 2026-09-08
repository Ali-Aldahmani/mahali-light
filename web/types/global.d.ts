export {};

/**
 * Optional bridge exposed by the legacy Electron shell's preload script.
 * Every access must be optional-chained — the native Next.js frontend runs
 * fully in plain browsers where `window.electron` is undefined (see
 * docs/web-migration/ELECTRON_EXIT_MATRIX.md).
 */
interface ElectronBridge {
  serverIp?: string;
  serverPort?: number | string;
  serverUseHttps?: boolean;
  pcIdentifier?: string;
  mode?: 'server' | 'client' | string;

  getConfig?: () => Promise<any>;
  setConfig?: (patch: Record<string, any>) => Promise<void>;
  toggleFullscreen?: () => void;
  getSystemInfo?: () => Promise<any>;
  captureScreenshot?: () => Promise<string>;

  getPrinters?: () => Promise<Array<{ name: string }>>;
  getPrintSettings?: () => Promise<{
    defaultPrinter: string | null;
    thermalPrinter: string | null;
    silentPrint: boolean;
    autoPrintReceipt: boolean;
    printCopies: number;
  }>;
  setPrintSettings?: (patch: Record<string, any>) => Promise<any>;
  printInvoice?: (opts: {
    invoiceId: string | number;
    token?: string | null;
    printer?: string;
    silent?: boolean;
    copies?: number;
  }) => Promise<any>;
  printReceipt?: (opts: {
    invoiceId: string | number;
    token?: string | null;
    printer?: string;
    silent?: boolean;
    copies?: number;
  }) => Promise<any>;

  backupDownload?: (opts: {
    url: string;
    token?: string | null;
    filename: string;
    jobId: string | number;
  }) => Promise<any>;
  downloadPdf?: (opts: { url: string; token?: string | null; filename: string }) => Promise<any>;
  notifyDesktop?: (opts: { title: string; body: string; severity?: string }) => Promise<any>;
}

declare global {
  interface Window {
    electron?: ElectronBridge;
  }
}
