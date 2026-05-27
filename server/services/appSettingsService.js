const { query } = require('../db/postgres');
const { getStoreSettings, updateStoreSettings } = require('../config/storeSettings');

const ROW_SQL = `SELECT * FROM app_settings ORDER BY updated_at DESC LIMIT 1`;

function shape(row) {
  if (!row) return null;
  return {
    id: row.id,
    store_name: row.store_name,
    store_name_ar: row.store_name_ar,
    store_address: row.store_address,
    store_phone: row.store_phone,
    store_email: row.store_email,
    store_trn: row.store_trn,
    store_logo_path: row.store_logo_path,
    store_currency: row.store_currency,
    store_timezone: row.store_timezone,
    vat_enabled: row.vat_enabled,
    vat_rate: Number(row.vat_rate),
    vat_number: row.vat_number,
    invoice_prefix: row.invoice_prefix,
    invoice_footer_note: row.invoice_footer_note,
    invoice_terms: row.invoice_terms,
    invoice_auto_print: row.invoice_auto_print,
    invoice_draft_expiry_hours: row.invoice_draft_expiry_hours,
    pos_require_customer: row.pos_require_customer,
    pos_allow_negative_stock: row.pos_allow_negative_stock,
    pos_default_payment_method: row.pos_default_payment_method,
    low_stock_threshold_default: row.low_stock_threshold_default,
    dead_stock_days: row.dead_stock_days,
    reorder_safety_buffer_days: row.reorder_safety_buffer_days,
    work_week_start: row.work_week_start,
    weekend_days: row.weekend_days || [5, 6],
    fiscal_year_start_month: row.fiscal_year_start_month,
    sidebar_collapsed: row.sidebar_collapsed,
    language: row.language,
    setup_completed: row.setup_completed,
    setup_completed_at: row.setup_completed_at,
    updated_at: row.updated_at,
  };
}

async function getSettings() {
  const { rows } = await query(ROW_SQL);
  if (!rows.length) {
    await query(`INSERT INTO app_settings DEFAULT VALUES`);
    const again = await query(ROW_SQL);
    return shape(again.rows[0]);
  }
  return shape(rows[0]);
}

async function isSetupComplete() {
  const s = await getSettings();
  return Boolean(s?.setup_completed);
}

const PATCH_MAP = {
  store_name: 'store_name',
  store_name_ar: 'store_name_ar',
  store_address: 'store_address',
  store_phone: 'store_phone',
  store_email: 'store_email',
  store_trn: 'store_trn',
  store_logo_path: 'store_logo_path',
  store_currency: 'store_currency',
  store_timezone: 'store_timezone',
  vat_enabled: 'vat_enabled',
  vat_rate: 'vat_rate',
  vat_number: 'vat_number',
  invoice_prefix: 'invoice_prefix',
  invoice_footer_note: 'invoice_footer_note',
  invoice_terms: 'invoice_terms',
  invoice_auto_print: 'invoice_auto_print',
  invoice_draft_expiry_hours: 'invoice_draft_expiry_hours',
  pos_require_customer: 'pos_require_customer',
  pos_allow_negative_stock: 'pos_allow_negative_stock',
  pos_default_payment_method: 'pos_default_payment_method',
  low_stock_threshold_default: 'low_stock_threshold_default',
  dead_stock_days: 'dead_stock_days',
  reorder_safety_buffer_days: 'reorder_safety_buffer_days',
  work_week_start: 'work_week_start',
  weekend_days: 'weekend_days',
  fiscal_year_start_month: 'fiscal_year_start_month',
  sidebar_collapsed: 'sidebar_collapsed',
  language: 'language',
};

async function updateSettings(patch, { section = null, userId = null } = {}) {
  const fields = [];
  const params = [];
  for (const [k, col] of Object.entries(PATCH_MAP)) {
    if (patch[k] !== undefined) {
      if (k === 'weekend_days') {
        params.push(JSON.stringify(patch[k]));
        fields.push(`${col} = $${params.length}::jsonb`);
      } else {
        params.push(patch[k]);
        fields.push(`${col} = $${params.length}`);
      }
    }
  }
  if (!fields.length) return getSettings();
  fields.push('updated_at = NOW()');
  const sql = `UPDATE app_settings SET ${fields.join(', ')}
                WHERE id = (SELECT id FROM app_settings ORDER BY updated_at DESC LIMIT 1)
              RETURNING *`;
  const { rows } = await query(sql, params);
  const shaped = shape(rows[0]);

  // Keep legacy store settings JSON in sync for PDF layer.
  try {
    updateStoreSettings({
      storeName: shaped.store_name,
      storeAddress: shaped.store_address,
      storePhone: shaped.store_phone,
      storeEmail: shaped.store_email,
      storeTRN: shaped.store_trn || shaped.vat_number,
      logoPath: shaped.store_logo_path,
      invoiceFooterNote: shaped.invoice_footer_note,
      invoiceTerms: shaped.invoice_terms,
      currency: shaped.store_currency,
      vatRate: shaped.vat_rate,
      timezone: shaped.store_timezone,
      print: {
        autoPrintReceiptOnConfirm: shaped.invoice_auto_print,
      },
    });
  } catch (_e) {
    /* best-effort */
  }

  return { settings: shaped, section, userId };
}

async function setLogoPath(relPath) {
  return updateSettings({ store_logo_path: relPath }, { section: 'store_profile' });
}

async function clearLogo() {
  return updateSettings({ store_logo_path: null }, { section: 'store_profile' });
}

async function markSetupComplete() {
  const { rows } = await query(
    `UPDATE app_settings
        SET setup_completed = true,
            setup_completed_at = NOW(),
            updated_at = NOW()
      WHERE id = (SELECT id FROM app_settings ORDER BY updated_at DESC LIMIT 1)
      RETURNING *`,
  );
  return shape(rows[0]);
}

/** Public-safe subset for clients + setup wizard. */
async function getPublicSettings() {
  const s = await getSettings();
  return {
    setup_completed: s.setup_completed,
    store_name: s.store_name,
    store_currency: s.store_currency,
    store_timezone: s.store_timezone,
    vat_enabled: s.vat_enabled,
    vat_rate: s.vat_rate,
    language: s.language,
  };
}

module.exports = {
  getSettings,
  getPublicSettings,
  isSetupComplete,
  updateSettings,
  setLogoPath,
  clearLogo,
  markSetupComplete,
  shape,
};
