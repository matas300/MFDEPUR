const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: parseInt(process.env.EMAIL_PORT || '587'),
  secure: process.env.EMAIL_PORT === '465',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

async function sendMail({ to, subject, html }) {
  return transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to,
    subject,
    html,
  });
}

// ── Templates ─────────────────────────────────────────────────────────────────

function emailWrapper(content) {
  return `
    <!DOCTYPE html><html><head>
    <meta charset="UTF-8">
    <style>
      body { font-family: Arial, sans-serif; color: #1a1a2e; background: #f5f7fa; margin: 0; padding: 0; }
      .wrap { max-width: 600px; margin: 40px auto; background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,.08); }
      .header { background: #0a3d8f; padding: 28px 32px; }
      .header h1 { color: #fff; margin: 0; font-size: 22px; letter-spacing: .5px; }
      .body { padding: 32px; }
      .footer { background: #f5f7fa; padding: 16px 32px; font-size: 12px; color: #888; }
      .btn { display: inline-block; background: #0a3d8f; color: #fff !important; padding: 12px 28px; border-radius: 6px; text-decoration: none; font-weight: bold; margin: 16px 0; }
      table { width: 100%; border-collapse: collapse; margin: 16px 0; }
      th { background: #f5f7fa; padding: 10px 12px; text-align: left; font-size: 13px; color: #555; }
      td { padding: 10px 12px; border-bottom: 1px solid #eee; font-size: 14px; }
      .total { font-weight: bold; font-size: 16px; }
    </style>
    </head><body><div class="wrap">
      <div class="header"><h1>MF Depur</h1></div>
      <div class="body">${content}</div>
      <div class="footer">MF Depur S.r.l. · Bologna, Italia · <a href="mailto:info@mfdepur.com">info@mfdepur.com</a></div>
    </div></body></html>`;
}

async function sendWelcome(user) {
  const verifyUrl = `${process.env.BASE_URL}/auth/verify-email?token=${user.emailVerifyToken}`;
  await sendMail({
    to: user.email,
    subject: 'Benvenuto in MF Depur — Verifica la tua email',
    html: emailWrapper(`
      <h2>Benvenuto, ${user.firstName}!</h2>
      <p>La tua registrazione è avvenuta con successo. Prima di procedere, verifica il tuo indirizzo email:</p>
      <a href="${verifyUrl}" class="btn">Verifica Email</a>
      <p style="color:#888;font-size:13px">Il link è valido per 24 ore.</p>
      <p>Dopo la verifica, il tuo account sarà inviato in approvazione al nostro team. Riceverai una notifica non appena sarà attivato.</p>
    `),
  });
}

async function sendCompanyApproved(user) {
  await sendMail({
    to: user.email,
    subject: 'Account approvato — Puoi iniziare ad acquistare',
    html: emailWrapper(`
      <h2>Ottima notizia, ${user.firstName}!</h2>
      <p>Il tuo account aziendale è stato <strong>approvato</strong>. Da questo momento puoi accedere al nostro catalogo e effettuare ordini.</p>
      <a href="${process.env.BASE_URL}/shop" class="btn">Vai al catalogo</a>
    `),
  });
}

