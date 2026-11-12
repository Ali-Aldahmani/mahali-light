const express = require('express');
const ctrl = require('../controllers/storeDataController');
const { requireAuth } = require('../middleware/auth');
const { requirePermission, requireAnyPermission } = require('../middleware/permissions');

// Lost sales, promotions, store calendar and opening hours (controllers/storeDataController.js).
const router = express.Router();
router.use(requireAuth());

// A cashier records that a customer wanted an item that was out of stock.
router.post('/lost-sales', requirePermission('invoice.create'), ctrl.recordLostSale);
router.get('/lost-sales', requireAnyPermission('analytics.view_reorder', 'analytics.view'), ctrl.listLostSales);

router.get('/promotions', requireAnyPermission('product.view', 'analytics.view'), ctrl.listPromotions);
router.post('/promotions', requirePermission('product.edit'), ctrl.createPromotion);
router.post('/promotions/:id/end', requirePermission('product.edit'), ctrl.endPromotion);

router.get('/store-calendar', requireAnyPermission('settings.view', 'analytics.view'), ctrl.listEvents);
router.post('/store-calendar', requirePermission('settings.edit'), ctrl.createEvent);
router.put('/store-calendar/:id', requirePermission('settings.edit'), ctrl.updateEvent);

router.get('/store-hours', requireAnyPermission('settings.view', 'analytics.view'), ctrl.getHours);
router.post('/store-hours', requirePermission('settings.edit'), ctrl.setHours);

module.exports = router;
