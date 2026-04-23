const prisma = require('../config/database');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const emailUtil = require('../utils/email');
const { logAudit } = require('../utils/audit');

// ── Idempotency cache ─────────────────────────────────────────────────────────
// In-memory idempotency cache: key → { orderId, expiresAt }
// TTL: 5 minuti. Per scala prod con multi-istanza servirà Redis (scope M7).
const IDEMPOTENCY_TTL_MS = 5 * 60 * 1000;
const idempotencyCache = new Map();

function idempotencyGet(key) {
  const entry = idempotencyCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    idempotencyCache.delete(key);
    return null;
  }
  return entry;
}

function idempotencySet(key, orderId) {
  idempotencyCache.set(key, { orderId, expiresAt: Date.now() + IDEMPOTENCY_TTL_MS });
}

// Housekeeping: rimuovi entry scadute ogni 10 minuti
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of idempotencyCache.entries()) {
    if (v.expiresAt < now) idempotencyCache.delete(k);
  }
}, 10 * 60 * 1000).unref();

async function generateOrderNumber() {
  const year = new Date().getFullYear();
  const count = await prisma.order.count({
    where: { createdAt: { gte: new Date(`${year}-01-01`) } },
  });
  return `MFD-${year}-${String(count + 1).padStart(4, '0')}`;
}

// GET /shop/checkout
exports.getCheckout = async (req, res) => {
  const cart = await prisma.cart.findUnique({
    where: { userId: req.user.id },
    include: { items: { include: { product: true } } },
  });

  if (!cart || cart.items.length === 0) return res.redirect('/shop/cart');

  const addresses = await prisma.address.findMany({
    where: { companyId: req.user.companyId },
    orderBy: { isDefault: 'desc' },
  });

  const subtotal = cart.items.reduce((s, i) => s + Number(i.product.price) * i.quantity, 0);
  const taxAmount = subtotal * 0.22;
  const total = subtotal + taxAmount;

  const idempotencyKey = require('crypto').randomUUID();

  res.render('shop/checkout', {
    cart,
    addresses,
    totals: { subtotal, taxAmount, total, shippingCost: 0 },
    stripePublicKey: process.env.STRIPE_PUBLISHABLE_KEY,
    title: 'Checkout',
    idempotencyKey,
  });
};

