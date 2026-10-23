'use client';

import { useState } from 'react';
import { FileText, Sheet, FileSpreadsheet, Loader2 } from 'lucide-react';
import DropdownMenu from '@/components/ui/dropdown-menu';
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
  const [loading, setLoading] = useState(false);
  const hasPermission = useAuthStore((s) => s.hasPermission);

  const formats = FORMATS.filter((f) => hasPermission(f.perm));
  if (!formats.length) return null;

  async function pick(format: string) {
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
    <DropdownMenu
      // The label morphs to "Downloading…" and back while the export runs.
      label={loading ? 'Downloading…' : label}
      icon={loading ? <Loader2 className="animate-spin" /> : <FileText />}
      disabled={loading}
      items={formats.map((f) => ({
        label: f.label,
        icon: <f.icon />,
        onSelect: () => void pick(f.value),
      }))}
    />
  );
}
