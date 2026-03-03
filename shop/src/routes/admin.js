const router = require('express').Router();
const { requireAuth, requireAdmin } = require('../middleware/auth');
const adminCtrl = require('../controllers/adminController');
const productCtrl = require('../controllers/productController');

router.use(requireAuth, requireAdmin);

// Dashboard
router.get('/', adminCtrl.getDashboard);

// Ordini
router.get('/orders', adminCtrl.getOrders);
router.get('/orders/:id', adminCtrl.getOrderDetail);
router.post('/orders/:id/status', adminCtrl.updateOrderStatus);

// Aziende clienti
router.get('/companies', adminCtrl.getCompanies);
router.get('/companies/:id', adminCtrl.getCompanyDetail);
router.post('/companies/:id/status', adminCtrl.updateCompanyStatus);

// Prodotti
router.get('/products', productCtrl.adminList);
router.get('/products/new', productCtrl.adminNewForm);
router.post('/products', adminCtrl.upload.single('image'), productCtrl.adminCreate);
router.get('/products/:id/edit', productCtrl.adminEditForm);
router.post('/products/:id', adminCtrl.upload.single('image'), productCtrl.adminUpdate);
router.post('/products/:id/delete', productCtrl.adminDelete);
router.post('/products/:id/toggle', productCtrl.adminToggleActive);

// Categorie
router.get('/categories', productCtrl.adminCategories);
router.post('/categories', productCtrl.adminCreateCategory);
router.post('/categories/:id', productCtrl.adminUpdateCategory);

module.exports = router;
