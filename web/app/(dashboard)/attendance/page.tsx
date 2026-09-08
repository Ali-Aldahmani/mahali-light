'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { CalendarClock, CalendarRange, RefreshCcw, Plane } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import Tabs from '@/components/ui/Tabs';
import RequirePermission from '@/components/guards/RequirePermission';
import { useAuthStore } from '@/store/authStore';
import { useAttendanceStore } from '@/store/attendanceStore';
import { onAttendanceEvent, onCorrectionEvent, onLeaveEvent } from '@/store/socketStore';
import TodayTab from '@/components/attendance/tabs/TodayTab';
import MonthlyTab from '@/components/attendance/tabs/MonthlyTab';
import CorrectionsTab from '@/components/attendance/tabs/CorrectionsTab';
import LeavesTab from '@/components/attendance/tabs/LeavesTab';

const ALLOWED = ['today', 'monthly', 'corrections', 'leaves'];

// Attendance hub — picks the right default tab based on permissions. Users
// without view_all (i.e. cashiers/warehouse) land on Corrections/Leaves since
// they can only see/file their own data.
function defaultTabFor(perms: string[]) {
  if (perms.includes('attendance.view_all')) return 'today';
  return 'leaves';
}

function AttendancePageInner() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tabFromQuery = searchParams.get('tab');
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const permissions = useAuthStore((s) => s.permissions || []);
  const refreshToday = useAttendanceStore((s) => s.refreshToday);
  const refreshPending = useAttendanceStore((s) => s.refreshPending);
  const applyAttendanceEvent = useAttendanceStore((s) => s.applyAttendanceEvent);
  const pendingCorrections = useAttendanceStore((s) => s.pendingCorrections);
  const pendingLeaves = useAttendanceStore((s) => s.pendingLeaves);

  const [tab, setTab] = useState(() =>
    tabFromQuery && ALLOWED.includes(tabFromQuery) ? tabFromQuery : defaultTabFor(permissions),
  );

  useEffect(() => {
    if (hasPermission('attendance.view_all')) refreshToday();
    refreshPending();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasPermission, refreshToday, refreshPending]);

  useEffect(() => {
    const unsubA = onAttendanceEvent((p: any) => {
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

  function switchTab(next: string) {
    setTab(next);
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', next);
    router.replace(`${pathname}?${params.toString()}`);
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
  ].filter(Boolean) as { value: string; label: string; icon: React.ReactNode; count?: number | null }[];

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

export default function AttendancePage() {
  return (
    <RequirePermission permission="attendance.view_own">
      <AttendancePageInner />
    </RequirePermission>
  );
}
