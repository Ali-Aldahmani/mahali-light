const path = require('path');
const fs = require('fs');
const multer = require('multer');
const sharp = require('sharp');
const { AppError, ERROR_CODES } = require('../../shared/errorCodes');
const {
  ensureProductDir,
  ensurePurchaseOrderDir,
  ensureSupplierPaymentDir,
  toAbsolute,
  toRelative,
} = require('./paths');

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_DOC_BYTES = 10 * 1024 * 1024;
const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp']);
const ALLOWED_DOCS = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
]);

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

// Generic document upload (PDF + images). Used for supplier invoices,
// payment receipts and any future attachment workflow.
const docUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_DOC_BYTES },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_DOCS.has(file.mimetype)) {
      return cb(
        new AppError(
          ERROR_CODES.VALIDATION_FAILED,
          'Only PDF, JPG, PNG or WEBP files are allowed.',
          { status: 400 },
        ),
      );
    }
    cb(null, true);
  },
});

function uploadDocSingle(fieldName) {
  return (req, res, next) => {
    docUpload.single(fieldName)(req, res, (err) => {
      if (!err) return next();
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        return next(
          new AppError(
            ERROR_CODES.VALIDATION_FAILED,
            'File is too large. Maximum size is 10 MB.',
            { status: 400 },
          ),
        );
      }
      return next(err);
    });
  };
}

function sanitizeFilename(name) {
  return String(name || 'file')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .slice(0, 80);
}

// Save a document (PDF or image) under a per-entity directory, returning its
// relative path for storage. Images are compressed; PDFs are stored as-is.
async function saveAttachment({ targetDir, file, suffix = '' }) {
  if (!file) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'No file uploaded.', {
      status: 400,
    });
  }

  const stamp = Date.now();
  const base = sanitizeFilename(
    file.originalname.replace(/\.[^.]+$/, '') || 'file',
  );
  let absPath;

  if (file.mimetype === 'application/pdf') {
    const filename = `${stamp}-${suffix ? suffix + '-' : ''}${base}.pdf`;
    absPath = path.join(targetDir, filename);
    fs.writeFileSync(absPath, file.buffer);
  } else {
    const filename = `${stamp}-${suffix ? suffix + '-' : ''}${base}.webp`;
    absPath = path.join(targetDir, filename);
    await sharp(file.buffer)
      .rotate()
      .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toFile(absPath);
  }

  return {
    relativePath: toRelative(absPath),
    originalName: file.originalname,
    mimeType: file.mimetype,
    size: file.size,
  };
}

async function savePurchaseOrderAttachment({ poId, file }) {
  const dir = ensurePurchaseOrderDir(poId);
  return saveAttachment({ targetDir: dir, file });
}

async function saveSupplierPaymentReceipt({ paymentId, file }) {
  const dir = ensureSupplierPaymentDir(paymentId);
  return saveAttachment({ targetDir: dir, file });
}

function deleteAttachmentFile(relPath) {
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

module.exports = {
  uploadSingle,
  saveProductImage,
  deleteImageFile,
  uploadDocSingle,
  saveAttachment,
  savePurchaseOrderAttachment,
  saveSupplierPaymentReceipt,
  deleteAttachmentFile,
};
