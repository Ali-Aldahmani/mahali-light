import { create } from 'zustand';
import { getTodayAttendance, listCorrections } from '../services/attendanceService.js';
import { listLeaves } from '../services/leaveService.js';

export const useAttendanceStore = create((set, get) => ({
  today: null,
  pendingCorrections: [],
  pendingLeaves: [],
  loading: false,
  lastError: null,

  refreshToday: async () => {
    try {
      set({ loading: true, lastError: null });
      const today = await getTodayAttendance();
      set({ today });
    } catch (err) {
      set({ lastError: err.message || 'Failed to load today.' });
    } finally {
      set({ loading: false });
    }
  },

  refreshPending: async () => {
    try {
      const [corr, leaves] = await Promise.all([
        listCorrections({ status: 'pending', limit: 50 }).catch(() => ({ data: [] })),
        listLeaves({ status: 'pending', limit: 50 }).catch(() => ({ data: [] })),
      ]);
      set({
        pendingCorrections: corr?.data || [],
        pendingLeaves: leaves?.data || [],
      });
    } catch (_e) {
      // best-effort
    }
  },

  refreshAll: async () => {
    await Promise.all([get().refreshToday(), get().refreshPending()]);
  },

  // Apply a realtime check-in/out event onto today's snapshot so the Today
  // tab updates instantly without a refetch.
  applyAttendanceEvent: (event) => {
    const today = get().today;
    if (!today) return;
    const employees = (today.employees || []).map((e) => {
      if (e.employeeId !== event.employeeId) return e;
      if (event.kind === 'checked_in') {
        return {
          ...e,
          checkIn: event.time,
          checkInMethod: 'app_login',
          status: event.status || 'present',
          lateMinutes: event.lateMinutes || 0,
        };
      }
      if (event.kind === 'checked_out') {
        return {
          ...e,
          checkOut: event.time,
          checkOutMethod: event.method || 'app_logout',
          workingHours: event.workingHours || e.workingHours,
        };
      }
      return e;
    });

    // Recompute counters because a status can change.
    const counters = { present: 0, late: 0, absent: 0, leave: 0, notCheckedIn: 0 };
    for (const e of employees) {
      if (e.status === 'present') counters.present += 1;
      else if (e.status === 'late') counters.late += 1;
      else if (e.status === 'absent') counters.absent += 1;
      else if (e.status === 'leave') counters.leave += 1;
      else counters.notCheckedIn += 1;
    }
    set({ today: { ...today, employees, counters } });
  },
}));
