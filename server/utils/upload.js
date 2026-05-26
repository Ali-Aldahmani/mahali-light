const path = require('path');
const fs = require('fs');
const multer = require('multer');
const sharp = require('sharp');
const { AppError, ERROR_CODES } = require('../../shared/errorCodes');
const { ensureProductDir, toAbsolute, toRelative } = require('./paths');

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp']);

// In-memory upload (we re-encode through sharp before persisting).
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED.has(file.mimetype)) {
      return cb(
        new AppError(
          ERROR_CODES.VALIDATION_FAILED,
          'Only jpg, png or webp images are allowed.',
          { status: 400 },
        ),
      );
    }
    cb(null, true);
  },
});

// Compress an in-memory buffer to a 800x800 max webp file under the product dir.
async function saveProductImage({ productId, file, replacePath = null, suffix = '' }) {
  if (!file) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'No image uploaded.', {
      status: 400,
    });
  }

  const dir = ensureProductDir(productId);
  const filename = `${Date.now()}${suffix ? `-${suffix}` : ''}.webp`;
  const absPath = path.join(dir, filename);

  await sharp(file.buffer)
    .rotate()
    .resize({ width: 800, height: 800, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82 })
    .toFile(absPath);

  if (replacePath) {
    const old = toAbsolute(replacePath);
    if (old && fs.existsSync(old)) {
      try {
        fs.unlinkSync(old);
      } catch (_err) {
        // ignore
      }
    }
  }

  return toRelative(absPath);
}

function deleteImageFile(relPath) {
  if (!relPath) return;
  const abs = toAbsolute(relPath);
  if (abs && fs.existsSync(abs)) {
    try {
      fs.unlinkSync(abs);
    } catch (_err) {
      // ignore
    }
  }
}

// Handles multer errors gracefully into our standard error envelope.
function uploadSingle(fieldName) {
  return (req, res, next) => {
    upload.single(fieldName)(req, res, (err) => {
      if (!err) return next();
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        return next(
          new AppError(
            ERROR_CODES.VALIDATION_FAILED,
            'Image is too large. Maximum size is 5 MB.',
            { status: 400 },
          ),
        );
      }
      return next(err);
    });
  };
}

module.exports = { uploadSingle, saveProductImage, deleteImageFile };
