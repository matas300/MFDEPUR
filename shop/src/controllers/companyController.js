const prisma = require('../config/database');
const emailUtil = require('../utils/email');
const { logAudit } = require('../utils/audit');
const { logEmailFailure } = require('../utils/emailLogger');
const { ORDER_STATUS_TRANSITIONS } = require('../config/constants');

// GET /company/orders — lista ordini della company dell'utente
exports.getOrders = async (req, res) => {
  const orders = await prisma.order.findMany({
    where: { companyId: req.user.companyId },
    include: {
      user: { select: { firstName: true, lastName: true, email: true } },
      _count: { select: { items: true } },
    },
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    take: 100,
  });
  const awaitingCount = orders.filter(o => o.status === 'AWAITING_APPROVAL').length;
  res.render('company/orders', { orders, awaitingCount, title: 'Ordini azienda' });
};

// GET /company/orders/:id
exports.getOrderDetail = async (req, res) => {
  const order = await prisma.order.findFirst({
    where: { id: req.params.id, companyId: req.user.companyId },
    include: {
      items: { include: { product: true } },
      user: true,
      address: true,
      company: true,
    },
  });
  if (!order) return res.status(404).render('error', { message: 'Ordine non trovato', code: 404 });
  res.render('company/order-detail', { order, title: `Ordine #${order.orderNumber}` });
};

async function _transitionApproval(req, res, targetStatus, action) {
  // Valida transizione PRIMA dell'updateMany (4xx esplicito vs. silent no-op)
  if (!ORDER_STATUS_TRANSITIONS.AWAITING_APPROVAL.includes(targetStatus)) {
    return res.status(400).render('error', { message: 'Transizione non permessa', code: 400 });
  }

  // Update atomico: previene race condition tra approver concorrenti.
  // Se result.count === 0 → l'ordine non esiste, non è della company, oppure
  // è già stato transitato da un altro approver.
  const result = await prisma.order.updateMany({
    where: {
      id: req.params.id,
      companyId: req.user.companyId,
      status: 'AWAITING_APPROVAL',
    },
    data: { status: targetStatus },
  });

  if (result.count === 0) {
    return res.status(404).render('error', {
      message: 'Ordine non trovato o già processato',
      code: 404,
    });
  }

  // Re-leggi l'ordine (con user) per audit + email
  const order = await prisma.order.findUnique({
    where: { id: req.params.id },
    include: { user: true },
  });

  await logAudit(req, {
    action,
    entityType: 'Order',
    entityId: order.id,
    metadata: { from: 'AWAITING_APPROVAL', to: targetStatus, orderNumber: order.orderNumber },
  });

  // Email al BUYER
  const tplName = targetStatus === 'PENDING_PAYMENT' ? 'sendOrderApproved' : 'sendOrderRejected';
  if (typeof emailUtil[tplName] === 'function' && order.user?.email) {
    await emailUtil[tplName](order, order.user).catch(err =>
      logEmailFailure({
        to: order.user.email,
        subject: `Ordine ${order.orderNumber} ${targetStatus === 'PENDING_PAYMENT' ? 'approvato' : 'rifiutato'}`,
        templateName: tplName,
        err,
        context: { orderId: order.id },
      })
    );
  }

  return res.redirect(`/company/orders/${order.id}`);
}

exports.approveOrder = (req, res) => _transitionApproval(req, res, 'PENDING_PAYMENT', 'ORDER_APPROVE');
exports.rejectOrder = (req, res) => _transitionApproval(req, res, 'CANCELLED', 'ORDER_REJECT');