// POST /shop/checkout  — crea Stripe PaymentIntent e ordine PENDING
exports.postCheckout = async (req, res) => {
  const { addressId, notes, paymentMethod = 'STRIPE' } = req.body;

  // Idempotency: blocca double-submit (5 min TTL)
  const idempotencyKey = req.body.idempotencyKey || req.get('idempotency-key');
  if (idempotencyKey) {
    const hit = idempotencyGet(idempotencyKey);
    if (hit) {
      // Duplicato: rispondi con lo stesso risultato senza creare un nuovo ordine.
      return res.redirect(`/account/orders/${hit.orderId}?idempotent=1`);
    }
  }

  const cart = await prisma.cart.findUnique({
    where: { userId: req.user.id },
    include: { items: { include: { product: true } } },
  });

  if (!cart || cart.items.length === 0) return res.redirect('/shop/cart');

  // Ownership check: l'indirizzo deve appartenere alla company dell'utente (IDOR fix)
  if (addressId) {
    const addr = await prisma.address.findFirst({
      where: { id: addressId, companyId: req.user.companyId },
      select: { id: true },
    });
    if (!addr) {
      return res.status(403).render('error', {
        message: 'Indirizzo non valido o non autorizzato.',
        code: 403,
      });
    }
  }

  // Verifica stock preliminare (best-effort; check atomico in _finalizeOrder)
  for (const item of cart.items) {
    if (item.product.stock < item.quantity) {
      return res.render('shop/checkout', {
        error: `Disponibilità insufficiente per "${item.product.name}" (max ${item.product.stock} ${item.product.unit})`,
        cart,
      });
    }
  }

  const subtotal = cart.items.reduce((s, i) => s + Number(i.product.price) * i.quantity, 0);
  const taxAmount = subtotal * 0.22;
  const shippingCost = 0;
  const total = subtotal + taxAmount + shippingCost;

  const orderNumber = await generateOrderNumber();

  // Crea ordine PENDING
  const order = await prisma.order.create({
    data: {
      orderNumber,
      userId: req.user.id,
      companyId: req.user.companyId,
      addressId: addressId || null,
      status: 'PENDING',
      paymentMethod: paymentMethod.toUpperCase(),
      subtotal,
      taxAmount,
      shippingCost,
      total,
      notes: notes?.trim() || null,
      items: {
        create: cart.items.map(i => ({
          productId: i.productId,
          productName: i.product.name,
          productSku: i.product.sku,
          unit: i.product.unit,
          quantity: i.quantity,
          unitPrice: i.product.price,
          total: Number(i.product.price) * i.quantity,
        })),
      },
    },
    include: { items: true, company: true },
  });

  // Registra idempotency key dopo creazione ordine
  if (idempotencyKey) idempotencySet(idempotencyKey, order.id);

  if (paymentMethod === 'BANK_TRANSFER') {
    // Per bonifico: finalize atomico (status + stock) e post-processing (email/cart clear).
    // Se lo stock è insufficiente (race), _finalizeOrder lancia INSUFFICIENT_STOCK.
    const finalized = await _finalizeOrder(order.id);
    await _postFinalize(finalized, cart, req.user);
    return res.redirect(`/shop/checkout/success?orderId=${order.id}`);
  }

  // Stripe: crea PaymentIntent
  const paymentIntent = await stripe.paymentIntents.create({
    amount: Math.round(total * 100), // centesimi
    currency: 'eur',
    metadata: { orderId: order.id, orderNumber },
    receipt_email: req.user.email,
  });

  await prisma.order.update({
    where: { id: order.id },
    data: { paymentIntentId: paymentIntent.id },
  });

  res.json({
    clientSecret: paymentIntent.client_secret,
    orderId: order.id,
  });
};

// GET /shop/checkout/success
exports.checkoutSuccess = async (req, res) => {
  const { orderId } = req.query;
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: { include: { product: true } }, address: true, company: true },
  });
  if (!order || order.userId !== req.user.id) return res.redirect('/shop');
  res.render('shop/order-success', { order, title: 'Ordine confermato' });
};

// GET /shop/checkout/cancel
exports.checkoutCancel = (req, res) => res.redirect('/shop/cart');

// POST /stripe/webhook  (registrata in app.js con rawBody)
exports.stripeWebhook = async (req, res) => {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  // Fail-close: senza secret o senza rawBody niente webhook. Evita che in dev
  // un qualunque POST su /stripe/webhook possa modificare ordini.
  if (!secret) {
    console.error('[stripe-webhook] STRIPE_WEBHOOK_SECRET non configurato — rifiuto');
    return res.status(500).send('Webhook non configurato');
  }
  if (!req.rawBody) {
    return res.status(400).send('Raw body mancante');
  }
  const sig = req.headers['stripe-signature'];
  if (!sig) return res.status(400).send('Firma mancante');

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.rawBody, sig, secret);
  } catch (err) {
    // Persist invalid-sig in AuditLog — best-effort, non-blocking
    await logAudit(req, {
      action: 'STRIPE_WEBHOOK_INVALID_SIG',
      entityType: 'Webhook',
      entityId: null,
      metadata: { error: err.message?.slice(0, 500) },
    });
    console.warn('[stripe-webhook] firma non valida:', err.message);
    return res.status(400).send(`Webhook error: ${err.message}`);
  }

  if (event.type === 'payment_intent.succeeded') {
    const pi = event.data.object;
    const order = await prisma.order.findFirst({
      where: { paymentIntentId: pi.id },
      include: { items: true, company: true, user: true },
    });
    if (order) {
      const finalized = await _finalizeOrder(order.id, { paymentIntentId: pi.id });
      const cart = await prisma.cart.findUnique({
        where: { userId: order.userId },
        include: { items: true },
      });
      await _postFinalize(finalized, cart, order.user);
    }
  }

  if (event.type === 'payment_intent.payment_failed') {
    const pi = event.data.object;
    await prisma.order.updateMany({
      where: { paymentIntentId: pi.id },
      data: { status: 'PAYMENT_FAILED' },
    });
  }

  res.json({ received: true });
};

