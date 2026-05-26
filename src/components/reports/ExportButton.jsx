import { useState } from 'react';
import { FileDown, FileText, Sheet, FileSpreadsheet } from 'lucide-react';
import Button from '../ui/Button.jsx';
import { toast } from '../../store/toastStore.js';
import { useAuthStore } from '../../store/authStore.js';
import { downloadExport } from '../../services/reportService.js';

const FORMAT_META = {
  pdf:   { label: 'PDF',   icon: FileText,        perm: 'report.export_pdf' },
  csv:   { label: 'CSV',   icon: Sheet,           perm: 'report.export_csv' },
  excel: { label: 'Excel', icon: FileSpreadsheet, perm: 'report.export_excel' },
};

export default function ExportButton({ type, format, params = {}, size = 'sm' }) {
  const [loading, setLoading] = useState(false);
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const meta = FORMAT_META[format] || FORMAT_META.pdf;
  const Icon = meta.icon;
  if (!hasPermission(meta.perm)) return null;

  async function trigger() {
    try {
      setLoading(true);
      const res = await downloadExport(type, format, params);
      toast.success(`Report downloaded (${res.filename}).`);
    } catch (err) {
      toast.error(err.message || 'Export failed.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button
      variant="secondary"
      size={size}
      leftIcon={loading ? <FileDown size={14} /> : <Icon size={14} />}
      loading={loading}
      onClick={trigger}
    >
      {meta.label}
    </Button>
  );
}
