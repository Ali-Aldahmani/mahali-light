import { useState } from 'react';
import { Check, Copy, Printer } from 'lucide-react';
import { cn } from '../../utils/cn.js';
import { toast } from '../../store/toastStore.js';

// Phase 7 will wire the print action to a label printer. For Phase 2 the
// button simply opens the system print preview with a minimal label.
export default function BarcodeDisplay({
  value,
  label,
  size = 'md',
  showPrint = true,
  className = '',
}) {
  const [copied, setCopied] = useState(false);

  if (!value) {
    return <span className="text-ink-muted text-xs">—</span>;
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success('Barcode copied to clipboard');
      setTimeout(() => setCopied(false), 1500);
    } catch (_e) {
      toast.error('Could not copy barcode');
    }
  }

  function printLabel() {
    if (typeof window === 'undefined') return;
    const win = window.open('', '_blank', 'width=480,height=320');
    if (!win) return;
    win.document.write(`
      <html><head><title>Barcode</title>
      <style>
        body { font-family: Inter, Arial, sans-serif; text-align: center;
               padding: 32px; }
        .label { font-size: 13px; color: #6B7280; }
        .code  { font-family: monospace; font-size: 22px; margin-top: 12px;
                 letter-spacing: 2px; }
      </style></head><body>
      <div class="label">${label || ''}</div>
      <div class="code">${value}</div>
      <script>window.onload = () => window.print();</script>
      </body></html>
    `);
    win.document.close();
  }

  return (
    <div
      className={cn(
        'inline-flex items-center gap-2 rounded-input border border-border bg-surface px-2.5 py-1.5',
        size === 'sm' && 'text-xs px-2 py-1',
        className,
      )}
    >
      <code className="font-mono text-ink truncate max-w-[180px]">{value}</code>
      <button
        type="button"
        onClick={copy}
        title="Copy barcode"
        className="text-ink-muted hover:text-ink"
      >
        {copied ? <Check size={13} className="text-success" /> : <Copy size={13} />}
      </button>
      {showPrint && (
        <button
          type="button"
          onClick={printLabel}
          title="Print barcode label"
          className="text-ink-muted hover:text-ink"
        >
          <Printer size={13} />
        </button>
      )}
    </div>
  );
}
