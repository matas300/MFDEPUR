const router = require('express').Router();
const { requireAuth, requireAdmin } = require('../middleware/auth');
const adminCtrl = require('../controllers/adminController');
const productCtrl = require('../controllers/productController');
const asyncHandler = require('../utils/asyncHandler');

router.use(requireAuth, requireAdmin);

// Dashboard
router.get('/', asyncHandler(adminCtrl.getDashboard));

// Ordini
router.get('/orders', asyncHandler(adminCtrl.getOrders));
router.get('/orders/export.csv', asyncHandler(adminCtrl.exportOrdersCSV));
router.get('/orders/:id', asyncHandler(adminCtrl.getOrderDetail));
router.post('/orders/:id/status', asyncHandler(adminCtrl.updateOrderStatus));
router.post('/orders/:id/approve', asyncHandler(adminCtrl.approveOrder));
router.post('/orders/:id/reject', asyncHandler(adminCtrl.rejectOrder));

// Aziende clienti
router.get('/companies', asyncHandler(adminCtrl.getCompanies));
router.get('/companies/:id', asyncHandler(adminCtrl.getCompanyDetail));
router.post('/companies/:id/status', asyncHandler(adminCtrl.updateCompanyStatus));

// Prodotti
router.get('/products', asyncHandler(productCtrl.adminList));
router.get('/products/new', asyncHandler(productCtrl.adminNewForm));
router.post('/products', adminCtrl.upload.single('image'), asyncHandler(productCtrl.adminCreate));
router.get('/products/:id/edit', asyncHandler(productCtrl.adminEditForm));
router.post('/products/:id', adminCtrl.upload.single('image'), asyncHandler(productCtrl.adminUpdate));
router.post('/products/:id/delete', asyncHandler(productCtrl.adminDelete));
router.post('/products/:id/toggle', asyncHandler(productCtrl.adminToggleActive));

// Categorie
router.get('/categories', asyncHandler(productCtrl.adminCategories));
router.post('/categories', asyncHandler(productCtrl.adminCreateCategory));
router.post('/categories/:id', asyncHandler(productCtrl.adminUpdateCategory));

module.exports = router;
