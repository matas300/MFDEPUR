const prisma = require('../../src/config/database');
const bcrypt = require('bcryptjs');

async function resetData() {
  await prisma.auditLog.deleteMany();
  await prisma.emailFailureLog.deleteMany();
  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
  await prisma.cartItem.deleteMany();
  await prisma.cart.deleteMany();
  await prisma.address.deleteMany();
  await prisma.session.deleteMany();
  await prisma.user.deleteMany();
  await prisma.company.deleteMany();
  await prisma.product.deleteMany();
  await prisma.category.deleteMany();
}

async function seedCompany(overrides = {}) {
  return prisma.company.create({
    data: {
      name: overrides.name || 'Acme Test SRL',
      vatNumber: overrides.vatNumber || `IT${Math.floor(Math.random() * 1e11)}`.padEnd(13, '0').slice(0, 13),
      status: overrides.status || 'APPROVED',
      ...overrides,
    },
  });
}

async function seedUser({ company, email, password, role = 'CUSTOMER', isEmailVerified = true } = {}) {
  const pw = password || 'TestPassword123';
  return prisma.user.create({
    data: {
      email: email || `user${Date.now()}${Math.random().toString(36).slice(2, 6)}@test.local`,
      password: await bcrypt.hash(pw, 4),
      firstName: 'Mario',
      lastName: 'Rossi',
      role,
      isEmailVerified,
      companyId: company?.id || null,
    },
  });
}

async function seedAddress(companyId, overrides = {}) {
  return prisma.address.create({
    data: {
      companyId,
      label: overrides.label || 'Sede legale',
      street: overrides.street || 'Via Roma 1',
      city: overrides.city || 'Bologna',
      province: overrides.province || 'BO',
      postalCode: overrides.postalCode || '40100',
      country: overrides.country || 'IT',
      isDefault: overrides.isDefault ?? true,
    },
  });
}

module.exports = { prisma, resetData, seedCompany, seedUser, seedAddress };
