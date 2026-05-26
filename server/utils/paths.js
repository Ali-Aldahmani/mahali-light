const path = require('path');
const fs = require('fs');

// Resolves to <repo>/uploads — overridable via UPLOADS_DIR env var.
function getUploadsRoot() {
  const root =
    process.env.UPLOADS_DIR || path.resolve(__dirname, '..', '..', 'uploads');
  if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });
  return root;
}

function ensureProductDir(productId) {
  const dir = path.join(getUploadsRoot(), 'products', productId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function ensurePurchaseOrderDir(poId) {
  const dir = path.join(getUploadsRoot(), 'purchase-orders', poId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function ensureSupplierPaymentDir(paymentId) {
  const dir = path.join(getUploadsRoot(), 'supplier-payments', paymentId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function ensureBillPaymentDir(billPaymentId) {
  const dir = path.join(
    getUploadsRoot(),
    'receipts',
    'bills',
    billPaymentId,
  );
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function ensureExpenseDir(expenseId) {
  const dir = path.join(
    getUploadsRoot(),
    'receipts',
    'expenses',
    expenseId,
  );
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// PDF cache directories. Invoices and POs get their own subfolder so cleanup
// jobs can target each independently. `kind` is e.g. 'invoices', 'purchase-orders', 'reports', 'receipts'.
function ensurePdfDir(kind) {
  const dir = path.join(getUploadsRoot(), 'pdfs', kind);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Store branding assets (logo, signatures). Lives outside the per-document
// dirs so backups can include it without traversing every invoice folder.
function ensureStoreDir() {
  const dir = path.join(getUploadsRoot(), 'store');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Convert an absolute disk path to a forward-slash relative path stored in the DB.
function toRelative(absPath) {
  const root = getUploadsRoot();
  return path
    .relative(root, absPath)
    .split(path.sep)
    .join('/');
}

// Resolve back to an absolute path from a stored relative path.
function toAbsolute(relPath) {
  if (!relPath) return null;
  return path.join(getUploadsRoot(), relPath);
}

module.exports = {
  getUploadsRoot,
  ensureProductDir,
  ensurePurchaseOrderDir,
  ensureSupplierPaymentDir,
  ensureBillPaymentDir,
  ensureExpenseDir,
  ensurePdfDir,
  ensureStoreDir,
  toRelative,
  toAbsolute,
};
