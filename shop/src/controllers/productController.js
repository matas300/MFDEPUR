const prisma = require('../config/database');
const fs = require('fs');
const { logAudit } = require('../utils/audit');

// Clamp helpers — normalizzano input numerico: NaN → def, fuori range → clamp
const clampInt = (v, min, max, def = 0) => {
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) return def;
  return Math.max(min, Math.min(max, n));
};
const clampFloat = (v, min, max, def = 0) => {
  const n = parseFloat(v);
  if (Number.isNaN(n)) return def;
  return Math.max(min, Math.min(max, n));
};

// ── Shop pubblico ─────────────────────────────────────────────────────────────

// Normalizza qualsiasi valore di query in stringa sicura (primo elemento se array)
function qStr(v) {
  if (v == null) return '';
  if (Array.isArray(v)) v = v[0];
  if (typeof v !== 'string') return '';
  return v.slice(0, 200); // cap lunghezza per evitare payload giganti
}

// GET /shop  — catalogo con filtri
exports.getCatalog = async (req, res) => {
  const categoria = qStr(req.query.categoria);
  const cerca = qStr(req.query.cerca);
  const pmin = qStr(req.query.pmin);
  const pmax = qStr(req.query.pmax);
  const ordina = qStr(req.query.ordina);
  const paginaRaw = qStr(req.query.pagina) || '1';
  const PER_PAGE = 12;
  const paginaNum = Math.max(parseInt(paginaRaw, 10) || 1, 1);
  const skip = (paginaNum - 1) * PER_PAGE;

  const where = { isActive: true };

  if (categoria) {
    const cat = await prisma.category.findUnique({ where: { slug: categoria } });
    if (cat) where.categoryId = cat.id;
  }

  if (cerca) {
    where.OR = [
      { name: { contains: cerca } },
      { shortDesc: { contains: cerca } },
      { sku: { contains: cerca } },
    ];
  }

  const priceFilter = {};
  const pminN = parseFloat(pmin);
  const pmaxN = parseFloat(pmax);
  if (Number.isFinite(pminN) && pminN >= 0) priceFilter.gte = pminN;
  if (Number.isFinite(pmaxN) && pmaxN >= 0) priceFilter.lte = pmaxN;
  if (Object.keys(priceFilter).length) {
    where.AND = [{ price: priceFilter }, { priceOnRequest: false }];
  }

  const sortOptions = {
    'price-asc':  [{ priceOnRequest: 'asc' }, { price: 'asc' }],
    'price-desc': [{ priceOnRequest: 'asc' }, { price: 'desc' }],
    'name-asc':   [{ name: 'asc' }],
    'newest':     [{ isFeatured: 'desc' }, { createdAt: 'desc' }],
  };
  const orderBy = sortOptions[ordina] || sortOptions.newest;

  const [products, total, categories] = await Promise.all([
    prisma.product.findMany({
      where,
      include: { category: true },
      orderBy,
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
      current: paginaNum,
      total: Math.ceil(total / PER_PAGE),
      totalItems: total,
    },
    filters: { categoria, cerca, pmin, pmax, ordina: ordina || 'newest' },
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
  const cerca = qStr(req.query.cerca);
  const categoria = qStr(req.query.categoria);
  const paginaRaw = qStr(req.query.pagina) || '1';
  const PER_PAGE = 20;
  const paginaNum = Math.max(parseInt(paginaRaw, 10) || 1, 1);
  const skip = (paginaNum - 1) * PER_PAGE;
  const where = {};

  if (cerca) {
    where.OR = [
      { name: { contains: cerca } },
      { sku: { contains: cerca } },
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
    pagination: { current: paginaNum, total: Math.ceil(total / PER_PAGE) },
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

  // Verifica existence categoryId (se fornito)
  if (data.categoryId) {
    const cat = await prisma.category.findUnique({
      where: { id: data.categoryId },
      select: { id: true },
    });
    if (!cat) {
      return res.status(400).render('error', { message: 'Categoria non valida.', code: 400 });
    }
  }

  // Genera slug dal nome
  data.slug = _slugify(data.name);

  // Controlla slug univoco
  let slug = data.slug;
  let count = 1;
  while (await prisma.product.findUnique({ where: { slug } })) {
    slug = `${data.slug}-${count++}`;
  }
  data.slug = slug;

  const created = await prisma.product.create({ data });
  logAudit(req, { action: 'PRODUCT_CREATE', entityType: 'Product', entityId: created.id, metadata: { name: created.name, sku: created.sku } });
  res.redirect('/admin/products?success=1');
};

// POST /admin/products/:id — aggiorna
exports.adminUpdate = async (req, res) => {
  // Verifica existence product
  const existing = await prisma.product.findUnique({
    where: { id: req.params.id },
    select: { id: true },
  });
  if (!existing) {
    return res.status(404).render('error', { message: 'Prodotto non trovato.', code: 404 });
  }

  const data = _parseProductBody(req.body, req.file);
  delete data.slug; // lo slug non cambia dopo la creazione

  // Verifica existence categoryId (se fornito)
  if (data.categoryId) {
    const cat = await prisma.category.findUnique({
      where: { id: data.categoryId },
      select: { id: true },
    });
    if (!cat) {
      return res.status(400).render('error', { message: 'Categoria non valida.', code: 400 });
    }
  }

  await prisma.product.update({ where: { id: req.params.id }, data });
  logAudit(req, { action: 'PRODUCT_UPDATE', entityType: 'Product', entityId: req.params.id, metadata: { name: data.name, priceOnRequest: data.priceOnRequest, isActive: data.isActive } });
  res.redirect(`/admin/products/${req.params.id}/edit?success=1`);
};

// POST /admin/products/:id/delete
exports.adminDelete = async (req, res) => {
  await prisma.product.update({
    where: { id: req.params.id },
    data: { isActive: false },
  });
  logAudit(req, { action: 'PRODUCT_DELETE', entityType: 'Product', entityId: req.params.id });
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
  await prisma.category.create({
    data: { name, slug, description, sortOrder: clampInt(sortOrder, 0, 10_000, 0) },
  });
  res.redirect('/admin/categories?success=1');
};

exports.adminUpdateCategory = async (req, res) => {
  const { name, description, sortOrder } = req.body;
  await prisma.category.update({
    where: { id: req.params.id },
    data: { name, description, sortOrder: clampInt(sortOrder, 0, 10_000, 0) },
  });
  res.redirect('/admin/categories?success=1');
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function _parseProductBody(body, file) {
  const priceOnRequest = body.priceOnRequest === 'on' || body.priceOnRequest === 'true';
  const data = {
    name: body.name?.trim(),
    shortDesc: body.shortDesc?.trim().slice(0, 300) || null,
    description: body.description?.trim() || null,
    price: priceOnRequest ? 0 : clampFloat(body.price, 0, 1_000_000, 0),
    comparePrice: body.comparePrice ? clampFloat(body.comparePrice, 0, 1_000_000, 0) : null,
    sku: body.sku?.trim() || null,
    stock: clampInt(body.stock, 0, 1_000_000, 0),
    lowStockAlert: clampInt(body.lowStockAlert, 0, 10_000, 10),
    unit: body.unit?.trim() || 'kg',
    minOrderQty: clampInt(body.minOrderQty, 1, 10_000, 1),
    isActive: body.isActive === 'on' || body.isActive === 'true',
    isFeatured: body.isFeatured === 'on' || body.isFeatured === 'true',
    priceOnRequest,
    categoryId: body.categoryId || null,
    features: body.features
      ? body.features.split('\n').map(f => f.trim()).filter(Boolean)
      : [],
    technicalSheet: body.technicalSheet?.trim() || null,
  };

  // Sanity: comparePrice deve essere > price, altrimenti null
  if (data.comparePrice !== null && data.comparePrice <= data.price) {
    data.comparePrice = null;
  }

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
