const router = require('express').Router();
const { requireAuth, requireCompanyRole } = require('../middleware/auth');
const ctrl = require('../controllers/companyController');
const asyncHandler = require('../utils/asyncHandler');

router.use(requireAuth, requireCompanyRole(['COMPANY_ADMIN']));

router.get('/orders', asyncHandler(ctrl.getOrders));
router.get('/orders/:id', asyncHandler(ctrl.getOrderDetail));
router.post('/orders/:id/approve', asyncHandler(ctrl.approveOrder));
router.post('/orders/:id/reject', asyncHandler(ctrl.rejectOrder));

module.exports = router;
