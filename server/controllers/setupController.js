const { z } = require('zod');
const os = require('os');
const { ok, created } = require('../utils/response');
const { AppError, ERROR_CODES } = require('../../shared/errorCodes');
const appSettingsService = require('../services/appSettingsService');
const setupService = require('../services/setupService');
const { logActivity } = require('../utils/activityLog');

async function status(_req, res, next) {
  try {
    const settings = await appSettingsService.getPublicSettings();
    const hasAdmin = await setupService.hasAdminUser();
    const nets = os.networkInterfaces();
    const ips = [];
    for (const iface of Object.values(nets)) {
      for (const addr of iface || []) {
        if (addr.family === 'IPv4' && !addr.internal) ips.push(addr.address);
      }
    }
    ok(res, {
      ...settings,
      has_admin: hasAdmin,
      local_ips: ips,
      server_port: Number(process.env.PORT || 3000),
    });
  } catch (err) {
    next(err);
  }
}

const completeSchema = z.object({
  store: z.object({
    store_name: z.string().min(1),
    store_name_ar: z.string().optional(),
    store_address: z.string().min(1),
    store_phone: z.string().min(1),
    store_email: z.string().email().optional().or(z.literal('')),
    store_trn: z.string().optional(),
  }),
  vat: z.object({
    vat_enabled: z.boolean().default(true),
    vat_rate: z.number().default(5),
    vat_number: z.string().optional(),
  }),
  network: z.object({
    mode: z.enum(['server', 'client']),
    server_ip: z.string().optional(),
    server_port: z.number().optional(),
    pc_identifier: z.string().optional(),
  }),
  admin: z
    .object({
      full_name: z.string().min(1),
      username: z.string().min(3),
      password: z.string().min(6),
    })
    .optional(),
  cash_drawer: z
    .object({
      opening_balance: z.number().min(0),
    })
    .optional(),
  bank: z
    .object({
      bank_name: z.string().optional(),
      account_name: z.string().optional(),
      account_number: z.string().optional(),
      iban: z.string().optional(),
    })
    .optional(),
});

async function complete(req, res, next) {
  try {
    const body = completeSchema.parse(req.body || {});
    const hasAdmin = await setupService.hasAdminUser();
    if (!hasAdmin && !body.admin) {
      throw new AppError(
        ERROR_CODES.VAL_REQUIRED_FIELD,
        'Admin account is required for first-time setup.',
        { status: 400 },
      );
    }
    const settings = await setupService.completeSetup({
      store: body.store,
      vat: body.vat,
      network: body.network,
      admin: body.admin,
      cashDrawer: body.cash_drawer,
      bank: body.bank,
    });
    await logActivity({
      entityType: 'app_settings',
      action: 'setup.completed',
      performedBy: null,
      newValue: { store_name: settings.store_name },
    });
    created(res, settings);
  } catch (err) {
    if (err.code === 'SETUP_ALREADY_DONE') {
      return next(
        new AppError(ERROR_CODES.BIZ_INVALID_STATE, err.message, { status: 409 }),
      );
    }
    next(err);
  }
}

async function testConnection(req, res, next) {
  try {
    ok(res, { ok: true, message: 'Server is reachable.' });
  } catch (err) {
    next(err);
  }
}

module.exports = { status, complete, testConnection };
