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

module.exports = { getUploadsRoot, ensureProductDir, toRelative, toAbsolute };
