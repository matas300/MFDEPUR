const prisma = require('../config/database');

async function getOrCreateCart(userId) {
  let cart = await prisma.cart.findUnique({
    where: { userId },
    include: { items: { include: { product: true } } },
  });
  if (!cart) {
    cart = await prisma.cart.create({
      data: { userId },
      include: { items: { include: { product: true } } },
    });
  }
  return cart;
}

function cartTotals(items) {
  const subtotal = items.reduce((sum, i) => sum + Number(i.product.price) * i.quantity, 0);
  const taxAmount = subtotal * 0.22;
  return { subtotal, taxAmount, total: subtotal + taxAmount };
}

// GET /shop/cart
exports.getCart = async (req, res) => {
  // Guest: il carrello è gestito lato client (localStorage via shop.js)
  if (!req.user) {
    return res.render('shop/cart', { cart: null, totals: null, title: 'Carrello', guest: true });
  }
  // Utente non approvato: mostra pagina carrello con avviso (senza items DB)
  if (!req.user.company || req.user.company.status !== 'APPROVED') {
    return res.render('shop/cart', { cart: null, totals: null, title: 'Carrello', guest: false });
  }
  const cart = await getOrCreateCart(req.user.id);
  const totals = cartTotals(cart.items);
  res.render('shop/cart', { cart, totals, title: 'Carrello', guest: false });
};

// POST /shop/cart/add
exports.addItem = async (req, res) => {
  const { productId, quantity = 1 } = req.body;
  const qty = Math.max(1, parseInt(quantity));

  const product = await prisma.product.findUnique({ where: { id: productId, isActive: true } });
  if (!product) {
    return res.status(404).json({ error: 'Prodotto non trovato' });
  }
  if (product.priceOnRequest) {
    return res.status(400).json({ error: 'Questo prodotto richiede un preventivo. Contattaci per maggiori informazioni.' });
  }
  if (qty < product.minOrderQty) {
    return res.status(400).json({ error: `Quantità minima per questo prodotto: ${product.minOrderQty} ${product.unit}` });
  }
  if (product.stock < qty) {
    return res.status(400).json({ error: 'Quantità non disponibile' });
  }

  const cart = await getOrCreateCart(req.user.id);

  const existing = cart.items.find(i => i.productId === productId);

  if (existing) {
    const newQty = existing.quantity + qty;
    if (newQty > product.stock) {
      return res.status(400).json({ error: 'Quantità supera la disponibilità' });
    }
    await prisma.cartItem.update({
      where: { id: existing.id },
      data: { quantity: newQty },
    });
  } else {
    await prisma.cartItem.create({
      data: { cartId: cart.id, productId, quantity: qty },
    });
  }

  // Risponde con il nuovo conteggio per aggiornare il badge navbar
  const updatedCart = await prisma.cart.findUnique({
    where: { userId: req.user.id },
    include: { items: true },
  });
  const count = updatedCart.items.reduce((s, i) => s + i.quantity, 0);

  if (req.accepts('json')) return res.json({ ok: true, cartCount: count });
  res.redirect('/shop/cart');
};

// POST /shop/cart/update  (form) + POST /shop/cart/item/:id  (AJAX)
exports.updateItem = async (req, res) => {
  const itemId = req.params.id || req.body.itemId;
  const quantity = req.body.quantity;
  const qty = parseInt(quantity);

  const item = await prisma.cartItem.findUnique({
    where: { id: itemId },
    include: { cart: true, product: true },
  });

  if (!item || item.cart.userId !== req.user.id) {
    return res.status(403).json({ error: 'Non autorizzato' });
  }

  if (qty <= 0) {
    await prisma.cartItem.delete({ where: { id: itemId } });
  } else {
    if (qty < item.product.minOrderQty) {
      return res.status(400).json({ error: `Quantità minima: ${item.product.minOrderQty} ${item.product.unit}` });
    }
    if (qty > item.product.stock) {
      return res.status(400).json({ error: 'Quantità non disponibile' });
    }
    await prisma.cartItem.update({ where: { id: itemId }, data: { quantity: qty } });
  }

  if (req.accepts('json')) {
    const updatedCart = await prisma.cart.findUnique({
      where: { userId: req.user.id },
      include: { items: true },
    });
    const cartCount = updatedCart ? updatedCart.items.reduce((s, i) => s + i.quantity, 0) : 0;
    return res.json({ ok: true, cartCount });
  }
  res.redirect('/shop/cart');
};

// POST /shop/cart/remove  (form) + POST /shop/cart/item/:id/remove  (AJAX)
exports.removeItem = async (req, res) => {
  const itemId = req.params.id || req.body.itemId;
  const item = await prisma.cartItem.findUnique({ where: { id: itemId }, include: { cart: true } });
  if (item && item.cart.userId === req.user.id) {
    await prisma.cartItem.delete({ where: { id: itemId } });
  }

  if (req.accepts('json')) {
    const updatedCart = await prisma.cart.findUnique({
      where: { userId: req.user.id },
      include: { items: true },
    });
    const cartCount = updatedCart ? updatedCart.items.reduce((s, i) => s + i.quantity, 0) : 0;
    return res.json({ ok: true, cartCount });
  }
  res.redirect('/shop/cart');
};

// GET /shop/cart/count — badge dopo auto-merge
exports.getCartCount = async (req, res) => {
  const cart = await prisma.cart.findUnique({
    where: { userId: req.user.id },
    include: { items: true },
  });
  const count = cart ? cart.items.reduce((s, i) => s + i.quantity, 0) : 0;
  res.json({ count });
};

// POST /shop/cart/clear
exports.clearCart = async (req, res) => {
  const cart = await prisma.cart.findUnique({ where: { userId: req.user.id } });
  if (cart) await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
  res.redirect('/shop/cart');
};
