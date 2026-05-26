import { Link } from 'react-router-dom';
import * as Icons from 'lucide-react';
import { cn } from '../../utils/cn.js';

// Pulls a Lucide icon by its name so the catalog in reportService can stay
// declarative (just a string).
function getIcon(name) {
  const Comp = Icons[name];
  return Comp || Icons.FileText;
}

export default function ReportCategoryCard({
  category,
  visibleReports,
  className = '',
}) {
  const Icon = getIcon(category.icon);
  return (
    <div
      className={cn(
        'card p-5 flex flex-col gap-4 hover:shadow-md transition border border-border',
        className,
      )}
    >
      <div className="flex items-center gap-3">
        <div className="h-11 w-11 rounded-card bg-accent-light text-accent flex items-center justify-center">
          <Icon size={22} />
        </div>
        <div>
          <h3 className="text-base font-semibold text-ink">{category.title}</h3>
          <p className="text-xs text-ink-muted">
            {visibleReports.length} report{visibleReports.length === 1 ? '' : 's'}
          </p>
        </div>
      </div>
      <ul className="flex flex-col gap-1 text-sm">
        {visibleReports.map((r) => (
          <li key={r.type}>
            <Link
              to={r.special || `/reports/${category.id}/${r.type}`}
              className="flex items-center justify-between rounded-input px-3 py-2 text-ink hover:bg-surface-2 transition"
            >
              <span>{r.label}</span>
              <Icons.ChevronRight size={14} className="text-ink-muted" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
