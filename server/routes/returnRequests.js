const express = require('express');
const ctrl = require('../controllers/returnRequestsController');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');

const router = express.Router();
router.use(requireAuth());

router.get('/summary', requirePermission('return.request'), ctrl.summary);
router.get('/lookup', requirePermission('return.request'), ctrl.lookup);
router.get('/', requirePermission('return.request'), ctrl.list);
router.post('/', requirePermission('return.request'), ctrl.create);
router.get('/:id', requirePermission('return.request'), ctrl.getOne);
router.put('/:id/approve', requirePermission('return.approve'), ctrl.approve);
router.put('/:id/reject', requirePermission('return.approve'), ctrl.reject);
router.put('/:id/cancel', requirePermission('return.request'), ctrl.cancel);

module.exports = router;