async function sendOrderConfirmation(order, user) {
  const itemsHtml = order.items.map(i => `
    <tr>
      <td>${i.productName}</td>
      <td>${i.quantity} ${i.unit}</td>
      <td>€${Number(i.unitPrice).toFixed(2)}</td>
      <td>€${Number(i.total).toFixed(2)}</td>
    </tr>`).join('');

  await sendMail({
    to: user.email,
    subject: `Ordine confermato #${order.orderNumber}`,
    html: emailWrapper(`
      <h2>Ordine confermato!</h2>
      <p>Ciao ${user.firstName}, abbiamo ricevuto il tuo ordine <strong>#${order.orderNumber}</strong>.</p>
      <table>
        <thead><tr><th>Prodotto</th><th>Qtà</th><th>Prezzo unit.</th><th>Totale</th></tr></thead>
        <tbody>${itemsHtml}</tbody>
      </table>
      <table>
        <tr><td>Subtotale</td><td>€${Number(order.subtotal).toFixed(2)}</td></tr>
        <tr><td>IVA (22%)</td><td>€${Number(order.taxAmount).toFixed(2)}</td></tr>
        <tr><td>Spedizione</td><td>€${Number(order.shippingCost).toFixed(2)}</td></tr>
        <tr class="total"><td><strong>Totale</strong></td><td><strong>€${Number(order.total).toFixed(2)}</strong></td></tr>
      </table>
      <a href="${process.env.BASE_URL}/account/orders/${order.id}" class="btn">Dettaglio ordine</a>
    `),
  });
}

async function sendPasswordReset(user, resetUrl) {
  await sendMail({
    to: user.email,
    subject: 'Reset password — MF Depur',
    html: emailWrapper(`
      <h2>Reset password</h2>
      <p>Hai richiesto il reset della password per il tuo account MF Depur.</p>
      <a href="${resetUrl}" class="btn">Reimposta password</a>
      <p style="color:#888;font-size:13px">Il link è valido per 1 ora. Se non hai richiesto il reset, ignora questa email.</p>
    `),
  });
}

async function sendNewOrderNotificationAdmin(order, company) {
  const adminEmail = process.env.ADMIN_EMAIL;
  await sendMail({
    to: adminEmail,
    subject: `Nuovo ordine #${order.orderNumber} — ${company.name}`,
    html: emailWrapper(`
      <h2>Nuovo ordine ricevuto</h2>
      <p><strong>Azienda:</strong> ${company.name} (P.IVA: ${company.vatNumber})</p>
      <p><strong>N° ordine:</strong> ${order.orderNumber}</p>
      <p><strong>Totale:</strong> €${Number(order.total).toFixed(2)}</p>
      <p><strong>Metodo pagamento:</strong> ${order.paymentMethod}</p>
      <a href="${process.env.BASE_URL}/admin/orders/${order.id}" class="btn">Gestisci ordine</a>
    `),
  });
}

async function sendOrderAwaitingApproval(order, buyer, admins) {
  const itemsHtml = order.items.map(i => `
    <tr>
      <td>${i.productName}</td>
      <td>${i.quantity} ${i.unit}</td>
      <td>€${Number(i.unitPrice).toFixed(2)}</td>
      <td>€${Number(i.total).toFixed(2)}</td>
    </tr>`).join('');
  const adminUrl = `${process.env.BASE_URL}/company/orders/${order.id}`;
  const toList = admins.map(a => a.email).filter(Boolean);
  if (toList.length === 0) return;
  await sendMail({
    to: toList.join(','),
    subject: `Ordine ${order.orderNumber} in attesa di approvazione`,
    html: emailWrapper(`
      <h2>Ordine in attesa di approvazione</h2>
      <p>Un utente della tua azienda ha creato un nuovo ordine che richiede la tua approvazione prima del pagamento.</p>
      <p><strong>Richiedente:</strong> ${buyer.firstName} ${buyer.lastName} (${buyer.email})</p>
      <p><strong>N° ordine:</strong> ${order.orderNumber}</p>
      <table>
        <thead><tr><th>Prodotto</th><th>Qtà</th><th>Prezzo unit.</th><th>Totale</th></tr></thead>
        <tbody>${itemsHtml}</tbody>
      </table>
      <p class="total"><strong>Totale: €${Number(order.total).toFixed(2)}</strong></p>
      <a href="${adminUrl}" class="btn">Approva o rifiuta</a>
    `),
  });
}

module.exports = {
  sendWelcome,
  sendCompanyApproved,
  sendOrderConfirmation,
  sendPasswordReset,
  sendNewOrderNotificationAdmin,
  sendOrderAwaitingApproval,
};
