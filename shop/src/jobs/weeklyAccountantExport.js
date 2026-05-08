const { stringify } = require('csv-stringify/sync');
const nodemailer = require('nodemailer');
const prisma = require('../config/database');
const logger = require('../utils/logger');

// Lazy transporter — riusa pattern da utils/email.js senza accoppiamento.
function getTransporter() {
  return nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: parseInt(process.env.EMAIL_PORT || '587'),
    secure: process.env.EMAIL_PORT === '465',
    auth: process.env.EMAIL_USER ? {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    } : undefined,
  });
}

const HEADERS = [
  'orderNumber', 'createdAt', 'paidAt',
  'companyName', 'vatNumber', 'sdiCode', 'pec',
  'addressStreet', 'addressCity', 'addressProvince', 'addressPostalCode',
  'subtotal', 'taxAmount', 'total',
  'paymentReference', 'status',
];

async function runWeeklyAccountantExport() {
  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const orders = await prisma.order.findMany({
    where: {
      status: { in: ['CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED'] },
      paidAt: { gte: oneWeekAgo },
    },
    include: { company: true, address: true, items: true },
    orderBy: { paidAt: 'asc' },
  });

  if (orders.length === 0) {
    logger.info({ orders: 0 }, 'weekly-accountant-export: nessun ordine nella settimana, skip email');
    return;
  }

  const rows = orders.map(o => ({
    orderNumber: o.orderNumber,
    createdAt: o.createdAt.toISOString(),
    paidAt: o.paidAt ? o.paidAt.toISOString() : '',
    companyName: o.company.name,
    vatNumber: o.company.vatNumber,
    sdiCode: o.company.sdiCode || '',
    pec: o.company.pec || '',
    addressStreet: o.address?.street || '',
    addressCity: o.address?.city || '',
    addressProvince: o.address?.province || '',
    addressPostalCode: o.address?.postalCode || '',
    subtotal: o.subtotal.toFixed(2),
    taxAmount: o.taxAmount.toFixed(2),
    total: o.total.toFixed(2),
    paymentReference: o.paymentReference || '',
    status: o.status,
  }));

  const csv = stringify(rows, { header: true, columns: HEADERS, delimiter: ';' });
  const today = new Date().toISOString().slice(0, 10);
  const filename = `mfdepur-ordini-${today}.csv`;

  const transport = getTransporter();
  await transport.sendMail({
    from: process.env.EMAIL_FROM,
    to: process.env.ACCOUNTANT_EMAIL,
    replyTo: process.env.EMAIL_REPLY_TO,
    subject: `MF Depur — ordini settimanali al ${today}`,
    text: `Buongiorno ${process.env.ACCOUNTANT_NAME || ''},\n\nin allegato il CSV degli ordini pagati nella settimana precedente al ${today}.\n\nTotale ordini: ${orders.length}\n\nPer richieste: info@mfdepur.com\n\nAutomatico — non rispondere a questa email.`,
    attachments: [{ filename, content: csv, contentType: 'text/csv' }],
  });

  await prisma.auditLog.create({
    data: {
      action: 'WEEKLY_INVOICE_EXPORT',
      entityType: 'Job',
      entityId: null,
      metadata: JSON.stringify({
        ordersCount: orders.length,
        recipient: process.env.ACCOUNTANT_EMAIL,
        filename,
      }),
    },
  });

  logger.info(
    { orders: orders.length, to: process.env.ACCOUNTANT_EMAIL, filename },
    'weekly-accountant-export: completato'
  );
}

module.exports = { runWeeklyAccountantExport };
