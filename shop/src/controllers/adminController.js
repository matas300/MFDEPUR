const prisma = require('../config/database');
const emailUtil = require('../utils/email');

// GET /admin  — dashboard
exports.getDashboard = async (req, res) => {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const thirtyDaysAgo = new Date(now);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 29);
  thirtyDaysAgo.setHours(0, 0, 0, 0);

  const [
    totalOrders,
    ordersThisMonth,
    revenueResult,
    revenueMonthResult,
    pendingCompanies,
    totalProducts,
    lowStockProducts,
    recentOrders,
    last30Orders,
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
    prisma.order.findMany({
      where: { createdAt: { gte: thirtyDaysAgo }, status: { notIn: ['PENDING', 'PAYMENT_FAILED', 'CANCELLED'] } },
      select: { createdAt: true, total: true },
    }),
  ]);

  // Bucketing client-agnostic: funziona sia su SQLite sia su Postgres
  const buckets = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(thirtyDaysAgo);
    d.setDate(d.getDate() + i);
    return { date: d, label: d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' }), orders: 0, revenue: 0 };
  });
  last30Orders.forEach(o => {
    const idx = Math.floor((new Date(o.createdAt) - thirtyDaysAgo) / 86400000);
    if (idx >= 0 && idx < 30) {
      buckets[idx].orders += 1;
      buckets[idx].revenue += Number(o.total);
    }
  });
  const chartData = {
    labels: buckets.map(b => b.label),
    orders: buckets.map(b => b.orders),
    revenue: buckets.map(b => Math.round(b.revenue * 100) / 100),
  };

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
    chartData,
    title: 'Dashboard',
  });
};

// ── Ordini ────────────────────────────────────────────────────────────────────

const ORDER_STATUSES = ['PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'REFUNDED', 'PAYMENT_FAILED'];

// Costruisce il filtro Prisma condiviso tra lista e export
function buildOrdersWhere(query) {
  const where = {};
  const { stato, azienda, dal, al } = query;

  // Multi-stato: stato può essere string o array (Express parsa ?stato=A&stato=B come array)
  if (stato) {
    const list = (Array.isArray(stato) ? stato : String(stato).split(','))
      .map(s => String(s).trim().toUpperCase())
      .filter(s => ORDER_STATUSES.includes(s));
    if (list.length === 1) where.status = list[0];
    else if (list.length > 1) where.status = { in: list };
  }

  if (azienda) where.company = { name: { contains: String(azienda) } };

  // Range date YYYY-MM-DD
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  const range = {};
  if (dal && dateRe.test(dal)) {
    const d = new Date(`${dal}T00:00:00`);
    if (!isNaN(d)) range.gte = d;
  }
  if (al && dateRe.test(al)) {
    const d = new Date(`${al}T23:59:59.999`);
    if (!isNaN(d)) range.lte = d;
  }
  if (range.gte || range.lte) where.createdAt = range;

  return where;
}

exports.getOrders = async (req, res) => {
  const { pagina = 1 } = req.query;
  const PER_PAGE = 20;
  const skip = (Math.max(1, parseInt(pagina) || 1) - 1) * PER_PAGE;
  const where = buildOrdersWhere(req.query);

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

  // Normalizza filtri.stato in array per checkbox multi-selezione
  const rawStato = req.query.stato;
  const statoArr = rawStato
    ? (Array.isArray(rawStato) ? rawStato : String(rawStato).split(','))
        .map(s => String(s).trim().toUpperCase()).filter(Boolean)
    : [];

  res.render('admin/orders', {
    orders,
    pagination: { current: parseInt(pagina) || 1, total: Math.ceil(total / PER_PAGE) },
    filters: {
      stato: statoArr,
      azienda: req.query.azienda || '',
      dal: req.query.dal || '',
      al: req.query.al || '',
    },
    statuses: ORDER_STATUSES,
    totalCount: total,
    title: 'Ordini',
  });
};

// GET /admin/orders/export.csv — stessi filtri della lista
exports.exportOrdersCSV = async (req, res) => {
  const where = buildOrdersWhere(req.query);
  const orders = await prisma.order.findMany({
    where,
    include: {
      company: { select: { name: true, vatNumber: true } },
      user: { select: { firstName: true, lastName: true, email: true } },
      _count: { select: { items: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 5000, // cap di sicurezza
  });

  // CSV escape: RFC 4180 — racchiude in "..." e raddoppia le virgolette interne
  const esc = v => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\r\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const header = [
    'Numero ordine', 'Data', 'Stato', 'Azienda', 'P.IVA',
    'Cliente', 'Email', 'Articoli', 'Subtotale', 'IVA', 'Spedizione', 'Totale',
    'Metodo pagamento', 'Pagato il', 'Spedito il', 'Consegnato il',
  ];

  const rows = orders.map(o => [
    o.orderNumber,
    new Date(o.createdAt).toISOString(),
    o.status,
    o.company?.name || '',
    o.company?.vatNumber || '',
    `${o.user?.firstName || ''} ${o.user?.lastName || ''}`.trim(),
    o.user?.email || '',
    o._count?.items ?? '',
    parseFloat(o.subtotal).toFixed(2),
    parseFloat(o.taxAmount).toFixed(2),
    parseFloat(o.shippingCost).toFixed(2),
    parseFloat(o.total).toFixed(2),
    o.paymentMethod === 'STRIPE' ? 'Carta' : 'Bonifico',
    o.paidAt ? new Date(o.paidAt).toISOString() : '',
    o.shippedAt ? new Date(o.shippedAt).toISOString() : '',
    o.deliveredAt ? new Date(o.deliveredAt).toISOString() : '',
  ]);

  // BOM UTF-8 per Excel + separatore virgola
  const csv = '﻿' + [header, ...rows].map(r => r.map(esc).join(',')).join('\r\n');
  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="ordini-${stamp}.csv"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(csv);
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
      { name: { contains: cerca } },
      { vatNumber: { contains: cerca } },
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
