// Vitest globals (describe/it/expect/beforeEach/afterAll/vi) abilitati via vitest.config.js

// Stub nodemailer PRIMA che src/utils/email.js venga richiesto.
const nodemailer = require('nodemailer');
nodemailer.createTransport = () => ({ sendMail: async () => ({ accepted: ['test'] }) });

const { agent } = require('../helpers/app');
const { prisma, resetData, seedCompany, seedUser, seedAddress } = require('../helpers/db');

async function loginAndGetCheckoutCsrf(a, email, password) {
  const loginPage = await a.get('/auth/login');
  const loginCsrf = loginPage.text.match(/name="_csrf"\s+value="([^"]+)"/)?.[1];
  expect(loginCsrf).toBeTruthy();
  const loginRes = await a.post('/auth/login')
    .type('form')
    .send({ _csrf: loginCsrf, email, password });
  expect([302, 303]).toContain(loginRes.status);
  const co = await a.get('/shop/checkout');
  expect(co.status).toBe(200);
  const csrf = co.text.match(/name="_csrf"\s+value="([^"]+)"/)?.[1];
  expect(csrf).toBeTruthy();
  return csrf;
}

async function seedProductInCart(userId, { stock = 5, quantity = 2, price = 10 } = {}) {
  const cat = await prisma.category.create({ data: { name: 'T', slug: `t-${Date.now()}-${Math.random().toString(36).slice(2, 5)}` } });
  const prod = await prisma.product.create({
    data: {
      name: 'Test',
      slug: `test-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      price,
      stock,
      isActive: true,
      categoryId: cat.id,
      unit: 'kg',
    },
  });
  await prisma.cart.create({
    data: { userId, items: { create: [{ productId: prod.id, quantity }] } },
  });
  return prod;
}

describe('Checkout bonifico-only (PENDING_PAYMENT, no stock decrement)', () => {
  beforeEach(async () => { await resetData(); });
  afterAll(async () => { await prisma.$disconnect(); });

  it('checkout normale → ordine PENDING_PAYMENT, stock invariato, paymentReference null', async () => {
    const company = await seedCompany({ name: 'Bonifico SRL' });
    const buyer = await seedUser({
      company,
      email: 'buyer@test.local',
      password: 'TestPassword123',
      companyRole: 'COMPANY_ADMIN',
    });
    await seedAddress(company.id);
    const prod = await seedProductInCart(buyer.id, { stock: 5, quantity: 2 });

    const a = agent();
    const csrf = await loginAndGetCheckoutCsrf(a, buyer.email, 'TestPassword123');

    const postRes = await a.post('/shop/checkout')
      .type('form')
      .send({
        _csrf: csrf,
        paymentMethod: 'BANK_TRANSFER',
      });
    expect([302, 303]).toContain(postRes.status);

    const orders = await prisma.order.findMany({ where: { userId: buyer.id } });
    expect(orders).toHaveLength(1);
    expect(orders[0].status).toBe('PENDING_PAYMENT');
    expect(orders[0].paymentMethod).toBe('BANK_TRANSFER');
    expect(orders[0].paidAt).toBeNull();
    expect(orders[0].paymentReference).toBeNull();

    // CRITICAL: stock NON decrementato finché admin non conferma pagamento
    const prodAfter = await prisma.product.findUnique({ where: { id: prod.id } });
    expect(prodAfter.stock).toBe(5);

    // Cart svuotato
    const cart = await prisma.cart.findUnique({ where: { userId: buyer.id } });
    expect(cart?.items?.length || 0).toBe(0);
  });
});
