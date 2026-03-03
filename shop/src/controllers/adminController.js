const prisma = require('../config/database');
const emailUtil = require('../utils/email');

// GET /admin  — dashboard
exports.getDashboard = async (req, res) => {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const [
    totalOrders,
    ordersThisMonth,
    revenueResult,
    revenueMonthResult,
    pendingCompanies,
    totalProducts,
    lowStockProducts,
    recentOrders,
  ] = await Promise.all([
    prisma.order.count({ where: { status: { notIn: ['PENDING', 'PAYMENT_FAILED', 'CANCELLED'] } } }),
    prisma.order.count({ where: { createdAt: { gte: startOfMonth }, status: { notIn: ['PENDING', 'PAYMENT_FAILED', 'CANCELLED'] } } }),
    prisma.order.aggregate({ _sum: { total: true }, where: { status: { notIn: ['PENDING', 'PAYMENT_FAILED', 'CANCELLED'] } } }),
    prisma.order.aggregate({ _sum: { total: true }, where: { createdAt: { gte: startOfMonth }, status: { notIn: ['PENDING', 'PAYMENT_FAILED', 'CANCELLED'] } } }),
    prisma.company.count({ where: { status: 'PENDING' } }),
    prisma.product.count({ where: { isActive: true } }),
    prisma.$queryRaw`SELECT id, name, sku, stock, "lowStockAlert" FROM "Product" WHERE "isActive" = true AND stock <= "lowStockAlert" LIMIT 10`,
    prisma.order.findMany({
      take: 8,
      orderBy: { createdAt: 'desc' },
      include: { company: true, user: { select: { firstName: true, lastName: true } } },
    }),
  ]);

  res.render('admin/dashboard', {
    stats: {
      totalOrders,
      ordersThisMonth,
      revenue: Number(revenueResult._sum.total || 0),
      revenueMonth: Number(revenueMonthResult._sum.total || 0),
      pendingCompanies,
      totalProducts,
    },
    lowStockProducts,
    recentOrders,
    title: 'Dashboard',
  });
};

// ── Ordini ────────────────────────────────────────────────────────────────────

exports.getOrders = async (req, res) => {
  const { stato, azienda, pagina = 1 } = req.query;
  const PER_PAGE = 20;
  const skip = (parseInt(pagina) - 1) * PER_PAGE;
  const where = {};

  if (stato) where.status = stato;
  if (azienda) where.company = { name: { contains: azienda, mode: 'insensitive' } };

  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      where,
      include: {
        company: true,
        user: { select: { firstName: true, lastName: true, email: true } },
        _count: { select: { items: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: PER_PAGE,
    }),
    prisma.order.count({ where }),
  ]);

  res.render('admin/orders', {
    orders,
    pagination: { current: parseInt(pagina), total: Math.ceil(total / PER_PAGE) },
    filters: { stato, azienda },
    statuses: ['PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'REFUNDED'],
    title: 'Ordini',
  });
};

exports.getOrderDetail = async (req, res) => {
  const order = await prisma.order.findUnique({
    where: { id: req.params.id },
    include: {
      items: { include: { product: true } },
      user: true,
      company: true,
      address: true,
    },
  });
  if (!order) return res.status(404).render('error', { message: 'Ordine non trovato', code: 404 });
  res.render('admin/order-detail', { order, title: `Ordine #${order.orderNumber}` });
};

exports.updateOrderStatus = async (req, res) => {
  const { status, adminNotes, trackingNumber } = req.body;
  const order = await prisma.order.update({
    where: { id: req.params.id },
    data: {
      status,
      adminNotes: adminNotes || undefined,
      trackingNumber: trackingNumber || undefined,
      shippedAt: status === 'SHIPPED' ? new Date() : undefined,
      deliveredAt: status === 'DELIVERED' ? new Date() : undefined,
    },
    include: { user: true, company: true, items: true },
  });

  if (req.accepts('json')) return res.json({ ok: true, status: order.status });
  res.redirect(`/admin/orders/${order.id}?updated=1`);
};

// ── Aziende clienti ───────────────────────────────────────────────────────────

exports.getCompanies = async (req, res) => {
  const { stato, cerca, pagina = 1 } = req.query;
  const PER_PAGE = 20;
  const skip = (parseInt(pagina) - 1) * PER_PAGE;
  const where = {};

  if (stato) where.status = stato;
  if (cerca) {
    where.OR = [
      { name: { contains: cerca, mode: 'insensitive' } },
      { vatNumber: { contains: cerca, mode: 'insensitive' } },
    ];
  }

  const [companies, total] = await Promise.all([
    prisma.company.findMany({
      where,
      include: {
        users: { select: { id: true, firstName: true, lastName: true, email: true } },
        _count: { select: { orders: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: PER_PAGE,
    }),
    prisma.company.count({ where }),
  ]);

  res.render('admin/companies', {
    companies,
    pagination: { current: parseInt(pagina), total: Math.ceil(total / PER_PAGE) },
    filters: { stato, cerca },
    statuses: ['PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED'],
    title: 'Aziende clienti',
  });
};

exports.updateCompanyStatus = async (req, res) => {
  const { status, notes } = req.body;
  const company = await prisma.company.update({
    where: { id: req.params.id },
    data: { status, notes: notes || undefined },
    include: { users: true },
  });

  // Se approvata → notifica tutti gli utenti dell'azienda
  if (status === 'APPROVED') {
    for (const user of company.users) {
      await emailUtil.sendCompanyApproved(user).catch(() => {});
    }
  }

  if (req.accepts('json')) return res.json({ ok: true, status: company.status });
  res.redirect('/admin/companies?updated=1');
};

exports.getCompanyDetail = async (req, res) => {
  const company = await prisma.company.findUnique({
    where: { id: req.params.id },
    include: {
      users: true,
      addresses: true,
      orders: {
        take: 10,
        orderBy: { createdAt: 'desc' },
        include: { _count: { select: { items: true } } },
      },
    },
  });
  if (!company) return res.status(404).render('error', { message: 'Azienda non trovata', code: 404 });
  res.render('admin/company-detail', { company, title: company.name });
};

// ── Route admin ───────────────────────────────────────────────────────────────

const multer = require('multer');
const path = require('path');

const storage = multer.diskStorage({
  destination: path.join(__dirname, '../../uploads'),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname));
  },
});
const upload = multer({
  storage,
  limits: { fileSize: (parseInt(process.env.UPLOAD_MAX_SIZE_MB) || 5) * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.webp'];
    cb(null, allowed.includes(path.extname(file.originalname).toLowerCase()));
  },
});

module.exports.upload = upload;
