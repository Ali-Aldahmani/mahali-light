import { useMemo } from 'react';
import { Calendar, FileText } from 'lucide-react';
import { Link } from 'react-router-dom';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Button from '../../components/ui/Button.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import ReportCategoryCard from '../../components/reports/ReportCategoryCard.jsx';
import { REPORT_CATEGORIES } from '../../services/reportService.js';
import { useAuthStore } from '../../store/authStore.js';

// Special-case the employee_performance card: it shows whenever a user has
// EITHER "own" or "all" performance permission, so cashiers still get a
// limited entry point to their own KPIs.
function isReportVisible(reportType, hasPermission) {
  if (reportType === 'employee_performance') {
    return (
      hasPermission('report.employee_performance_own') ||
      hasPermission('report.employee_performance_all')
    );
  }
  return null;
}

export default function ReportsHubPage() {
  const hasPermission = useAuthStore((s) => s.hasPermission);

  const visibleCategories = useMemo(
    () =>
      REPORT_CATEGORIES.map((cat) => {
        // If the user holds the category permission, every report is visible.
        // Otherwise we still surface the special-case reports (e.g. own
        // performance) so cashier can find their personal scorecard.
        const categoryAllowed = hasPermission(cat.permission);
        const reports = cat.reports.filter((r) => {
          const special = isReportVisible(r.type, hasPermission);
          if (special != null) return special;
          return categoryAllowed;
        });
        return { ...cat, reports };
      }).filter((cat) => cat.reports.length > 0),
    [hasPermission],
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Reports"
        subtitle="Drill into financial, operational, and HR data. Export as PDF, CSV, or Excel."
        action={
          hasPermission('report.schedule') && (
            <Link to="/reports/scheduled">
              <Button variant="secondary" leftIcon={<Calendar size={16} />}>
                Scheduled Reports
              </Button>
            </Link>
          )
        }
      />

      {visibleCategories.length === 0 ? (
        <EmptyState
          title="No reports available"
          description="Your role doesn't have access to any reports yet. Ask an Admin to grant report permissions."
          icon={<FileText size={32} />}
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {visibleCategories.map((cat) => (
            <ReportCategoryCard
              key={cat.id}
              category={cat}
              visibleReports={cat.reports}
            />
          ))}
        </div>
      )}
    </div>
  );
}
