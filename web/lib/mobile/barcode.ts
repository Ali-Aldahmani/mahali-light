// Retail barcode rules shared by the camera and manual-entry paths, so a
// scanned code and a typed code are validated identically.

export type RetailFormat = 'ean_13' | 'ean_8' | 'upc_a' | 'upc_e';

/** BarcodeDetector format names — kept deliberately small. */
export const RETAIL_FORMATS: RetailFormat[] = ['ean_13', 'ean_8', 'upc_a', 'upc_e'];

export type BarcodeCheck =
  | { ok: true; code: string; format: RetailFormat }
  | { ok: false; error: string };

export function sanitizeBarcodeInput(raw: string) {
  return String(raw || '').replace(/\D+/g, '').slice(0, 13);
}

function gs1CheckDigit(body: string) {
  let sum = 0;
  for (let i = body.length - 1, weight = 3; i >= 0; i -= 1, weight = weight === 3 ? 1 : 3) {
    sum += Number(body[i]) * weight;
  }
  return (10 - (sum % 10)) % 10;
}

function hasValidGs1Check(code: string) {
  return gs1CheckDigit(code.slice(0, -1)) === Number(code[code.length - 1]);
}

/** UPC-E (8 digits incl. number system + check) → the UPC-A it abbreviates. */
export function expandUpcE(code: string): string | null {
  if (!/^[01]\d{7}$/.test(code)) return null;
  const ns = code[0];
  const d = code.slice(1, 7);
  const check = code[7];
  const last = d[5];
  let mfr: string;
  let item: string;
  if (last <= '2') {
    mfr = `${d[0]}${d[1]}${last}00`;
    item = `00${d[2]}${d[3]}${d[4]}`;
  } else if (last === '3') {
    mfr = `${d[0]}${d[1]}${d[2]}00`;
    item = `000${d[3]}${d[4]}`;
  } else if (last === '4') {
    mfr = `${d[0]}${d[1]}${d[2]}${d[3]}0`;
    item = `0000${d[4]}`;
  } else {
    mfr = `${d[0]}${d[1]}${d[2]}${d[3]}${d[4]}`;
    item = `0000${last}`;
  }
  return `${ns}${mfr}${item}${check}`;
}

export function validateRetailBarcode(raw: string): BarcodeCheck {
  const code = String(raw || '').trim();
  if (!code) return { ok: false, error: 'Enter the barcode number.' };
  if (!/^\d+$/.test(code)) return { ok: false, error: 'Barcode can contain numbers only.' };

  if (code.length === 13) {
    return hasValidGs1Check(code)
      ? { ok: true, code, format: 'ean_13' }
      : { ok: false, error: 'This barcode number is not valid. Check the digits and try again.' };
  }
  if (code.length === 12) {
    return hasValidGs1Check(code)
      ? { ok: true, code, format: 'upc_a' }
      : { ok: false, error: 'This barcode number is not valid. Check the digits and try again.' };
  }
  if (code.length === 8) {
    if (hasValidGs1Check(code)) return { ok: true, code, format: 'ean_8' };
    const upcA = expandUpcE(code);
    if (upcA && hasValidGs1Check(upcA)) return { ok: true, code, format: 'upc_e' };
    return { ok: false, error: 'This barcode number is not valid. Check the digits and try again.' };
  }
  return { ok: false, error: 'Barcodes have 8, 12 or 13 digits.' };
}
