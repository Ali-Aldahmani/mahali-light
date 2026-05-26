const express = require('express');
const multer = require('multer');
const ctrl = require('../controllers/settingsController');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');
const { AppError, ERROR_CODES } = require('../../shared/errorCodes');

const router = express.Router();
router.use(requireAuth());

// Store branding (Phase 7). Reading is allowed for any authenticated user
// because the PDF templates and receipts depend on it.
router.get('/store', ctrl.getStore);
router.put('/store', requirePermission('settings.edit'), ctrl.updateStore);

// Logo upload — PNG / JPG / WEBP / SVG, max 2 MB.
const logoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = new Set([
      'image/png',
      'image/jpeg',
      'image/webp',
      'image/svg+xml',
    ]);
    if (!ok.has(file.mimetype)) {
      return cb(
        new AppError(
          ERROR_CODES.VALIDATION_FAILED,
          'Only PNG, JPG, WEBP or SVG logos are allowed.',
          { status: 400 },
        ),
      );
    }
    cb(null, true);
  },
});

router.post(
  '/logo',
  requirePermission('settings.edit'),
  (req, res, next) => {
    logoUpload.single('logo')(req, res, (err) => {
      if (!err) return next();
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        return next(
          new AppError(
            ERROR_CODES.VALIDATION_FAILED,
            'Logo is too large. Maximum size is 2 MB.',
            { status: 400 },
          ),
        );
      }
      return next(err);
    });
  },
  ctrl.uploadLogo,
);
router.delete('/logo', requirePermission('settings.edit'), ctrl.deleteLogo);

// Key/value settings (existing).
router.get('/', requirePermission('settings.view'), ctrl.list);
router.get('/:key', requirePermission('settings.view'), ctrl.getOne);
router.put('/:key', requirePermission('settings.edit'), ctrl.update);

module.exports = router;
