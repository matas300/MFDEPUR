const { PrismaClient } = require('@prisma/client');

const isProd = process.env.NODE_ENV === 'production';
const prisma = new PrismaClient({
  log: isProd ? ['warn', 'error'] : ['query', 'warn', 'error'],
});

// Middleware per gestire campi JSON (features, images) con SQLite
prisma.$use(async (params, next) => {
  // Serialize arrays to JSON before writing
  if (params.model === 'Product' && ['create', 'update', 'upsert'].includes(params.action)) {
    const data = params.args.data || params.args.create;
    if (data) {
      if (Array.isArray(data.features)) {
        data.features = JSON.stringify(data.features);
      }
      if (Array.isArray(data.images)) {
        data.images = JSON.stringify(data.images);
      }
    }
    if (params.action === 'upsert' && params.args.update) {
      if (Array.isArray(params.args.update.features)) {
        params.args.update.features = JSON.stringify(params.args.update.features);
      }
      if (Array.isArray(params.args.update.images)) {
        params.args.update.images = JSON.stringify(params.args.update.images);
      }
    }
  }

  const result = await next(params);

  // Parse JSON strings back to arrays after reading
  if (params.model === 'Product' && result) {
    const parseProduct = (p) => {
      if (p && typeof p.features === 'string') {
        try { p.features = JSON.parse(p.features); } catch { p.features = []; }
      }
      if (p && typeof p.images === 'string') {
        try { p.images = JSON.parse(p.images); } catch { p.images = []; }
      }
      return p;
    };

    if (Array.isArray(result)) {
      result.forEach(parseProduct);
    } else {
      parseProduct(result);
    }
  }

  return result;
});

module.exports = prisma;
