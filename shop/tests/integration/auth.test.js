// Vitest globals (describe/it/expect/beforeEach/afterAll/vi) abilitati via vitest.config.js

// Stub nodemailer PRIMA che src/utils/email.js venga richiesto (transitivamente via src/app.js).
// In CJS vi.mock non ha hoisting ESM, quindi patchiamo direttamente il modulo in require.cache.
const nodemailer = require('nodemailer');
nodemailer.createTransport = () => ({ sendMail: async () => ({ accepted: ['test'] }) });

const { agent } = require('../helpers/app');
const { prisma, resetData } = require('../helpers/db');

describe('POST /auth/register + /auth/login (happy path)', () => {
  beforeEach(async () => {
    await resetData();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('registra una company e crea user non-verified', async () => {
    const a = agent();
    const reg = await a.get('/auth/register');
    expect(reg.status).toBe(200);
    const csrfMatch = reg.text.match(/name="_csrf"\s+value="([^"]+)"/);
    expect(csrfMatch).toBeTruthy();
    const csrf = csrfMatch[1];

    // P.IVA valida: formato IT + 11 cifre (come da validator registerRules)
    const vat = `IT${Date.now().toString().slice(-11).padStart(11, '0')}`;
    const email = `e2e_${Date.now()}@test.local`;

    const res = await a.post('/auth/register')
      .type('form')
      .send({
        _csrf: csrf,
        email,
        password: 'TestPassword123',
        firstName: 'Mario',
        lastName: 'Rossi',
        companyName: 'Acme E2E SRL',
        vatNumber: vat,
      });
    // Il controller renderizza register-success (200). Accettiamo anche 302 per robustezza.
    expect([200, 302]).toContain(res.status);

    const user = await prisma.user.findUnique({ where: { email } });
    expect(user).toBeTruthy();
    expect(user.email).toBe(email);
    expect(user.isEmailVerified).toBe(false);

    const company = await prisma.company.findUnique({ where: { id: user.companyId } });
    expect(company).toBeTruthy();
    expect(company.status).toBe('PENDING');
    expect(company.vatNumber).toBe(vat);
  });

  it('login con credenziali invalide non concede sessione', async () => {
    const a = agent();
    const reg = await a.get('/auth/login');
    const csrf = reg.text.match(/name="_csrf"\s+value="([^"]+)"/)?.[1];
    expect(csrf).toBeTruthy();

    const res = await a.post('/auth/login')
      .type('form')
      .send({ _csrf: csrf, email: 'nonexistent@test.local', password: 'wrongpass123' });

    // Invariante di sicurezza: con credenziali invalide il controller non deve
    // - impostare cookie di sessione (accessToken/refreshToken)
    // - creare Session in DB
    // - redirectare verso area privata (deve ri-renderizzare login o ritornare 4xx)
    const setCookie = res.headers['set-cookie'] || [];
    const cookiesStr = Array.isArray(setCookie) ? setCookie.join(';') : String(setCookie);
    expect(/accessToken=/.test(cookiesStr)).toBe(false);
    expect(/refreshToken=/.test(cookiesStr)).toBe(false);

    const sessionCount = await prisma.session.count();
    expect(sessionCount).toBe(0);

    // Status accettabile: 200 (re-render login) o 4xx. Non 5xx, non 3xx verso area privata.
    expect(res.status).toBeLessThan(500);
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.location || '';
      expect(loc).not.toMatch(/\/shop($|\/)|\/admin($|\/)|\/account/);
    }
  });
});
