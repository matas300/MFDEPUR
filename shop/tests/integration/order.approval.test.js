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

describe('Approval workflow su postCheckout (requiresOrderApproval)', () => {
  beforeEach(async () => {
    await resetData();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('BUYER con company.requiresOrderApproval=true → ordine AWAITING_APPROVAL, stock invariato, no paymentIntentId', async () => {
    const company = await seedCompany({ name: 'Approva SRL', requiresOrderApproval: true });
    const buyer = await seedUser({
      company,
      email: 'buyer@test.local',
      password: 'TestPassword123',
      companyRole: 'BUYER',
    });
    // COMPANY_ADMIN per ricevere notifica (anche se email è stub)
    await seedUser({
      company,
      email: 'admin@test.local',
      password: 'TestPassword123',
      companyRole: 'COMPANY_ADMIN',
    });
    await seedAddress(company.id);

    const prod = await seedProductInCart(buyer.id, { stock: 5, quantity: 2 });
    const stockBefore = prod.stock;

    const a = agent();
    const csrf = await loginAndGetCheckoutCsrf(a, buyer.email, 'TestPassword123');

    const postRes = await a.post('/shop/checkout')
      .type('form')
      .send({
        _csrf: csrf,
        paymentMethod: 'BANK_TRANSFER',
        idempotencyKey: 'approval-test-1',
      });

    expect([302, 303]).toContain(postRes.status);
    expect(postRes.headers.location).toMatch(/awaitingApproval=1/);

    const orders = await prisma.order.findMany({ where: { userId: buyer.id } });
    expect(orders).toHaveLength(1);
    expect(orders[0].status).toBe('AWAITING_APPROVAL');
    expect(orders[0].paymentIntentId).toBeNull();

    const prodAfter = await prisma.product.findUnique({ where: { id: prod.id } });
    expect(prodAfter.stock).toBe(stockBefore);
  });

  it('COMPANY_ADMIN con company.requiresOrderApproval=true → flusso normale (CONFIRMED via BANK_TRANSFER)', async () => {
    const company = await seedCompany({ name: 'Approva2 SRL', requiresOrderApproval: true });
    const admin = await seedUser({
      company,
      email: 'cadmin@test.local',
      password: 'TestPassword123',
      companyRole: 'COMPANY_ADMIN',
    });
    await seedAddress(company.id);

    const prod = await seedProductInCart(admin.id, { stock: 5, quantity: 2 });
    const stockBefore = prod.stock;

    const a = agent();
    const csrf = await loginAndGetCheckoutCsrf(a, admin.email, 'TestPassword123');

    const postRes = await a.post('/shop/checkout')
      .type('form')
      .send({
        _csrf: csrf,
        paymentMethod: 'BANK_TRANSFER',
        idempotencyKey: 'approval-test-2',
      });

    expect([302, 303]).toContain(postRes.status);
    expect(postRes.headers.location).not.toMatch(/awaitingApproval=1/);

    const orders = await prisma.order.findMany({ where: { userId: admin.id } });
    expect(orders).toHaveLength(1);
    expect(orders[0].status).toBe('CONFIRMED');

    const prodAfter = await prisma.product.findUnique({ where: { id: prod.id } });
    expect(prodAfter.stock).toBe(stockBefore - 2);
  });

  it('COMPANY_ADMIN approva un ordine AWAITING_APPROVAL della propria company → status PENDING + audit', async () => {
    const company = await seedCompany({ name: 'ApprovaCA SRL', requiresOrderApproval: true });
    const buyer = await seedUser({
      company,
      email: 'buyer-ca@test.local',
      password: 'TestPassword123',
      companyRole: 'BUYER',
    });
    const admin = await seedUser({
      company,
      email: 'cadmin-ca@test.local',
      password: 'TestPassword123',
      companyRole: 'COMPANY_ADMIN',
    });
    await seedAddress(company.id);

    // BUYER crea l'ordine in AWAITING_APPROVAL via checkout
    const prod = await seedProductInCart(buyer.id, { stock: 5, quantity: 2 });
    const aBuyer = agent();
    const csrfBuyer = await loginAndGetCheckoutCsrf(aBuyer, buyer.email, 'TestPassword123');
    await aBuyer.post('/shop/checkout')
      .type('form')
      .send({ _csrf: csrfBuyer, paymentMethod: 'BANK_TRANSFER', idempotencyKey: 'ca-approve-1' });

    const order = await prisma.order.findFirst({ where: { userId: buyer.id } });
    expect(order.status).toBe('AWAITING_APPROVAL');

    // COMPANY_ADMIN login e approve
    const aAdmin = agent();
    const loginPage = await aAdmin.get('/auth/login');
    const loginCsrf = loginPage.text.match(/name="_csrf"\s+value="([^"]+)"/)?.[1];
    await aAdmin.post('/auth/login')
      .type('form')
      .send({ _csrf: loginCsrf, email: admin.email, password: 'TestPassword123' });

    const detailPage = await aAdmin.get(`/company/orders/${order.id}`);
    expect(detailPage.status).toBe(200);
    const csrf = detailPage.text.match(/name="_csrf"\s+value="([^"]+)"/)?.[1];
    expect(csrf).toBeTruthy();

    const res = await aAdmin.post(`/company/orders/${order.id}/approve`)
      .type('form')
      .send({ _csrf: csrf });
    expect([302, 303]).toContain(res.status);

    const after = await prisma.order.findUnique({ where: { id: order.id } });
    expect(after.status).toBe('PENDING');

    const audit = await prisma.auditLog.findFirst({
      where: { entityType: 'Order', entityId: order.id, action: 'ORDER_APPROVE' },
    });
    expect(audit).toBeTruthy();
  });

  it('COMPANY_ADMIN rifiuta un ordine AWAITING_APPROVAL → status CANCELLED + audit', async () => {
    const company = await seedCompany({ name: 'RifiutaCA SRL', requiresOrderApproval: true });
    const buyer = await seedUser({
      company,
      email: 'buyer-cr@test.local',
      password: 'TestPassword123',
      companyRole: 'BUYER',
    });
    const admin = await seedUser({
      company,
      email: 'cadmin-cr@test.local',
      password: 'TestPassword123',
      companyRole: 'COMPANY_ADMIN',
    });
    await seedAddress(company.id);

    const prod = await seedProductInCart(buyer.id, { stock: 5, quantity: 2 });
    const aBuyer = agent();
    const csrfBuyer = await loginAndGetCheckoutCsrf(aBuyer, buyer.email, 'TestPassword123');
    await aBuyer.post('/shop/checkout')
      .type('form')
      .send({ _csrf: csrfBuyer, paymentMethod: 'BANK_TRANSFER', idempotencyKey: 'ca-reject-1' });

    const order = await prisma.order.findFirst({ where: { userId: buyer.id } });
    expect(order.status).toBe('AWAITING_APPROVAL');

    const aAdmin = agent();
    const loginPage = await aAdmin.get('/auth/login');
    const loginCsrf = loginPage.text.match(/name="_csrf"\s+value="([^"]+)"/)?.[1];
    await aAdmin.post('/auth/login')
      .type('form')
      .send({ _csrf: loginCsrf, email: admin.email, password: 'TestPassword123' });

    const detailPage = await aAdmin.get(`/company/orders/${order.id}`);
    const csrf = detailPage.text.match(/name="_csrf"\s+value="([^"]+)"/)?.[1];

    const res = await aAdmin.post(`/company/orders/${order.id}/reject`)
      .type('form')
      .send({ _csrf: csrf });
    expect([302, 303]).toContain(res.status);

    const after = await prisma.order.findUnique({ where: { id: order.id } });
    expect(after.status).toBe('CANCELLED');

    const audit = await prisma.auditLog.findFirst({
      where: { entityType: 'Order', entityId: order.id, action: 'ORDER_REJECT' },
    });
    expect(audit).toBeTruthy();
  });

  it('BUYER con company.requiresOrderApproval=false → flusso normale (CONFIRMED via BANK_TRANSFER)', async () => {
    const company = await seedCompany({ name: 'NoApprova SRL', requiresOrderApproval: false });
    const buyer = await seedUser({
      company,
      email: 'buyer2@test.local',
      password: 'TestPassword123',
      companyRole: 'BUYER',
    });
    await seedAddress(company.id);

    const prod = await seedProductInCart(buyer.id, { stock: 5, quantity: 2 });
    const stockBefore = prod.stock;

    const a = agent();
    const csrf = await loginAndGetCheckoutCsrf(a, buyer.email, 'TestPassword123');

    const postRes = await a.post('/shop/checkout')
      .type('form')
      .send({
        _csrf: csrf,
        paymentMethod: 'BANK_TRANSFER',
        idempotencyKey: 'approval-test-3',
      });

    expect([302, 303]).toContain(postRes.status);
    expect(postRes.headers.location).not.toMatch(/awaitingApproval=1/);

    const orders = await prisma.order.findMany({ where: { userId: buyer.id } });
    expect(orders).toHaveLength(1);
    expect(orders[0].status).toBe('CONFIRMED');

    const prodAfter = await prisma.product.findUnique({ where: { id: prod.id } });
    expect(prodAfter.stock).toBe(stockBefore - 2);
  });
});
