const express = require('express');
const path = require('path');
const { getUploadsRoot } = require('../utils/paths');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');

// Never expose the uploads root: it also contains PII, reports and PDF caches.
function createFilesRouter() {
  const router = express.Router();
  const root = getUploadsRoot();
  const publicOptions = { index: false, dotfiles: 'deny', maxAge: '7d', fallthrough: false };
  router.use('/products', (req, res, next) => {
    if (!/^\/[a-f0-9-]{36}\/[a-z0-9-]+\.webp$/i.test(req.path)) return res.sendStatus(404);
    return next();
  }, express.static(path.join(root, 'products'), publicOptions));
  router.get('/store/:name', (req, res) => {
    if (!['logo.png', 'logo.svg'].includes(req.params.name)) return res.sendStatus(404);
    return res.sendFile(req.params.name, { root: path.join(root, 'store'), dotfiles: 'deny' });
  });
  router.use(requireAuth());
  const privateMounts = [
    ['/purchase-orders', 'supplier.view'],
    ['/supplier-payments', 'supplier.view'],
    ['/receipts/bills', 'bills.view'],
    ['/receipts/expenses', 'bills.view'],
    ['/bug-reports', 'bug.view_all'],
  ];
  for (const [prefix, permission] of privateMounts) {
    router.use(prefix, requirePermission(permission), express.static(path.join(root, prefix.slice(1)), {
      index: false, dotfiles: 'deny', fallthrough: false, cacheControl: false,
      setHeaders(res) { res.setHeader('Cache-Control', 'private, no-store'); },
    }));
  }
  // Generated PDFs are available only via their existing permission-gated API.
  router.use((_req, res) => res.sendStatus(404));
  return router;
}

module.exports = { createFilesRouter };
