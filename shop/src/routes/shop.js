const router = require('express').Router();
const { requireAuth, requireApprovedCompany } = require('../middleware/auth');
const productCtrl = require('../controllers/productController');
const cartCtrl = require('../controllers/cartController');
const orderCtrl = require('../controllers/orderController');

// Catalogo e prodotti — visibili a tutti
router.get('/', productCtrl.getCatalog);
router.get('/product/:slug', productCtrl.getProduct);

// Carrello — pagina accessibile a tutti (guest vede versione JS, loggati vedono DB)
router.get('/cart', cartCtrl.getCart);

// Carrello — conteggio (usato per aggiornare badge dopo auto-merge)
router.get('/cart/count', requireAuth, cartCtrl.getCartCount);

// Carrello — modifiche richiedono login e azienda approvata
router.post('/cart/add', requireAuth, requireApprovedCompany, cartCtrl.addItem);
router.post('/cart/update', requireAuth, requireApprovedCompany, cartCtrl.updateItem);
router.post('/cart/item/:id', requireAuth, requireApprovedCompany, cartCtrl.updateItem);
router.post('/cart/remove', requireAuth, requireApprovedCompany, cartCtrl.removeItem);
router.post('/cart/item/:id/remove', requireAuth, requireApprovedCompany, cartCtrl.removeItem);
router.post('/cart/clear', requireAuth, requireApprovedCompany, cartCtrl.clearCart);

// Checkout — richiede login e azienda approvata
router.get('/checkout', requireAuth, requireApprovedCompany, orderCtrl.getCheckout);
router.post('/checkout', requireAuth, requireApprovedCompany, orderCtrl.postCheckout);
router.get('/checkout/success', requireAuth, requireApprovedCompany, orderCtrl.checkoutSuccess);
router.get('/checkout/cancel', requireAuth, requireApprovedCompany, orderCtrl.checkoutCancel);

module.exports = router;
