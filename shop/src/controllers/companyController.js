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
  const order = await prisma.order.findFirst({
    where: { id: req.params.id, companyId: req.user.companyId, status: 'AWAITING_APPROVAL' },
    include: { user: true },
  });
  if (!order) {
    return res.status(404).render('error', {
      message: 'Ordine non trovato o non in attesa di approvazione',
      code: 404,
    });
  }

  if (!ORDER_STATUS_TRANSITIONS.AWAITING_APPROVAL.includes(targetStatus)) {
    return res.status(400).render('error', { message: 'Transizione non permessa', code: 400 });
  }

  const updated = await prisma.order.update({
    where: { id: order.id },
    data: { status: targetStatus },
  });

  await logAudit(req, {
    action,
    entityType: 'Order',
    entityId: order.id,
    metadata: { from: 'AWAITING_APPROVAL', to: targetStatus, orderNumber: order.orderNumber },
  });

  // Email al BUYER
  const tplName = targetStatus === 'PENDING' ? 'sendOrderApproved' : 'sendOrderRejected';
  if (typeof emailUtil[tplName] === 'function' && order.user?.email) {
    await emailUtil[tplName](updated, order.user).catch(err =>
      logEmailFailure({
        to: order.user.email,
        subject: `Ordine ${order.orderNumber} ${targetStatus === 'PENDING' ? 'approvato' : 'rifiutato'}`,
        templateName: tplName,
        err,
        context: { orderId: order.id },
      })
    );
  }

  return res.redirect(`/company/orders/${order.id}`);
}

exports.approveOrder = (req, res) => _transitionApproval(req, res, 'PENDING', 'ORDER_APPROVE');
exports.rejectOrder = (req, res) => _transitionApproval(req, res, 'CANCELLED', 'ORDER_REJECT');
