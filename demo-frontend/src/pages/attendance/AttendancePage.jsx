import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CalendarClock, CalendarRange, RefreshCcw, Plane } from 'lucide-react';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Tabs from '../../components/ui/Tabs.jsx';
import { useAuthStore } from '../../store/authStore.js';
import { useAttendanceStore } from '../../store/attendanceStore.js';
import {
  onAttendanceEvent,
  onCorrectionEvent,
  onLeaveEvent,
} from '../../store/socketStore.js';
import TodayTab from './tabs/TodayTab.jsx';
import MonthlyTab from './tabs/MonthlyTab.jsx';
import CorrectionsTab from './tabs/CorrectionsTab.jsx';
import LeavesTab from './tabs/LeavesTab.jsx';

const ALLOWED = ['today', 'monthly', 'corrections', 'leaves'];

// Attendance hub — picks the right default tab based on permissions. Users
// without view_all (i.e. cashiers/warehouse) land on Corrections/Leaves since
// they can only see/file their own data.
function defaultTabFor(perms) {
  if (perms.includes('attendance.view_all')) return 'today';
  return 'leaves';
}

export default function AttendancePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabFromQuery = searchParams.get('tab');
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const permissions = useAuthStore((s) => s.permissions || []);
  const refreshToday = useAttendanceStore((s) => s.refreshToday);
  const refreshPending = useAttendanceStore((s) => s.refreshPending);
  const applyAttendanceEvent = useAttendanceStore((s) => s.applyAttendanceEvent);
  const pendingCorrections = useAttendanceStore((s) => s.pendingCorrections);
  const pendingLeaves = useAttendanceStore((s) => s.pendingLeaves);

  const [tab, setTab] = useState(() =>
    ALLOWED.includes(tabFromQuery) ? tabFromQuery : defaultTabFor(permissions),
  );

  useEffect(() => {
    if (hasPermission('attendance.view_all')) refreshToday();
    refreshPending();
  }, [hasPermission, refreshToday, refreshPending]);

  useEffect(() => {
    const unsubA = onAttendanceEvent((p) => {
      if (p.kind === 'checked_in' || p.kind === 'checked_out') {
        applyAttendanceEvent(p);
      } else if (p.kind === 'day_finalized') {
        refreshToday();
      }
    });
    const unsubL = onLeaveEvent(() => refreshPending());
    const unsubC = onCorrectionEvent(() => refreshPending());
    return () => {
      unsubA();
      unsubL();
      unsubC();
    };
  }, [applyAttendanceEvent, refreshToday, refreshPending]);

  function switchTab(next) {
    setTab(next);
    const params = new URLSearchParams(searchParams);
    params.set('tab', next);
    setSearchParams(params, { replace: true });
  }

  const tabs = [
    hasPermission('attendance.view_all')
      ? { value: 'today', label: 'Today', icon: <CalendarClock size={14} /> }
      : null,
    hasPermission('attendance.view_all')
      ? { value: 'monthly', label: 'Monthly sheet', icon: <CalendarRange size={14} /> }
      : null,
    {
      value: 'corrections',
      label: 'Corrections',
      icon: <RefreshCcw size={14} />,
      count: hasPermission('attendance.correction_approve')
        ? pendingCorrections?.length || null
        : null,
    },
    {
      value: 'leaves',
      label: 'Leaves',
      icon: <Plane size={14} />,
      count: hasPermission('attendance.correction_approve')
        ? pendingLeaves?.length || null
        : null,
    },
  ].filter(Boolean);

  return (
    <div>
      <PageHeader
        title="Attendance & Leaves"
        subtitle="Daily roster, monthly sheet, corrections and leave management."
      />
      <Tabs items={tabs} value={tab} onChange={switchTab} className="mb-6" />

      {tab === 'today' && <TodayTab />}
      {tab === 'monthly' && <MonthlyTab />}
      {tab === 'corrections' && <CorrectionsTab />}
      {tab === 'leaves' && <LeavesTab />}
    </div>
  );
}
