import { create } from 'zustand';

export type BarcodeSource = 'camera' | 'manual';

interface MobileAddProductState {
  barcode: string | null;
  source: BarcodeSource | null;
  setBarcode: (barcode: string, source: BarcodeSource) => void;
  reset: () => void;
}

// Carries the barcode from the scan / manual step into Product details so
// both entry paths converge on one creation screen. In-memory on purpose:
// a reload restarts the flow instead of resurrecting a stale code.
export const useMobileAddProductStore = create<MobileAddProductState>()((set) => ({
  barcode: null,
  source: null,
  setBarcode: (barcode, source) => set({ barcode, source }),
  reset: () => set({ barcode: null, source: null }),
}));
