const prisma = require('../config/database');
const path = require('path');
const fs = require('fs');

// ── Shop pubblico ─────────────────────────────────────────────────────────────

// GET /shop  — catalogo con filtri
exports.getCatalog = async (req, res) => {
  const { categoria, cerca, pagina = 1 } = req.query;
  const PER_PAGE = 12;
  const skip = (parseInt(pagina) - 1) * PER_PAGE;

  const where = { isActive: true };

  if (categoria) {
    const cat = await prisma.category.findUnique({ where: { slug: categoria } });
    if (cat) where.categoryId = cat.id;
  }

  if (cerca) {
    where.OR = [
      { name: { contains: cerca, mode: 'insensitive' } },
      { shortDesc: { contains: cerca, mode: 'insensitive' } },
      { sku: { contains: cerca, mode: 'insensitive' } },
    ];
  }

  const [products, total, categories] = await Promise.all([
    prisma.product.findMany({
      where,
      include: { category: true },
      orderBy: [{ isFeatured: 'desc' }, { createdAt: 'desc' }],
      skip,
      take: PER_PAGE,
    }),
    prisma.product.count({ where }),
    prisma.category.findMany({ orderBy: { sortOrder: 'asc' } }),
  ]);

  res.render('shop/catalog', {
    products,
    categories,
    pagination: {
      current: parseInt(pagina),
      total: Math.ceil(total / PER_PAGE),
      totalItems: total,
    },
    filters: { categoria, cerca },
    title: 'Catalogo prodotti',
  });
};

// GET /shop/:slug  — dettaglio prodotto
exports.getProduct = async (req, res) => {
  const product = await prisma.product.findUnique({
    where: { slug: req.params.slug, isActive: true },
    include: { category: true },
  });

  if (!product) return res.status(404).render('error', { message: 'Prodotto non trovato', code: 404 });

  // Prodotti correlati (stessa categoria)
  const related = product.categoryId
    ? await prisma.product.findMany({
        where: { categoryId: product.categoryId, isActive: true, NOT: { id: product.id } },
        take: 4,
      })
    : [];

  res.render('shop/product', { product, related, title: product.name });
};

// ── Admin CRUD ────────────────────────────────────────────────────────────────

// GET /admin/products
exports.adminList = async (req, res) => {
  const { cerca, categoria, pagina = 1 } = req.query;
  const PER_PAGE = 20;
  const skip = (parseInt(pagina) - 1) * PER_PAGE;
  const where = {};

  if (cerca) {
    where.OR = [
      { name: { contains: cerca, mode: 'insensitive' } },
      { sku: { contains: cerca, mode: 'insensitive' } },
    ];
  }
  if (categoria) where.categoryId = categoria;

  const [products, total, categories] = await Promise.all([
    prisma.product.findMany({
      where,
      include: { category: true },
      orderBy: { createdAt: 'desc' },
      skip,
      take: PER_PAGE,
    }),
    prisma.product.count({ where }),
    prisma.category.findMany({ orderBy: { sortOrder: 'asc' } }),
  ]);

  res.render('admin/products', {
    products, categories,
    pagination: { current: parseInt(pagina), total: Math.ceil(total / PER_PAGE) },
    filters: { cerca, categoria },
    title: 'Gestione prodotti',
  });
};

// GET /admin/products/new
exports.adminNewForm = async (req, res) => {
  const categories = await prisma.category.findMany({ orderBy: { sortOrder: 'asc' } });
  res.render('admin/product-form', { product: null, categories, title: 'Nuovo prodotto' });
};

// GET /admin/products/:id/edit
exports.adminEditForm = async (req, res) => {
  const [product, categories] = await Promise.all([
    prisma.product.findUnique({ where: { id: req.params.id } }),
    prisma.category.findMany({ orderBy: { sortOrder: 'asc' } }),
  ]);
  if (!product) return res.status(404).render('error', { message: 'Prodotto non trovato', code: 404 });
  res.render('admin/product-form', { product, categories, title: `Modifica: ${product.name}` });
};

