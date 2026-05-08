const nodemailer = require('nodemailer');
const sentMails = [];
nodemailer.createTransport = () => ({
  sendMail: async (mail) => { sentMails.push(mail); return { accepted: [mail.to] }; },
});

const { prisma, resetData, seedCompany, seedUser } = require('../helpers/db');
const { runWeeklyAccountantExport } = require('../../src/jobs/weeklyAccountantExport');

describe('weeklyAccountantExport', () => {
  beforeEach(async () => {
    await resetData();
    sentMails.length = 0;
    process.env.ACCOUNTANT_EMAIL = 'commercialista@test.local';
    process.env.ACCOUNTANT_NAME = 'Studio Test';
    process.env.EMAIL_FROM = 'noreply@mfdepur.com';
    process.env.EMAIL_REPLY_TO = 'info@mfdepur.com';
  });
  afterAll(async () => { await prisma.$disconnect(); });

  it('genera CSV ordini settimana e invia email al commercialista', async () => {
    const company = await seedCompany({
      name: 'Cliente A',
      vatNumber: 'IT12345678901',
      sdiCode: 'ABCDE12',
    });
    const buyer = await seedUser({ company, email: 'b@t.l', password: 'P12345Aaa' });

    const now = new Date();
    const inWindow = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
    const outOfWindow = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    await prisma.order.createMany({
      data: [
        {
          orderNumber: 'MFD-IN-1', userId: buyer.id, companyId: company.id,
          status: 'CONFIRMED', paymentMethod: 'BANK_TRANSFER',
          subtotal: 100, taxAmount: 22, total: 122,
          paidAt: inWindow, createdAt: inWindow, updatedAt: inWindow,
        },
        {
          orderNumber: 'MFD-IN-2', userId: buyer.id, companyId: company.id,
          status: 'SHIPPED', paymentMethod: 'BANK_TRANSFER',
          subtotal: 50, taxAmount: 11, total: 61,
          paidAt: inWindow, createdAt: inWindow, updatedAt: inWindow,
        },
        {
          orderNumber: 'MFD-OUT', userId: buyer.id, companyId: company.id,
          status: 'CONFIRMED', paymentMethod: 'BANK_TRANSFER',
          subtotal: 10, taxAmount: 2.2, total: 12.2,
          paidAt: outOfWindow, createdAt: outOfWindow, updatedAt: outOfWindow,
        },
      ],
    });

    await runWeeklyAccountantExport();

    expect(sentMails).toHaveLength(1);
    const mail = sentMails[0];
    expect(mail.to).toBe('commercialista@test.local');
    expect(mail.subject).toMatch(/MF Depur.*ordini/i);
    expect(mail.attachments).toHaveLength(1);
    const csv = mail.attachments[0].content.toString();
    expect(csv).toContain('MFD-IN-1');
    expect(csv).toContain('MFD-IN-2');
    expect(csv).not.toContain('MFD-OUT');
    expect(csv).toContain('IT12345678901');

    const audit = await prisma.auditLog.findFirst({ where: { action: 'WEEKLY_INVOICE_EXPORT' } });
    expect(audit).toBeTruthy();
  });

  it('non invia email se nessun ordine nella settimana', async () => {
    await runWeeklyAccountantExport();
    expect(sentMails).toHaveLength(0);
  });
});
