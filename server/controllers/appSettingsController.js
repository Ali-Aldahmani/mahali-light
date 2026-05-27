const { z } = require('zod');
const { ok } = require('../utils/response');
const { AppError, ERROR_CODES } = require('../../shared/errorCodes');
const appSettingsService = require('../services/appSettingsService');
const { logActivity } = require('../utils/activityLog');

const patchSchema = z.object({
  section: z.string().optional(),
  store_name: z.string().min(1).max(200).optional(),
  store_name_ar: z.string().max(200).nullable().optional(),
  store_address: z.string().max(500).nullable().optional(),
  store_phone: z.string().max(20).nullable().optional(),
  store_email: z.string().email().or(z.literal('')).nullable().optional(),
  store_trn: z.string().max(50).nullable().optional(),
  store_currency: z.string().max(10).optional(),
  store_timezone: z.string().max(50).optional(),
  vat_enabled: z.boolean().optional(),
  vat_rate: z.number().min(0).max(100).optional(),
  vat_number: z.string().max(50).nullable().optional(),
  invoice_prefix: z.string().max(10).optional(),
  invoice_footer_note: z.string().max(2000).nullable().optional(),
  invoice_terms: z.string().max(4000).nullable().optional(),
  invoice_auto_print: z.boolean().optional(),
  invoice_draft_expiry_hours: z.number().int().min(1).max(168).optional(),
  pos_require_customer: z.boolean().optional(),
  pos_allow_negative_stock: z.boolean().optional(),
  pos_default_payment_method: z.enum(['cash', 'bank', 'credit']).optional(),
  low_stock_threshold_default: z.number().int().min(0).optional(),
  dead_stock_days: z.number().int().min(1).optional(),
  reorder_safety_buffer_days: z.number().int().min(0).optional(),
  work_week_start: z.number().int().min(0).max(6).optional(),
  weekend_days: z.array(z.number().int().min(0).max(6)).optional(),
  fiscal_year_start_month: z.number().int().min(1).max(12).optional(),
  language: z.enum(['en', 'ar']).optional(),
});

async function get(req, res, next) {
  try {
    const s = await appSettingsService.getSettings();
    ok(res, s);
  } catch (err) {
    next(err);
  }
}

async function getPublic(req, res, next) {
  try {
    ok(res, await appSettingsService.getPublicSettings());
  } catch (err) {
    next(err);
  }
}

async function update(req, res, next) {
  try {
    const body = patchSchema.parse(req.body || {});
    const { section, ...patch } = body;
    if (patch.store_email === '') patch.store_email = null;
    const result = await appSettingsService.updateSettings(patch, {
      section,
      userId: req.user.id,
    });
    await logActivity({
      entityType: 'app_settings',
      action: 'settings.updated',
      performedBy: req.user.id,
      notes: section || 'general',
      newValue: patch,
    });
    ok(res, result.settings || result);
  } catch (err) {
    next(err);
  }
}

module.exports = { get, getPublic, update };
