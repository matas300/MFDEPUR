const prisma = require('../config/database');
const emailUtil = require('../utils/email');
const { logEmailFailure } = require('../utils/emailLogger');

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
    bank: {
      beneficiary: process.env.BANK_BENEFICIARY,
      iban: process.env.BANK_IBAN,
      name: process.env.BANK_NAME,
      bic: process.env.BANK_BIC || null,
    },
    title: 'Checkout',
    idempotencyKey,
  });
};

// POST /shop/checkout  — crea ordine PENDING_PAYMENT (bonifico-only)
exports.postCheckout = async (req, res) => {
  const { addressId, notes } = req.body;
  const paymentMethod = 'BANK_TRANSFER';

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

  // Approval workflow: se la company richiede approvazione interna e l'utente
  // NON è COMPANY_ADMIN, l'ordine viene creato in AWAITING_APPROVAL senza
  // passaggio di pagamento. Il COMPANY_ADMIN dovrà approvarlo per sbloccare il pagamento.
  const needsApproval = req.user.company?.requiresOrderApproval
    && req.user.companyRole !== 'COMPANY_ADMIN'
    && req.user.role !== 'ADMIN';

  if (needsApproval) {
    const orderNumber = await generateOrderNumber();
    const order = await prisma.order.create({
      data: {
        orderNumber,
        userId: req.user.id,
        companyId: req.user.companyId,
        addressId: addressId || null,
        status: 'AWAITING_APPROVAL',
        paymentMethod: 'BANK_TRANSFER',
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

    if (idempotencyKey) idempotencySet(idempotencyKey, order.id);

    // Notifica i COMPANY_ADMIN della stessa company
    const admins = await prisma.user.findMany({
      where: { companyId: req.user.companyId, companyRole: 'COMPANY_ADMIN' },
      select: { email: true, firstName: true, lastName: true },
    });
    if (admins.length > 0) {
      await emailUtil.sendOrderAwaitingApproval(order, req.user, admins).catch(err =>
        logEmailFailure({
          to: admins.map(a => a.email).join(','),
          subject: `Ordine ${order.orderNumber} in attesa di approvazione`,
          templateName: 'sendOrderAwaitingApproval',
          err,
          context: { orderId: order.id },
        })
      );
    }

    return res.redirect(`/account/orders/${order.id}?awaitingApproval=1`);
  }

  const orderNumber = await generateOrderNumber();

  // Crea ordine PENDING_PAYMENT. Status NON viene avanzato a CONFIRMED qui;
  // l'admin lo farà via markOrderAsPaid una volta ricevuto il bonifico.
  const order = await prisma.order.create({
    data: {
      orderNumber,
      userId: req.user.id,
      companyId: req.user.companyId,
      addressId: addressId || null,
      status: 'PENDING_PAYMENT',
      paymentMethod: 'BANK_TRANSFER',
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

  if (idempotencyKey) idempotencySet(idempotencyKey, order.id);

  // Svuota carrello (l'ordine è creato, anche se non ancora pagato)
  await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });

  // Email cliente: conferma ordine + IBAN per bonifico (template aggiornato in Task 7)
  await emailUtil.sendOrderConfirmation(order, req.user).catch(err =>
    logEmailFailure({
      to: req.user.email,
      subject: `Ordine ${order.orderNumber} ricevuto`,
      templateName: 'sendOrderConfirmation',
      err,
      context: { orderId: order.id },
    })
  );

  // Email admin: notifica nuovo ordine in attesa pagamento (riusa funzione esistente)
  await emailUtil.sendNewOrderNotificationAdmin(order, order.company).catch(err =>
    logEmailFailure({
      to: process.env.ADMIN_EMAIL || process.env.EMAIL_FROM,
      subject: `Nuovo ordine ${order.orderNumber}`,
      templateName: 'sendNewOrderNotificationAdmin',
      err,
      context: { orderId: order.id },
    })
  );

  return res.redirect(`/shop/checkout/success?orderId=${order.id}`);
};

// GET /shop/checkout/success
exports.checkoutSuccess = async (req, res) => {
  const { orderId } = req.query;
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: { include: { product: true } }, address: true, company: true },
  });
  if (!order || order.userId !== req.user.id) return res.redirect('/shop');
  res.render('shop/order-success', {
    order,
    title: 'Ordine confermato',
    bank: {
      beneficiary: process.env.BANK_BENEFICIARY,
      iban: process.env.BANK_IBAN,
      name: process.env.BANK_NAME,
      bic: process.env.BANK_BIC || null,
    },
  });
};

// GET /shop/checkout/cancel
exports.checkoutCancel = (req, res) => res.redirect('/shop/cart');

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
    if (order.status !== 'PENDING_PAYMENT') {
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
  await emailUtil.sendOrderConfirmation(order, user).catch((err) => logEmailFailure({
    to: user.email,
    subject: `Ordine ${order.orderNumber}`,
    templateName: 'sendOrderConfirmation',
    err,
    context: { orderId: order.id, userId: user.id },
  }));

  // Email admin
  await emailUtil.sendNewOrderNotificationAdmin(order, order.company).catch((err) => logEmailFailure({
    to: process.env.ADMIN_EMAIL || 'admin',
    subject: `Nuovo ordine ${order.orderNumber}`,
    templateName: 'sendNewOrderNotificationAdmin',
    err,
    context: { orderId: order.id, companyId: order.company?.id },
  }));
}
