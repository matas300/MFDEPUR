const router = require('express').Router();
const { requireAuth, requireApprovedCompany } = require('../middleware/auth');
const productCtrl = require('../controllers/productController');
const cartCtrl = require('../controllers/cartController');
const orderCtrl = require('../controllers/orderController');
const asyncHandler = require('../utils/asyncHandler');

// Catalogo e prodotti — visibili a tutti
router.get('/', asyncHandler(productCtrl.getCatalog));
router.get('/product/:slug', asyncHandler(productCtrl.getProduct));

// Carrello — pagina accessibile a tutti (guest vede versione JS, loggati vedono DB)
router.get('/cart', asyncHandler(cartCtrl.getCart));

// Carrello — conteggio (usato per aggiornare badge dopo auto-merge)
router.get('/cart/count', requireAuth, asyncHandler(cartCtrl.getCartCount));

// Carrello — modifiche richiedono login e azienda approvata
router.post('/cart/add', requireAuth, requireApprovedCompany, asyncHandler(cartCtrl.addItem));
router.post('/cart/update', requireAuth, requireApprovedCompany, asyncHandler(cartCtrl.updateItem));
router.post('/cart/item/:id', requireAuth, requireApprovedCompany, asyncHandler(cartCtrl.updateItem));
router.post('/cart/remove', requireAuth, requireApprovedCompany, asyncHandler(cartCtrl.removeItem));
router.post('/cart/item/:id/remove', requireAuth, requireApprovedCompany, asyncHandler(cartCtrl.removeItem));
router.post('/cart/clear', requireAuth, requireApprovedCompany, asyncHandler(cartCtrl.clearCart));

// Checkout — richiede login e azienda approvata
router.get('/checkout', requireAuth, requireApprovedCompany, asyncHandler(orderCtrl.getCheckout));
router.post('/checkout', requireAuth, requireApprovedCompany, asyncHandler(orderCtrl.postCheckout));
router.get('/checkout/success', requireAuth, requireApprovedCompany, asyncHandler(orderCtrl.checkoutSuccess));
router.get('/checkout/cancel', requireAuth, requireApprovedCompany, orderCtrl.checkoutCancel);

module.exports = router;
