import { create } from 'zustand';

interface SetupState {
  completed: boolean | null;
  setCompleted: (v: boolean) => void;
}

export const useSetupStore = create<SetupState>()((set) => ({
  completed: null,
  setCompleted: (v) => set({ completed: v }),
}));
