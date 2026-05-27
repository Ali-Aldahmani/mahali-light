const express = require('express');
const multer = require('multer');
const ctrl = require('../controllers/bugReportsController');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');

const router = express.Router();

const screenshotUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
});

// Anyone authenticated can file a bug report.
router.post(
  '/',
  requireAuth(),
  screenshotUpload.single('screenshot'),
  ctrl.submit,
);

router.use(requireAuth());
router.use(requirePermission('bug.view_all'));

router.get('/', ctrl.list);
router.get('/:id', ctrl.getOne);
router.put('/:id', requirePermission('bug.manage'), ctrl.update);
router.post('/:id/comments', requirePermission('bug.manage'), ctrl.addComment);

module.exports = router;
