// Vitest globals (describe/it/expect/beforeEach/afterAll/vi) abilitati via vitest.config.js

// Stub nodemailer PRIMA che src/utils/email.js venga richiesto (via src/app.js).
// In CJS vi.mock non ha hoisting ESM: patchiamo direttamente il modulo.
const nodemailer = require('nodemailer');
nodemailer.createTransport = () => ({ sendMail: async () => ({ accepted: ['test'] }) });

const { agent } = require('../helpers/app');
const { prisma, resetData, seedCompany, seedUser, seedAddress } = require('../helpers/db');

describe('RBAC / IDOR su addressId al checkout', () => {
  beforeEach(async () => {
    await resetData();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('utente di company A riceve 403 se usa addressId di company B (M0-B-4 fix)', async () => {
    const companyA = await seedCompany({ name: 'Alpha SRL' });
    const companyB = await seedCompany({ name: 'Beta SRL' });
    const userA = await seedUser({
      company: companyA,
      email: 'user_a@test.local',
      password: 'TestPassword123',
    });
    await seedAddress(companyA.id, { street: 'Via Alpha' });
    const addressB = await seedAddress(companyB.id, { street: 'Via Beta' });

    const a = agent();
    const loginPage = await a.get('/auth/login');
    const loginCsrf = loginPage.text.match(/name="_csrf"\s+value="([^"]+)"/)?.[1];
    expect(loginCsrf).toBeTruthy();

    const loginRes = await a.post('/auth/login')
      .type('form')
      .send({ _csrf: loginCsrf, email: userA.email, password: 'TestPassword123' });
    // Login deve aver avuto successo (redirect 302)
    expect([302, 303]).toContain(loginRes.status);

    // Seed cart minimo per raggiungere checkout POST
    const cat = await prisma.category.create({ data: { name: 'T', slug: 't' } });
    const prod = await prisma.product.create({
      data: {
        name: 'Test',
        slug: 'test',
        price: 10,
        stock: 5,
        isActive: true,
        categoryId: cat.id,
        unit: 'kg',
      },
    });
    await prisma.cart.create({
      data: { userId: userA.id, items: { create: [{ productId: prod.id, quantity: 1 }] } },
    });

    const co = await a.get('/shop/checkout');
    expect(co.status).toBe(200);
    const csrf = co.text.match(/name="_csrf"\s+value="([^"]+)"/)?.[1];
    expect(csrf).toBeTruthy();

    const postRes = await a.post('/shop/checkout')
      .type('form')
      .send({
        _csrf: csrf,
        addressId: addressB.id,
        paymentMethod: 'BANK_TRANSFER',
        idempotencyKey: 'rbac-test-key',
      });

    // Il controller ritorna 403 con render('error') — vedi orderController.postCheckout:
    //   if (!addr) return res.status(403).render('error', { message: 'Indirizzo non valido...' })
    expect(postRes.status).toBe(403);
    expect(postRes.text).toMatch(/non valid|non autorizz|indirizz/i);

    // Invariante business: nessun ordine creato per l'utente, nessun ordine che punta all'address di B
    const ordersByUser = await prisma.order.count({ where: { userId: userA.id } });
    expect(ordersByUser).toBe(0);

    const ordersOnAddressB = await prisma.order.count({ where: { addressId: addressB.id } });
    expect(ordersOnAddressB).toBe(0);
  });
});