// Account ordini
exports.getMyOrders = async (req, res) => {
  const orders = await prisma.order.findMany({
    where: { userId: req.user.id },
    include: { items: true },
    orderBy: { createdAt: 'desc' },
  });
  res.render('account/orders', { orders, title: 'I miei ordini' });
};

exports.getOrderDetail = async (req, res) => {
  const order = await prisma.order.findUnique({
    where: { id: req.params.id },
    include: { items: { include: { product: true } }, address: true, company: true },
  });
  if (!order || order.userId !== req.user.id) {
    return res.status(404).render('error', { message: 'Ordine non trovato', code: 404 });
  }
  res.render('account/order-detail', { order, title: `Ordine #${order.orderNumber}` });
};

// ── Helpers ───────────────────────────────────────────────────────────────────

// Finalizza un ordine in CONFIRMED atomicamente: verifica + decrementa stock e
// aggiorna status in singola transazione Prisma. Se fallisce per stock
// insufficiente, lancia err.code='INSUFFICIENT_STOCK'. Se l'ordine è già
// CONFIRMED ritorna idempotente (webhook duplicato). Non esegue side-effect
// (email, cart clear): quelli sono in _postFinalize, fuori dalla transazione.
async function _finalizeOrder(orderId, { paidAt = new Date(), paymentIntentId = null } = {}) {
  return await prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: { items: true, company: true, user: true, address: true },
    });
    if (!order) {
      const e = new Error(`Order ${orderId} not found`);
      e.code = 'ORDER_NOT_FOUND';
      throw e;
    }
    if (order.status === 'CONFIRMED') {
      return order; // idempotent: già confermato
    }
    if (order.status !== 'PENDING' && order.status !== 'PAYMENT_FAILED') {
      const e = new Error(`Cannot finalize order in status ${order.status}`);
      e.code = 'ORDER_INVALID_STATE';
      throw e;
    }

    // Verifica stock atomicamente (Prisma decrement andrebbe sotto zero senza check)
    for (const it of order.items) {
      const prod = await tx.product.findUnique({
        where: { id: it.productId },
        select: { id: true, stock: true, name: true },
      });
      if (!prod) {
        const e = new Error(`Product ${it.productId} not found`);
        e.code = 'PRODUCT_NOT_FOUND';
        throw e;
      }
      if (prod.stock < it.quantity) {
        const e = new Error(`Stock insufficiente per ${prod.name}: richiesti ${it.quantity}, disponibili ${prod.stock}`);
        e.code = 'INSUFFICIENT_STOCK';
        throw e;
      }
    }

    // Decrement stock
    for (const it of order.items) {
      await tx.product.update({
        where: { id: it.productId },
        data: { stock: { decrement: it.quantity } },
      });
    }

    // Update order status
    const updated = await tx.order.update({
      where: { id: orderId },
      data: {
        status: 'CONFIRMED',
        paidAt,
        ...(paymentIntentId ? { paymentIntentId } : {}),
      },
      include: { items: true, company: true, user: true, address: true },
    });

    return updated;
  });
}

// Post-finalize side-effects (fuori dalla transazione): svuota carrello, invia email.
// Email failure non propaga (logging strutturato arriverà in commit successivo).
async function _postFinalize(order, cart, user) {
  // Svuota carrello
  if (cart) {
    await prisma.cartItem.deleteMany({ where: { cartId: cart.id } }).catch(() => {}); // idempotent cleanup, silenzioso OK
  }

  // Email cliente
  await emailUtil.sendOrderConfirmation(order, user).catch(() => {});

  // Email admin
  await emailUtil.sendNewOrderNotificationAdmin(order, order.company).catch(() => {});
}
