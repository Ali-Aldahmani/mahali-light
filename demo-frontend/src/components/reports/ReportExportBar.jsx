import ExportButton from './ExportButton.jsx';

// Convenience wrapper that lays out all three export buttons. Each one
// renders to null automatically when the user lacks the matching permission.
export default function ReportExportBar({ type, params = {}, className = '' }) {
  return (
    <div className={`flex flex-wrap gap-2 ${className}`}>
      <ExportButton type={type} format="pdf" params={params} />
      <ExportButton type={type} format="csv" params={params} />
      <ExportButton type={type} format="excel" params={params} />
    </div>
  );
}
