const prisma = require('../config/database');

module.exports = async (req, res) => {
  const baseUrl = process.env.BASE_URL || 'https://www.mfdepur.com';

  const products = await prisma.product.findMany({
    where: { isActive: true },
    select: { slug: true, updatedAt: true },
    orderBy: { updatedAt: 'desc' },
  });

  const staticPages = [
    { url: '/shop', priority: '0.9', changefreq: 'weekly' },
    { url: '/auth/login', priority: '0.5', changefreq: 'monthly' },
    { url: '/auth/register', priority: '0.6', changefreq: 'monthly' },
    { url: '/privacy', priority: '0.3', changefreq: 'yearly' },
  ];

  const today = new Date().toISOString().split('T')[0];

  const urls = [
    ...staticPages.map(p =>
      `  <url>\n    <loc>${baseUrl}${p.url}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>${p.changefreq}</changefreq>\n    <priority>${p.priority}</priority>\n  </url>`
    ),
    ...products.map(p =>
      `  <url>\n    <loc>${baseUrl}/shop/product/${p.slug}</loc>\n    <lastmod>${p.updatedAt.toISOString().split('T')[0]}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.7</priority>\n  </url>`
    ),
  ];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>`;

  res.header('Content-Type', 'application/xml');
  res.send(xml);
};