// POST /admin/products  — crea
exports.adminCreate = async (req, res) => {
  const data = _parseProductBody(req.body, req.file);
  // Genera slug dal nome
  data.slug = _slugify(data.name);

  // Controlla slug univoco
  let slug = data.slug;
  let count = 1;
  while (await prisma.product.findUnique({ where: { slug } })) {
    slug = `${data.slug}-${count++}`;
  }
  data.slug = slug;

  await prisma.product.create({ data });
  res.redirect('/admin/products?success=1');
};

// POST /admin/products/:id — aggiorna
exports.adminUpdate = async (req, res) => {
  const data = _parseProductBody(req.body, req.file);
  delete data.slug; // lo slug non cambia dopo la creazione

  await prisma.product.update({ where: { id: req.params.id }, data });
  res.redirect(`/admin/products/${req.params.id}/edit?success=1`);
};

// POST /admin/products/:id/delete
exports.adminDelete = async (req, res) => {
  await prisma.product.update({
    where: { id: req.params.id },
    data: { isActive: false },
  });
  res.redirect('/admin/products?deleted=1');
};

// POST /admin/products/:id/toggle-stock
exports.adminToggleActive = async (req, res) => {
  const product = await prisma.product.findUnique({ where: { id: req.params.id } });
  await prisma.product.update({
    where: { id: req.params.id },
    data: { isActive: !product.isActive },
  });
  res.json({ isActive: !product.isActive });
};

// ── Categorie admin ───────────────────────────────────────────────────────────

exports.adminCategories = async (req, res) => {
  const categories = await prisma.category.findMany({
    orderBy: { sortOrder: 'asc' },
    include: { _count: { select: { products: true } } },
  });
  res.render('admin/categories', { categories, title: 'Categorie' });
};

exports.adminCreateCategory = async (req, res) => {
  const { name, description, sortOrder } = req.body;
  const slug = _slugify(name);
  await prisma.category.create({ data: { name, slug, description, sortOrder: parseInt(sortOrder) || 0 } });
  res.redirect('/admin/categories?success=1');
};

exports.adminUpdateCategory = async (req, res) => {
  const { name, description, sortOrder } = req.body;
  await prisma.category.update({
    where: { id: req.params.id },
    data: { name, description, sortOrder: parseInt(sortOrder) || 0 },
  });
  res.redirect('/admin/categories?success=1');
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function _parseProductBody(body, file) {
  const priceOnRequest = body.priceOnRequest === 'on' || body.priceOnRequest === 'true';
  const data = {
    name: body.name?.trim(),
    shortDesc: body.shortDesc?.trim() || null,
    description: body.description?.trim() || null,
    price: priceOnRequest ? 0 : parseFloat(body.price) || 0,
    comparePrice: body.comparePrice ? parseFloat(body.comparePrice) : null,
    sku: body.sku?.trim() || null,
    stock: parseInt(body.stock) || 0,
    lowStockAlert: parseInt(body.lowStockAlert) || 10,
    unit: body.unit?.trim() || 'kg',
    minOrderQty: parseInt(body.minOrderQty) || 1,
    isActive: body.isActive === 'on' || body.isActive === 'true',
    isFeatured: body.isFeatured === 'on' || body.isFeatured === 'true',
    priceOnRequest,
    categoryId: body.categoryId || null,
    features: body.features
      ? body.features.split('\n').map(f => f.trim()).filter(Boolean)
      : [],
    technicalSheet: body.technicalSheet?.trim() || null,
  };

  if (file) {
    data.imageUrl = `/uploads/${file.filename}`;
  }

  return data;
}

function _slugify(str) {
  return str
    .toLowerCase()
    .trim()
    .replace(/[àáâä]/g, 'a')
    .replace(/[èéêë]/g, 'e')
    .replace(/[ìíîï]/g, 'i')
    .replace(/[òóôö]/g, 'o')
    .replace(/[ùúûü]/g, 'u')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}
