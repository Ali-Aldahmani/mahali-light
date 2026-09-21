'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, FileText, Sheet, FileSpreadsheet, Loader2 } from 'lucide-react';
import { toast } from '@/store/toastStore';
import { useAuthStore } from '@/store/authStore';
import { downloadExport } from '@/services/reportService';

const FORMATS = [
  { value: 'pdf', label: 'PDF', icon: FileText, perm: 'report.export_pdf' },
  { value: 'csv', label: 'CSV', icon: Sheet, perm: 'report.export_csv' },
  { value: 'excel', label: 'Excel', icon: FileSpreadsheet, perm: 'report.export_excel' },
];

// A single button with its own PDF/CSV/Excel dropdown — used for the
// Reports hub's "quick" shop-specific report shortcuts (Product Inventory,
// Costing, Monthly Summary), as distinct from ReportExportBar's three
// separate buttons on a report's own detail page.
export default function QuickReportButton({
  type,
  label,
  params = {},
}: {
  type: string;
  label: string;
  params?: Record<string, any>;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const hasPermission = useAuthStore((s) => s.hasPermission);

  const formats = FORMATS.filter((f) => hasPermission(f.perm));

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  if (!formats.length) return null;

  async function pick(format: string) {
    setOpen(false);
    setLoading(true);
    try {
      const res = await downloadExport(type, format, params);
      toast.success(`${label} downloaded (${res.filename}).`);
    } catch (err: any) {
      toast.error(err.message || 'Export failed.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={loading}
        className="inline-flex items-center gap-1.5 rounded-input border border-border bg-surface px-3 py-2 text-sm font-medium text-ink hover:bg-surface-2 disabled:opacity-60"
      >
        {loading ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
        {label}
        <ChevronDown size={14} className="text-ink-muted" />
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 w-40 overflow-hidden rounded-input border border-border bg-surface shadow-pop">
          {formats.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => pick(f.value)}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-2"
            >
              <f.icon size={14} className="text-ink-muted" />
              {f.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
