const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { z } = require('zod');
const { query } = require('../db/postgres');
const { ok } = require('../utils/response');
const {
  getStoreSettings,
  updateStoreSettings,
  setLogoPath,
  clearLogo,
} = require('../config/storeSettings');
const { ensureStoreDir, toRelative, toAbsolute } = require('../utils/paths');
const { AppError, ERROR_CODES } = require('../../shared/errorCodes');
const { logActivity } = require('../utils/activityLog');

// -- key/value settings (existing) --------------------------------------

async function list(_req, res, next) {
  try {
    const { rows } = await query(
      `SELECT key, value, description, updated_at FROM settings ORDER BY key`,
    );
    return ok(
      res,
      rows.map((r) => ({
        key: r.key,
        value: r.value,
        description: r.description,
        updatedAt: r.updated_at,
      })),
    );
  } catch (err) {
    next(err);
  }
}

async function getOne(req, res, next) {
  try {
    const { rows } = await query(
      `SELECT key, value, description, updated_at FROM settings WHERE key = $1`,
      [req.params.key],
    );
    if (!rows.length) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, { status: 404 });
    }
    return ok(res, {
      key: rows[0].key,
      value: rows[0].value,
      description: rows[0].description,
      updatedAt: rows[0].updated_at,
    });
  } catch (err) {
    next(err);
  }
}

const updateSchema = z.object({ value: z.any() });

async function update(req, res, next) {
  try {
    const body = updateSchema.parse(req.body || {});
    const { key } = req.params;

    const { rows: existing } = await query(`SELECT key FROM settings WHERE key = $1`, [
      key,
    ]);
    if (!existing.length) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, undefined, { status: 404 });
    }

    await query(
      `UPDATE settings
          SET value = $1::jsonb,
              updated_at = NOW(),
              updated_by = $2
        WHERE key = $3`,
      [JSON.stringify(body.value), req.user.id, key],
    );

    await logActivity({
      entityType: 'setting',
      entityId: null,
      action: 'settings.updated',
      performedBy: req.user.id,
      notes: key,
      newValue: { key, value: body.value },
    });

    return ok(res, { key, value: body.value });
  } catch (err) {
    next(err);
  }
}

// -- store branding (Phase 7) -------------------------------------------

const STORE_SETTINGS_SCHEMA = z
  .object({
    storeName: z.string().min(1).max(120).optional(),
    storeAddress: z.string().max(300).optional(),
    storePhone: z.string().max(40).optional(),
    storeEmail: z
      .string()
      .email()
      .or(z.literal(''))
      .optional()
      .transform((v) => (v === '' ? null : v)),
    storeTRN: z.string().max(40).optional(),
    invoiceFooterNote: z.string().max(300).optional(),
    invoiceTerms: z.string().max(800).optional(),
    poFooterNote: z.string().max(400).optional(),
    currency: z.string().min(2).max(8).optional(),
    vatRate: z.number().min(0).max(100).optional(),
    timezone: z.string().max(40).optional(),
    print: z
      .object({
        silent: z.boolean().optional(),
        autoPrintReceiptOnConfirm: z.boolean().optional(),
        thermalWidthMm: z.number().int().min(50).max(120).optional(),
      })
      .partial()
      .optional(),
  })
  .partial();

async function getStore(_req, res, next) {
  try {
    res.json({ success: true, data: getStoreSettings() });
  } catch (err) {
    next(err);
  }
}

async function updateStore(req, res, next) {
  try {
    const parsed = STORE_SETTINGS_SCHEMA.parse(req.body || {});
    const updated = updateStoreSettings(parsed);
    await logActivity({
      entityType: 'setting',
      entityId: null,
      action: 'settings.updated',
      performedBy: req.user?.id,
      newValue: parsed,
      notes: 'store',
    });
    res.json({ success: true, data: updated });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return next(
        new AppError(
          ERROR_CODES.VALIDATION_FAILED,
          err.errors[0]?.message || 'Invalid settings.',
          { status: 400, details: err.errors },
        ),
      );
    }
    next(err);
  }
}

async function uploadLogo(req, res, next) {
  try {
    if (!req.file) {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'No logo uploaded.', {
        status: 400,
      });
    }
    const dir = ensureStoreDir();
    // SVGs are stored as-is to preserve vector data. Raster formats go
    // through sharp for size/format normalisation.
    const isSvg = req.file.mimetype === 'image/svg+xml';
    const filename = isSvg ? 'logo.svg' : 'logo.png';
    const targetPath = path.join(dir, filename);

    if (isSvg) {
      fs.writeFileSync(targetPath, req.file.buffer);
    } else {
      await sharp(req.file.buffer)
        .rotate()
        .resize({
          width: 480,
          height: 240,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .png({ compressionLevel: 9 })
        .toFile(targetPath);
    }

    const rel = toRelative(targetPath);
    const updated = setLogoPath(rel);

    await logActivity({
      entityType: 'setting',
      entityId: null,
      action: 'settings.updated',
      performedBy: req.user?.id,
      newValue: { logoPath: rel },
      notes: 'logo',
    });

    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
}

async function deleteLogo(req, res, next) {
  try {
    const current = getStoreSettings();
    if (current.logoPath) {
      const abs = toAbsolute(current.logoPath);
      if (abs && fs.existsSync(abs)) {
        try {
          fs.unlinkSync(abs);
        } catch (_e) {
          // ignore
        }
      }
    }
    const updated = clearLogo();
    await logActivity({
      entityType: 'setting',
      entityId: null,
      action: 'settings.updated',
      performedBy: req.user?.id,
      notes: 'logo_removed',
    });
    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  list,
  getOne,
  update,
  getStore,
  updateStore,
  uploadLogo,
  deleteLogo,
};
