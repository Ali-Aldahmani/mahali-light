// Store-level branding & defaults used by PDFs and printed receipts.
//
// Until Phase 19 formalizes a `settings` table, these values live in this
// config file and are read by the PDF service and templates. Operators can
// edit this file directly; the API also exposes GET/PUT /api/settings/store
// which writes to a JSON override file at <UPLOADS_DIR>/store/settings.json
// — overrides win at runtime.

const fs = require('fs');
const path = require('path');
const { ensureStoreDir } = require('../utils/paths');

const DEFAULTS = {
  storeName: 'Al Noor Electrical',
  storeAddress: 'Shop 12, Industrial Area, RAK, UAE',
  storePhone: '+971 7 123 4567',
  storeEmail: 'info@alnoorelectrical.ae',
  storeTRN: '100123456700003',
  logoPath: null, // relative path within uploads (e.g. 'store/logo.png')
  invoiceFooterNote: 'Thank you for your business!',
  invoiceTerms:
    'Goods once sold are not returnable without prior approval.',
  poFooterNote:
    'Please deliver in original packaging with the PO number visible on each carton.',
  currency: 'AED',
  vatRate: 5,
  timezone: 'Asia/Dubai',
  // Default printer / receipt behaviour — frontend mirrors this in the
  // /settings/printers screen. Cashiers can override per PC.
  print: {
    silent: true,
    autoPrintReceiptOnConfirm: false,
    thermalWidthMm: 80,
  },
};

function overrideFile() {
  return path.join(ensureStoreDir(), 'settings.json');
}

function readOverrides() {
  try {
    const file = overrideFile();
    if (!fs.existsSync(file)) return {};
    const raw = fs.readFileSync(file, 'utf8');
    return raw ? JSON.parse(raw) : {};
  } catch (err) {
    console.warn('[storeSettings] failed to read overrides:', err.message);
    return {};
  }
}

function writeOverrides(next) {
  const file = overrideFile();
  fs.writeFileSync(file, JSON.stringify(next, null, 2));
}

// Deep-ish merge — only one level deep is enough for our shape.
function merge(base, patch) {
  const out = { ...base };
  for (const [k, v] of Object.entries(patch || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = { ...(base[k] || {}), ...v };
    } else if (v !== undefined) {
      out[k] = v;
    }
  }
  return out;
}

function getStoreSettings() {
  return merge(DEFAULTS, readOverrides());
}

function updateStoreSettings(patch) {
  const current = readOverrides();
  const next = merge(current, patch);
  writeOverrides(next);
  return getStoreSettings();
}

function setLogoPath(relPath) {
  return updateStoreSettings({ logoPath: relPath });
}

function clearLogo() {
  return updateStoreSettings({ logoPath: null });
}

module.exports = {
  DEFAULTS,
  getStoreSettings,
  updateStoreSettings,
  setLogoPath,
  clearLogo,
};
