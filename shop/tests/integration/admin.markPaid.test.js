// Vitest globals (describe/it/expect/beforeEach/afterAll/vi) abilitati via vitest.config.js

// Stub nodemailer PRIMA che src/utils/email.js venga richiesto.
const nodemailer = require('nodemailer');
nodemailer.createTransport = () => ({ sendMail: async () => ({ accepted: ['test'] }) });

const { agent } = require('../helpers/app');
const { prisma, resetData, seedCompany, seedUser } = require('../helpers/db');

async function loginAsAdmin(a) {
  const adminCompany = await seedCompany({ name: 'MF Depur Admin Co' });
  const admin = await seedUser({
    company: adminCompany,
    email: 'admin-mp@mfdepur.local',
    password: 'AdminPassword123',
    role: 'ADMIN',
  });
  const loginPage = await a.get('/auth/login');
  const loginCsrf = loginPage.text.match(/name="_csrf"\s+value="([^"]+)"/)?.[1];
  expect(loginCsrf).toBeTruthy();
  const loginRes = await a.post('/auth/login')
    .type('form')
    .send({ _csrf: loginCsrf, email: admin.email, password: 'AdminPassword123' });
  expect([302, 303]).toContain(loginRes.status);
  return admin;
}

async function getCsrfFrom(a, path) {
  const page = await a.get(path);
  const csrf = page.text.match(/name="_csrf"\s+value="([^"]+)"/)?.[1];
  expect(csrf).toBeTruthy();
  return csrf;
}

describe('Admin POST /admin/orders/:id/mark-paid', () => {
  beforeEach(async () => { await resetData(); });
  afterAll(async () => { await prisma.$disconnect(); });

  it('marca PENDING_PAYMENT → CONFIRMED, decrementa stock, audit log, paidAt valorizzato', async () => {
    const company = await seedCompany({ name: 'Cliente Bonifico' });
    const buyer = await seedUser({
      company,
      email: 'buyer-mp@test.local',
      password: 'BuyerPass123',
      companyRole: 'COMPANY_ADMIN',
    });
    const cat = await prisma.category.create({ data: { name: 'C', slug: `c-${Date.now()}` } });
    const prod = await prisma.product.create({
      data: {
        name: 'P',
        slug: `p-${Date.now()}`,
        price: 50,
        stock: 10,
        isActive: true,
        categoryId: cat.id,
        unit: 'kg',
      },
    });
    const order = await prisma.order.create({
      data: {
        orderNumber: 'MFD-2026-9999',
        userId: buyer.id,
        companyId: company.id,
        status: 'PENDING_PAYMENT',
        paymentMethod: 'BANK_TRANSFER',
        subtotal: 100,
        taxAmount: 22,
        total: 122,
        items: {
          create: [{
            productId: prod.id,
            productName: 'P',
            unit: 'kg',
            quantity: 2,
            unitPrice: 50,
            total: 100,
          }],
        },
      },
    });

    const a = agent();
    await loginAsAdmin(a);
    const csrf = await getCsrfFrom(a, `/admin/orders/${order.id}`);

    const res = await a.post(`/admin/orders/${order.id}/mark-paid`)
      .type('form')
      .send({
        _csrf: csrf,
        paymentReference: 'CRO-123ABC',
        paidAt: '2026-05-08',
      });

    expect([200, 302, 303]).toContain(res.status);

    const updated = await prisma.order.findUnique({ where: { id: order.id } });
    expect(updated.status).toBe('CONFIRMED');
    expect(updated.paidAt).toBeTruthy();
    expect(updated.paymentReference).toBe('CRO-123ABC');

    const prodAfter = await prisma.product.findUnique({ where: { id: prod.id } });
    expect(prodAfter.stock).toBe(8);

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'PAYMENT_CONFIRMED', entityId: order.id },
    });
    expect(audit).toBeTruthy();
  });

  it('rifiuta mark-paid su ordine non in PENDING_PAYMENT', async () => {
    const company = await seedCompany({ name: 'X SRL' });
    const buyer = await seedUser({ company, email: 'b-x@t.l', password: 'P12345Aaa' });
    const order = await prisma.order.create({
      data: {
        orderNumber: 'MFD-2026-X',
        userId: buyer.id,
        companyId: company.id,
        status: 'CONFIRMED',
        paymentMethod: 'BANK_TRANSFER',
        subtotal: 0,
        taxAmount: 0,
        total: 0,
      },
    });

    const a = agent();
    await loginAsAdmin(a);
    const csrf = await getCsrfFrom(a, `/admin/orders/${order.id}`);

    const res = await a.post(`/admin/orders/${order.id}/mark-paid`)
      .type('form')
      .send({ _csrf: csrf, paymentReference: 'CRO-X' });

    expect([400, 409, 422]).toContain(res.status);

    const after = await prisma.order.findUnique({ where: { id: order.id } });
    expect(after.status).toBe('CONFIRMED');
  });

  it('rifiuta non-admin', async () => {
    const company = await seedCompany({ name: 'NoAuth SRL' });
    const buyer = await seedUser({
      company,
      email: 'noauth@test.local',
      password: 'P12345Aaa',
      companyRole: 'COMPANY_ADMIN',
    });
    const order = await prisma.order.create({
      data: {
        orderNumber: 'MFD-2026-Y',
        userId: buyer.id,
        companyId: company.id,
        status: 'PENDING_PAYMENT',
        paymentMethod: 'BANK_TRANSFER',
        subtotal: 0,
        taxAmount: 0,
        total: 0,
      },
    });

    // Login come buyer (not admin)
    const a = agent();
    const loginPage = await a.get('/auth/login');
    const loginCsrf = loginPage.text.match(/name="_csrf"\s+value="([^"]+)"/)?.[1];
    const loginRes = await a.post('/auth/login')
      .type('form')
      .send({ _csrf: loginCsrf, email: buyer.email, password: 'P12345Aaa' });
    expect([302, 303]).toContain(loginRes.status);

    // CSRF fresco da una GET autenticata
    const accountPage = await a.get('/account');
    const csrf = accountPage.text.match(/name="_csrf"\s+value="([^"]+)"/)?.[1];
    expect(csrf).toBeTruthy();

    const res = await a.post(`/admin/orders/${order.id}/mark-paid`)
      .type('form')
      .send({ _csrf: csrf, paymentReference: 'X' });

    // requireAdmin → 403 (admin auth blocca prima del controller)
    expect([302, 303, 401, 403]).toContain(res.status);
  });
});
