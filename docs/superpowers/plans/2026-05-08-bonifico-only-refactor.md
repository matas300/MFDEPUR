# Bonifico-only Refactor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rimuovere completamente Stripe, riscrivere il workflow di pagamento per essere solo bonifico bancario con riconciliazione manuale admin, e aggiungere il cron settimanale di export ordini al commercialista.

**Architecture:** Single workflow `PENDING_PAYMENT` → admin "marca pagato" → `CONFIRMED` → spedizione. Stock decrementato solo dopo conferma pagamento (non più al checkout). Email cliente con IBAN al checkout, email "pagamento ricevuto" alla conferma admin. Cron Node settimanale (lunedì 08:00 UTC) genera CSV ordini e lo invia per email al commercialista.

**Tech Stack:** Node 20, Express, Prisma 5 + SQLite (dev/test) / Postgres (prod), Vitest + supertest, nodemailer + Brevo SMTP, EJS templates, csrf-csrf, helmet CSP nonce.

**Spec:** `docs/superpowers/specs/2026-05-08-go-live-mvp-design.md`

---

## File map

| Path | Azione | Responsabilità |
|---|---|---|
| `shop/prisma/schema.prisma` | Modify | Aggiungi `paymentReference String?`, default `status = "PENDING_PAYMENT"`, default `paymentMethod = "BANK_TRANSFER"`. Aggiorna commento enum |
| `shop/prisma/migrations/<timestamp>_bonifico_only/migration.sql` | Create | Nuova migration Prisma: ALTER TABLE Order |
| `shop/src/config/constants.js` | Modify | Rimuovi commento Stripe in status enum, aggiorna ORDER_STATUS list |
| `shop/src/config/env.js` | Modify | Rimuovi `STRIPE_*` dal fail-fast, aggiungi `BANK_*` + `ACCOUNTANT_EMAIL` + `ACCOUNTANT_NAME` |
| `shop/src/app.js` | Modify | Rimuovi mount `/stripe/webhook` + middleware rawBody, rimuovi `js.stripe.com`/`api.stripe.com` da CSP, rimuovi commenti Stripe |
| `shop/src/controllers/orderController.js` | Modify | Rimuovi `require('stripe')`, semplifica `postCheckout` (solo bonifico), elimina `stripeWebhook`, modifica `_finalizeOrder` per non auto-confirmare bonifico, aggiungi `markOrderAsPaid` |
| `shop/src/controllers/adminController.js` | Modify | Aggiungi handler `markOrderAsPaid`, aggiorna CSV export label (rimuovi 'STRIPE'?'Carta':'Bonifico'), conferma audit log |
| `shop/src/routes/admin.js` | Modify | Aggiungi route `POST /admin/orders/:id/mark-paid` |
| `shop/src/utils/email.js` | Modify | Aggiorna `sendOrderConfirmation` per includere IBAN/causale; aggiungi `sendPaymentReceived` |
| `shop/src/views/emails/order-confirmation.ejs` | Modify | Includere blocco bonifico (IBAN, beneficiario, causale, scadenza) |
| `shop/src/views/emails/payment-received.ejs` | Create | Nuovo template "pagamento ricevuto, ordine in preparazione" |
| `shop/src/views/shop/checkout.ejs` | Modify | Rimuovi Stripe Elements, mostra solo bonifico, rimuovi `stripePublicKey` reference |
| `shop/src/views/shop/order-success.ejs` | Modify | Aggiungere blocco IBAN per ordini PENDING_PAYMENT |
| `shop/src/views/admin/orders/_mark-paid-modal.ejs` | Create | Partial modal "marca pagato" con CSRF + form |
| `shop/src/views/admin/orders/show.ejs` | Modify | Bottone "Marca pagato" + include modal partial |
| `shop/src/jobs/weeklyAccountantExport.js` | Create | Job: query ordini settimana → CSV → email commercialista → audit log |
| `shop/src/jobs/scheduler.js` | Create or Modify | Schedula `weeklyAccountantExport` con node-cron lunedì 08:00 UTC |
| `shop/server.js` | Modify | Avvia scheduler all'app boot (dopo migrate, prima di listen) |
| `shop/.env.example` | Modify | Rimuovi `STRIPE_*`, aggiungi `BANK_*`, `ACCOUNTANT_*` |
| `shop/package.json` | Modify | Rimuovi `stripe`, aggiungi `node-cron` (per scheduler), aggiungi `csv-stringify` |
| `shop/tests/integration/checkout.bonifico.test.js` | Create | Test end-to-end checkout bonifico → PENDING_PAYMENT, no stock decrement |
| `shop/tests/integration/admin.markPaid.test.js` | Create | Test admin marca pagato → CONFIRMED + stock decrement + audit log |
| `shop/tests/integration/order.approval.test.js` | Modify | Aggiornare test esistente al nuovo flusso (PENDING_PAYMENT) |
| `shop/tests/unit/jobs.weeklyAccountantExport.test.js` | Create | Test unit del job: CSV generation + email |
| `shop/docs/DEPLOYMENT.md` | Modify | Rimuovi riferimenti Stripe, aggiungi sezione "Riconciliazione bonifici" |

---

## Pre-flight

### Task 0: Branch + baseline test verde

**Files:** nessuna modifica codice, solo verifica preliminare.

- [ ] **Step 1: Crea branch dedicato**

```bash
git checkout master
git pull origin master
git checkout -b feat/bonifico-only-refactor
```

- [ ] **Step 2: Verifica test attuali passano**

```bash
cd shop
npm test
```

Atteso: tutti i test verdi (output "Test Files  N passed", "Tests  M passed").
Se rossi: STOP, indagare prima di proseguire.

- [ ] **Step 3: Verifica linter**

```bash
cd shop
npm run lint
```

Atteso: 0 errori.

- [ ] **Step 4: Crea `.env.test` se non esiste**

Verifica `shop/tests/.env.test` (richiamato da `tests/setup.js`). Se non esiste, creane uno minimale:

```env
NODE_ENV=test
DATABASE_URL="file:./test.db"
JWT_SECRET="test-secret-32chars-min-aaaaaaaaaaaaaaaaa"
JWT_REFRESH_SECRET="test-refresh-secret-32chars-min-aaaaaaaaaaa"
CSRF_SECRET="test-csrf-32chars-min-aaaaaaaaaaaaaaaaa"
STRIPE_SECRET_KEY="sk_test_dummy"
STRIPE_PUBLISHABLE_KEY="pk_test_dummy"
STRIPE_WEBHOOK_SECRET="whsec_test_dummy"
```

Note: i valori Stripe restano dummy fino al Task 4 quando vengono rimossi dal fail-fast.

- [ ] **Step 5: Commit pre-flight (se è stato creato `.env.test`)**

Se hai modificato/creato `.env.test`:

```bash
git add shop/tests/.env.test
git commit -m "chore: pre-flight env.test for bonifico refactor"
```

Altrimenti procedi al Task 1 senza commit.

---

## Task 1: Schema migration — paymentReference + nuovi default

**Files:**
- Modify: `shop/prisma/schema.prisma`
- Create: `shop/prisma/migrations/<timestamp>_bonifico_only/migration.sql` (auto-generata)

- [ ] **Step 1: Modifica schema.prisma**

Modifica il modello `Order`:

```prisma
model Order {
  id              String    @id @default(cuid())
  orderNumber     String    @unique
  userId          String
  user            User      @relation(fields: [userId], references: [id])
  companyId       String
  company         Company   @relation(fields: [companyId], references: [id])
  addressId       String?
  address         Address?  @relation(fields: [addressId], references: [id])
  status          String    @default("PENDING_PAYMENT") // PENDING_PAYMENT, AWAITING_APPROVAL, CONFIRMED, PROCESSING, SHIPPED, DELIVERED, CANCELLED, REFUNDED
  paymentMethod   String    @default("BANK_TRANSFER")  // estensibile in futuro
  paymentIntentId String?                              // legacy, rimuoveremo dopo cleanup ordini storici
  paymentReference String?                             // CRO bonifico (admin lo inserisce alla riconciliazione)
  subtotal        Decimal
  taxRate         Decimal   @default(0.22)
  taxAmount       Decimal
  shippingCost    Decimal   @default(0)
  total           Decimal
  notes           String?
  adminNotes      String?
  trackingNumber  String?
  trackingCarrier String?
  trackingUrl     String?
  paidAt          DateTime?
  shippedAt       DateTime?
  deliveredAt     DateTime?
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  items           OrderItem[]
}
```

Cambi rispetto a prima:
- `status` default da `"PENDING"` a `"PENDING_PAYMENT"`, commento aggiornato
- `paymentMethod` default da `"STRIPE"` a `"BANK_TRANSFER"`, commento aggiornato
- Aggiunto `paymentReference String?`
- `paymentIntentId` mantenuto temporaneamente per ordini storici (rimuovere in Task futuro dopo cleanup DB prod)

- [ ] **Step 2: Genera migration**

```bash
cd shop
npx prisma migrate dev --name bonifico_only
```

Atteso: nuova directory `prisma/migrations/<timestamp>_bonifico_only/migration.sql` creata. La migration contiene `ALTER TABLE Order ADD COLUMN paymentReference TEXT;` (più aggiornamento default se SQLite lo supporta, altrimenti solo metadata Prisma).

Se Prisma chiede conferma per "data loss" warning: leggere attentamente; per questa migration NON ci dovrebbe essere data loss (solo aggiunta colonna nullable + cambio default). Confermare con `y`.

- [ ] **Step 3: Verifica DB dev aggiornato**

```bash
cd shop
npx prisma studio
```

Atteso: nella tabella `Order`, colonna `paymentReference` visibile (vuota su record esistenti). Chiudere Prisma Studio (Ctrl+C).

- [ ] **Step 4: Run test suite — verifica nessuna regressione**

```bash
cd shop
npm test
```

Atteso: tutti i test verdi. Se rossi su test che leggono `paymentMethod` o `status` default: fix prima di proseguire (probabile causa: test attendeva `'STRIPE'` o `'PENDING'`, ora trova `'BANK_TRANSFER'` / `'PENDING_PAYMENT'`).

- [ ] **Step 5: Commit**

```bash
git add shop/prisma/schema.prisma shop/prisma/migrations/
git commit -m "feat(schema): paymentReference + bonifico defaults

- Order.paymentMethod default: STRIPE → BANK_TRANSFER
- Order.status default: PENDING → PENDING_PAYMENT
- Aggiunto Order.paymentReference (CRO bonifico per riconciliazione admin)"
```

---

## Task 2: Constants update

**Files:**
- Modify: `shop/src/config/constants.js`
- Modify: `shop/tests/unit/constants.test.js` (se esistente, allineare)

- [ ] **Step 1: Aggiorna constants.js**

Localizzare la sezione status enum nel file. Modificare:

```javascript
// Prima
const ORDER_STATUS = ['PENDING', 'AWAITING_APPROVAL', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'REFUNDED'];
// (Stripe webhook può portare PENDING→CONFIRMED o PENDING→PAYMENT_FAILED.)

// Dopo
const ORDER_STATUS = ['PENDING_PAYMENT', 'AWAITING_APPROVAL', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'REFUNDED'];
// PENDING_PAYMENT: ordine creato, in attesa che admin marchi pagamento ricevuto via bonifico.
// CONFIRMED: pagamento confermato (paidAt valorizzato), stock decrementato, prepara spedizione.

const PAYMENT_METHODS = ['BANK_TRANSFER']; // estensibile in futuro
```

Se il file non ha già una constant `ORDER_STATUS`/`PAYMENT_METHODS` esportata, definirla coerentemente con lo schema.

- [ ] **Step 2: Aggiorna test unit**

Apri `shop/tests/unit/constants.test.js`. Se contiene assertion su `'PENDING'` o `'STRIPE'`, aggiornarli:

```javascript
expect(ORDER_STATUS).toContain('PENDING_PAYMENT');
expect(ORDER_STATUS).not.toContain('PENDING');
expect(ORDER_STATUS).not.toContain('PAYMENT_FAILED');
expect(PAYMENT_METHODS).toEqual(['BANK_TRANSFER']);
```

- [ ] **Step 3: Run test**

```bash
cd shop
npm test -- tests/unit/constants.test.js
```

Atteso: passed.

- [ ] **Step 4: Commit**

```bash
git add shop/src/config/constants.js shop/tests/unit/constants.test.js
git commit -m "refactor(constants): ORDER_STATUS PENDING_PAYMENT, PAYMENT_METHODS solo BANK_TRANSFER"
```

---

## Task 3: ENV — rimuovi STRIPE_*, aggiungi BANK_* e ACCOUNTANT_*

**Files:**
- Modify: `shop/src/config/env.js`
- Modify: `shop/.env.example`
- Modify: `shop/tests/.env.test` (rimuovi righe STRIPE_*)
- Modify: `shop/tests/unit/env.test.js` (se necessario)

- [ ] **Step 1: Aggiorna env.js fail-fast list**

Apri `shop/src/config/env.js`. Trova il blocco `// Stripe — fail-fast sempre` (~righe 15-18). Sostituisci:

```javascript
// Prima
{ name: 'STRIPE_SECRET_KEY' },
{ name: 'STRIPE_PUBLISHABLE_KEY' },
{ name: 'STRIPE_WEBHOOK_SECRET' },

// Dopo (eliminare le 3 righe sopra, aggiungere queste)
{ name: 'BANK_BENEFICIARY' },
{ name: 'BANK_IBAN' },
{ name: 'BANK_NAME' },
{ name: 'ACCOUNTANT_EMAIL' },
{ name: 'ACCOUNTANT_NAME' },
```

`BANK_BIC` resta opzionale (non in fail-fast).

- [ ] **Step 2: Aggiorna .env.example**

Apri `shop/.env.example`. Rimuovi:

```env
STRIPE_SECRET_KEY=
STRIPE_PUBLISHABLE_KEY=
STRIPE_WEBHOOK_SECRET=
```

Aggiungi:

```env
# ── Bonifico bancario (visualizzato a cliente al checkout) ────────────────────
BANK_BENEFICIARY="MF Depur Srl"
BANK_IBAN="IT00 X000 0000 0000 0000 000000"
BANK_NAME="Banca XXX"
BANK_BIC=""

# ── Email commercialista (cron CSV settimanale) ──────────────────────────────
ACCOUNTANT_EMAIL="commercialista@studio.it"
ACCOUNTANT_NAME="Studio Rossi"
```

- [ ] **Step 3: Aggiorna .env.test**

Apri `shop/tests/.env.test`. Rimuovi `STRIPE_*`. Aggiungi:

```env
BANK_BENEFICIARY="MF Depur Test Srl"
BANK_IBAN="IT00 X000 0000 0000 0000 000000"
BANK_NAME="Banca Test"
ACCOUNTANT_EMAIL="commercialista@test.local"
ACCOUNTANT_NAME="Studio Test"
```

- [ ] **Step 4: Aggiorna test env**

Apri `shop/tests/unit/env.test.js`. Se contiene assertion su `STRIPE_*`, sostituirle con `BANK_*`/`ACCOUNTANT_*`. Se il test verifica solo "fail-fast emette errore se manca una required ENV", aggiornare la lista delle required.

- [ ] **Step 5: Run test**

```bash
cd shop
npm test -- tests/unit/env.test.js
```

Atteso: passed.

- [ ] **Step 6: Smoke load app**

```bash
cd shop
node -e "require('./src/app.js')"
```

Atteso: nessun errore (app si carica). Se errori "missing ENV STRIPE_*": qualche riferimento Stripe è rimasto nel codice — Task 4-6 lo elimineranno.

Se errori "missing ENV BANK_*": verificare che `.env` (non `.env.test`) abbia le BANK_*. In dev locale, copiare da `.env.example` aggiornato.

- [ ] **Step 7: Commit**

```bash
git add shop/src/config/env.js shop/.env.example shop/tests/.env.test shop/tests/unit/env.test.js
git commit -m "refactor(env): rimuovi STRIPE_*, aggiungi BANK_* e ACCOUNTANT_*"
```

---

## Task 4: Rimuovi Stripe da app.js (mount + CSP + middleware rawBody)

**Files:**
- Modify: `shop/src/app.js`

- [ ] **Step 1: Rimuovi import e mount webhook**

Apri `shop/src/app.js`. Rimuovi:

```javascript
const orderCtrl = require('./controllers/orderController');
```

Solo se `orderCtrl` è usato SOLO per `stripeWebhook`. Verifica con grep nello stesso file: se `orderCtrl.` appare altrove, mantieni l'import.

Rimuovi le righe 60-65 (mount Stripe webhook + middleware rawBody):

```javascript
// ── Stripe webhook (deve ricevere rawBody PRIMA di express.json) ──────────────
app.post('/stripe/webhook',
  express.raw({ type: 'application/json' }),
  (req, res, next) => { req.rawBody = req.body; next(); },
  orderCtrl.stripeWebhook
);
```

Aggiungi commento al loro posto:

```javascript
// ── Stripe rimosso (bonifico-only) ────────────────────────────────────────────
// Storico: prima di refactor 2026-05-XX qui era montato POST /stripe/webhook con
// rawBody capture. Lo shop accetta solo bonifico bancario (vedi DEPLOYMENT.md).
```

- [ ] **Step 2: Rimuovi commenti riferimenti Stripe**

Modifica linea ~28-30:

```javascript
// Prima
// Deve stare PRIMA del mount /stripe/webhook così tutti i request (anche il
// webhook) vengono loggati. `pino-http` genera `req.id` (UUID) a ogni request.

// Dopo
// `pino-http` genera `req.id` (UUID) a ogni request per correlation.
```

Modifica linea ~52:

```javascript
// Prima
// Applicato PRIMA del webhook Stripe: anche i webhook devono arrivare in HTTPS.

// Dopo
// HTTPS obbligatorio in produzione (HSTS preload + redirect 301).
```

Modifica linea ~68-69:

```javascript
// Prima
// DOPO il webhook Stripe (rawBody non va compresso in ingresso; in uscita il
// webhook risponde con piccolo JSON, non serve compressione). PRIMA di Helmet.

// Dopo
// Compression PRIMA di Helmet, threshold 1KB.
```

Modifica linea ~132:

```javascript
// Prima
// Escluso da /stripe/webhook (montato prima di questo middleware)

// Dopo
// (nessun endpoint escluso ora che Stripe webhook è rimosso)
```

- [ ] **Step 3: Rimuovi Stripe da CSP**

Localizza il blocco `helmet({contentSecurityPolicy: { directives: { ... } } })`. Rimuovi `'js.stripe.com'` da `scriptSrc` e `frameSrc`. Rimuovi `'api.stripe.com'` da `connectSrc`. Rimuovi `frameSrc: ['js.stripe.com']` interamente se diventa lista vuota (default fallback).

```javascript
// scriptSrc dopo: rimuovi 'js.stripe.com'
scriptSrc: [
  "'self'",
  (req, res) => `'nonce-${res.locals.cspNonce}'`,
  'cdn.jsdelivr.net',
  'unpkg.com',
  'cdnjs.cloudflare.com',
],

// frameSrc dopo: rimuovi entirely
// (rimuovi la riga frameSrc: ['js.stripe.com'])

// connectSrc dopo: rimuovi 'api.stripe.com'
connectSrc: ["'self'"],
```

- [ ] **Step 4: Smoke load app**

```bash
cd shop
node -e "require('./src/app.js')"
```

Atteso: nessun errore.

- [ ] **Step 5: Run test**

```bash
cd shop
npm test
```

Atteso: tutti verdi. Se ce n'è uno che testa Stripe webhook, fallirà — sarà gestito in Task 6.

- [ ] **Step 6: Commit**

```bash
git add shop/src/app.js
git commit -m "refactor(app): rimuovi mount /stripe/webhook + CSP entries Stripe"
```

---

## Task 5: Refactor orderController — rimuovi Stripe, semplifica postCheckout

**Files:**
- Modify: `shop/src/controllers/orderController.js`

- [ ] **Step 1: Scrivi test failing per nuovo flusso bonifico**

Crea `shop/tests/integration/checkout.bonifico.test.js`:

```javascript
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
```

- [ ] **Step 2: Run test — verifica fallisce**

```bash
cd shop
npm test -- tests/integration/checkout.bonifico.test.js
```

Atteso: FAIL. Probabili motivi:
- Status corrente è `CONFIRMED` (perché `_finalizeOrder` veniva chiamato per bonifico)
- Stock decrementato a 3 invece di 5

Se fallisce diversamente (es. error 500 perché manca STRIPE_SECRET_KEY): il fail-fast del Task 3 ha funzionato ma c'è un fix lato test env. Verifica `.env.test` aggiornato.

- [ ] **Step 3: Modifica orderController.js**

Apri `shop/src/controllers/orderController.js`. Effettua TUTTI questi cambi in un'unica modifica:

**3a. Rimuovi import Stripe (linea 2):**

```javascript
// Prima
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Dopo: cancella la riga
```

**3b. Rimuovi `stripePublicKey` da `getCheckout` render (linea ~67):**

```javascript
// Prima
res.render('shop/checkout', {
  cart,
  addresses,
  totals: { subtotal, taxAmount, total, shippingCost: 0 },
  stripePublicKey: process.env.STRIPE_PUBLISHABLE_KEY,
  title: 'Checkout',
  idempotencyKey,
});

// Dopo
res.render('shop/checkout', {
  cart,
  addresses,
  totals: { subtotal, taxAmount, total, shippingCost: 0 },
  bank: {
    beneficiary: process.env.BANK_BENEFICIARY,
    iban: process.env.BANK_IBAN,
    name: process.env.BANK_NAME,
    bic: process.env.BANK_BIC || null,
  },
  title: 'Checkout',
  idempotencyKey,
});
```

**3c. Modifica `postCheckout` — rimuovi branch Stripe, semplifica bonifico:**

Trova il blocco di codice da `if (paymentMethod === 'BANK_TRANSFER') { ... } else { ...Stripe... }` (~righe 216-240). Sostituisci con il flusso bonifico semplificato che NON chiama `_finalizeOrder`:

```javascript
// Crea ordine PENDING_PAYMENT, status NON viene avanzato a CONFIRMED qui;
// l'admin lo farà via markOrderAsPaid una volta ricevuto il bonifico.
const orderNumber = await generateOrderNumber();
const order = await prisma.order.create({
  data: {
    orderNumber,
    userId: req.user.id,
    companyId: req.user.companyId,
    addressId: addressId || null,
    status: 'PENDING_PAYMENT',
    paymentMethod: 'BANK_TRANSFER',
    subtotal,
    taxAmount,
    shippingCost,
    total,
    notes: notes?.trim() || null,
    items: {
      create: cart.items.map(i => ({
        productId: i.productId,
        productName: i.product.name,
        productSku: i.product.sku,
        unit: i.product.unit,
        quantity: i.quantity,
        unitPrice: i.product.price,
        total: Number(i.product.price) * i.quantity,
      })),
    },
  },
  include: { items: true, company: true },
});

if (idempotencyKey) idempotencySet(idempotencyKey, order.id);

// Svuota carrello (l'ordine è creato, anche se non ancora pagato)
await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });

// Email cliente: conferma ordine + IBAN per bonifico
await emailUtil.sendOrderConfirmation(order, req.user).catch(err =>
  logEmailFailure({
    to: req.user.email,
    subject: `Ordine ${order.orderNumber} ricevuto`,
    templateName: 'sendOrderConfirmation',
    err,
    context: { orderId: order.id },
  })
);

// Email admin: notifica nuovo ordine in attesa pagamento
await emailUtil.sendAdminNewOrderNotice(order, req.user).catch(err =>
  logEmailFailure({
    to: process.env.ADMIN_NOTIFY_EMAIL || process.env.EMAIL_FROM,
    subject: `Nuovo ordine ${order.orderNumber} in attesa pagamento`,
    templateName: 'sendAdminNewOrderNotice',
    err,
    context: { orderId: order.id },
  })
);

return res.redirect(`/shop/checkout/success?orderId=${order.id}`);
```

**3d. Elimina interamente la funzione `exports.stripeWebhook`** (~righe 257-fine della funzione, identificare la chiusura `};` e cancellare l'intero blocco).

**3e. Verifica AWAITING_APPROVAL branch** (~righe 130-180): è OK come si trova ora; lascia invariato. Solo: l'azione `paymentMethod.toUpperCase()` può rimanere ma assicurati che il valore di default sia `'BANK_TRANSFER'`.

Modifica anche la firma:

```javascript
// Prima
const { addressId, notes, paymentMethod = 'STRIPE' } = req.body;

// Dopo
const { addressId, notes } = req.body;
const paymentMethod = 'BANK_TRANSFER';
```

- [ ] **Step 4: Run test — verifica passa**

```bash
cd shop
npm test -- tests/integration/checkout.bonifico.test.js
```

Atteso: PASS.

- [ ] **Step 5: Run intera suite**

```bash
cd shop
npm test
```

Atteso: tutti verdi. Possibili rotture:
- `tests/integration/order.approval.test.js`: se asserisce `status: 'PENDING'`, aggiornare a `'PENDING_PAYMENT'`. Fix in Task 7
- Test che asseriscono stock decrementato post-checkout: aggiornare al nuovo flusso

Se altri test rossi, correggi le assertion al nuovo comportamento prima di committare.

- [ ] **Step 6: Commit**

```bash
git add shop/src/controllers/orderController.js shop/tests/integration/checkout.bonifico.test.js
git commit -m "refactor(order): bonifico-only postCheckout, no auto-finalize

- Rimosso require('stripe') e tutto il branch Stripe PaymentIntent
- Eliminata funzione stripeWebhook
- Bonifico crea ordine PENDING_PAYMENT senza decrementare stock
- Email cliente con IBAN al checkout, email admin notifica nuovo ordine
- Test integration end-to-end del nuovo flusso"
```

---

## Task 6: Aggiorna test order.approval esistente

**Files:**
- Modify: `shop/tests/integration/order.approval.test.js`

- [ ] **Step 1: Identifica assertion da aggiornare**

```bash
cd shop
grep -n "PENDING" tests/integration/order.approval.test.js
grep -n "STRIPE" tests/integration/order.approval.test.js
```

- [ ] **Step 2: Aggiorna assertion**

Sostituisci ovunque:
- `status: 'PENDING'` → `status: 'PENDING_PAYMENT'`
- `paymentMethod: 'STRIPE'` → rimuovi (non più previsto)
- Riferimenti a `paymentIntentId` → assertion che sia null

Lascia invariati gli scenari `AWAITING_APPROVAL` (sono ortogonali al refactor pagamento).

- [ ] **Step 3: Run test**

```bash
cd shop
npm test -- tests/integration/order.approval.test.js
```

Atteso: tutti i test in quel file passano.

- [ ] **Step 4: Commit**

```bash
git add shop/tests/integration/order.approval.test.js
git commit -m "test: aggiorna order.approval al flusso PENDING_PAYMENT"
```

---

## Task 7: Email — order-confirmation con IBAN, payment-received nuovo

**Files:**
- Modify: `shop/src/utils/email.js`
- Modify: `shop/src/views/emails/order-confirmation.ejs`
- Create: `shop/src/views/emails/payment-received.ejs`

- [ ] **Step 1: Aggiorna template order-confirmation.ejs**

Apri `shop/src/views/emails/order-confirmation.ejs`. Aggiungi blocco bonifico in fondo (prima del footer):

```html
<h2 style="margin-top:32px;color:#0050a0">Modalità di pagamento: bonifico bancario</h2>
<p>Per completare l'ordine effettua il bonifico ai seguenti dati:</p>
<table cellpadding="8" cellspacing="0" border="0" style="background:#f6f7f9;border-radius:8px;width:100%;max-width:520px">
  <tr>
    <td style="font-weight:600;width:160px">Beneficiario</td>
    <td><%= bank.beneficiary %></td>
  </tr>
  <tr>
    <td style="font-weight:600">IBAN</td>
    <td style="font-family:monospace"><%= bank.iban %></td>
  </tr>
  <tr>
    <td style="font-weight:600">Banca</td>
    <td><%= bank.name %></td>
  </tr>
  <% if (bank.bic) { %>
  <tr>
    <td style="font-weight:600">BIC</td>
    <td><%= bank.bic %></td>
  </tr>
  <% } %>
  <tr>
    <td style="font-weight:600">Causale</td>
    <td style="font-family:monospace"><%= order.orderNumber %></td>
  </tr>
  <tr>
    <td style="font-weight:600">Importo</td>
    <td><strong>€ <%= total %></strong></td>
  </tr>
</table>
<p style="margin-top:16px">Una volta ricevuto il pagamento procederemo con la spedizione (entro 2 giorni lavorativi).</p>
<p style="color:#666;font-size:14px">Se non ricevuto pagamento entro 7 giorni, l'ordine sarà annullato.</p>
```

- [ ] **Step 2: Crea payment-received.ejs**

Crea `shop/src/views/emails/payment-received.ejs`:

```html
<!DOCTYPE html>
<html lang="it">
<head><meta charset="UTF-8"><title>Pagamento ricevuto</title></head>
<body style="font-family:Arial,sans-serif;color:#222;max-width:640px;margin:0 auto;padding:24px">
  <h1 style="color:#0050a0">Pagamento ricevuto</h1>
  <p>Gentile <%= user.firstName %>,</p>
  <p>abbiamo ricevuto il bonifico per l'ordine <strong><%= order.orderNumber %></strong>.</p>
  <p>L'ordine è ora in preparazione e verrà spedito a breve. Riceverai una nuova email quando sarà partito, con i riferimenti per il tracking.</p>
  <h2 style="margin-top:32px;color:#0050a0">Riepilogo</h2>
  <table cellpadding="8" cellspacing="0" border="0" style="width:100%;max-width:520px">
    <tr><td>Numero ordine</td><td><strong><%= order.orderNumber %></strong></td></tr>
    <tr><td>Data ordine</td><td><%= orderDate %></td></tr>
    <tr><td>Data pagamento</td><td><%= paidDate %></td></tr>
    <tr><td>Totale</td><td><strong>€ <%= total %></strong></td></tr>
  </table>
  <p style="margin-top:32px;color:#666;font-size:13px">
    MF Depur — questa è una comunicazione automatica, per qualsiasi richiesta scrivi a <a href="mailto:info@mfdepur.com">info@mfdepur.com</a>.
  </p>
</body>
</html>
```

- [ ] **Step 3: Aggiorna email.js**

Apri `shop/src/utils/email.js`. Trova `sendOrderConfirmation`. Aggiungi al render context il `bank`:

```javascript
exports.sendOrderConfirmation = async (order, user) => {
  const html = await ejs.renderFile(
    path.join(__dirname, '..', 'views', 'emails', 'order-confirmation.ejs'),
    {
      order,
      user,
      total: order.total.toFixed(2),
      bank: {
        beneficiary: process.env.BANK_BENEFICIARY,
        iban: process.env.BANK_IBAN,
        name: process.env.BANK_NAME,
        bic: process.env.BANK_BIC || null,
      },
    }
  );
  return transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to: user.email,
    replyTo: process.env.EMAIL_REPLY_TO,
    subject: `Ordine ${order.orderNumber} ricevuto`,
    html,
  });
};
```

Aggiungi nuova funzione `sendPaymentReceived`:

```javascript
exports.sendPaymentReceived = async (order, user) => {
  const html = await ejs.renderFile(
    path.join(__dirname, '..', 'views', 'emails', 'payment-received.ejs'),
    {
      order,
      user,
      orderDate: order.createdAt.toLocaleDateString('it-IT'),
      paidDate: order.paidAt.toLocaleDateString('it-IT'),
      total: order.total.toFixed(2),
    }
  );
  return transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to: user.email,
    replyTo: process.env.EMAIL_REPLY_TO,
    subject: `Pagamento ricevuto — ordine ${order.orderNumber} in preparazione`,
    html,
  });
};
```

Aggiungi anche `sendAdminNewOrderNotice` (richiamata da postCheckout):

```javascript
exports.sendAdminNewOrderNotice = async (order, user) => {
  const html = `
    <h2>Nuovo ordine in attesa pagamento</h2>
    <p>Numero: <strong>${order.orderNumber}</strong></p>
    <p>Cliente: ${user.firstName} ${user.lastName} (${user.email})</p>
    <p>Totale: € ${order.total.toFixed(2)}</p>
    <p><a href="${process.env.APP_URL}/admin/orders/${order.id}">Apri in admin</a></p>
  `;
  return transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to: process.env.ADMIN_NOTIFY_EMAIL || process.env.EMAIL_FROM,
    subject: `[MFD] Nuovo ordine ${order.orderNumber}`,
    html,
  });
};
```

- [ ] **Step 4: Run intera test suite**

```bash
cd shop
npm test
```

Atteso: tutti verdi. Lo stub nodemailer in `tests/integration/*.test.js` (riga 4-5: `nodemailer.createTransport = () => ({ sendMail: async () => ({ accepted: ['test'] }) });`) cattura le invocazioni email; non verificano contenuto template, quindi nessuna rottura.

- [ ] **Step 5: Smoke render manuale email**

Verifica visivamente che il template renderizzi (skip in agentic execution, manuale ottimo prima di go-live).

- [ ] **Step 6: Commit**

```bash
git add shop/src/utils/email.js shop/src/views/emails/order-confirmation.ejs shop/src/views/emails/payment-received.ejs
git commit -m "feat(email): order-confirmation con IBAN, payment-received nuovo, admin notice"
```

---

## Task 8: Admin — endpoint markOrderAsPaid

**Files:**
- Modify: `shop/src/controllers/adminController.js`
- Modify: `shop/src/routes/admin.js`
- Create: `shop/tests/integration/admin.markPaid.test.js`

- [ ] **Step 1: Scrivi test failing**

Crea `shop/tests/integration/admin.markPaid.test.js`:

```javascript
const nodemailer = require('nodemailer');
nodemailer.createTransport = () => ({ sendMail: async () => ({ accepted: ['test'] }) });

const { agent } = require('../helpers/app');
const { prisma, resetData, seedCompany, seedUser, seedAddress } = require('../helpers/db');

async function loginAdmin(a) {
  const adminCompany = await seedCompany({ name: 'MF Depur Admin' });
  const admin = await seedUser({
    company: adminCompany,
    email: 'admin@mfdepur.local',
    password: 'AdminPassword123',
    role: 'ADMIN',
  });
  const loginPage = await a.get('/auth/login');
  const loginCsrf = loginPage.text.match(/name="_csrf"\s+value="([^"]+)"/)?.[1];
  const loginRes = await a.post('/auth/login')
    .type('form')
    .send({ _csrf: loginCsrf, email: admin.email, password: 'AdminPassword123' });
  expect([302, 303]).toContain(loginRes.status);
  return admin;
}

async function getCsrfFromAdminPage(a, path) {
  const page = await a.get(path);
  const csrf = page.text.match(/name="_csrf"\s+value="([^"]+)"/)?.[1];
  expect(csrf).toBeTruthy();
  return csrf;
}

describe('Admin markOrderAsPaid', () => {
  beforeEach(async () => { await resetData(); });
  afterAll(async () => { await prisma.$disconnect(); });

  it('marca ordine PENDING_PAYMENT → CONFIRMED, decrementa stock, paidAt valorizzato, audit log', async () => {
    const company = await seedCompany({ name: 'Cliente Bonifico' });
    const buyer = await seedUser({ company, email: 'buyer@test.local', password: 'BuyerPass123', companyRole: 'COMPANY_ADMIN' });
    const cat = await prisma.category.create({ data: { name: 'C', slug: `c-${Date.now()}` } });
    const prod = await prisma.product.create({
      data: { name: 'P', slug: `p-${Date.now()}`, price: 50, stock: 10, isActive: true, categoryId: cat.id, unit: 'kg' },
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
        items: { create: [{ productId: prod.id, productName: 'P', unit: 'kg', quantity: 2, unitPrice: 50, total: 100 }] },
      },
    });

    const a = agent();
    await loginAdmin(a);
    const csrf = await getCsrfFromAdminPage(a, `/admin/orders/${order.id}`);

    const res = await a.post(`/admin/orders/${order.id}/mark-paid`)
      .type('form')
      .send({ _csrf: csrf, paymentReference: 'CRO-123ABC', paidAt: '2026-05-08' });

    expect([200, 302, 303]).toContain(res.status);

    const updated = await prisma.order.findUnique({ where: { id: order.id } });
    expect(updated.status).toBe('CONFIRMED');
    expect(updated.paidAt).toBeTruthy();
    expect(updated.paymentReference).toBe('CRO-123ABC');

    const prodAfter = await prisma.product.findUnique({ where: { id: prod.id } });
    expect(prodAfter.stock).toBe(8); // decrementato di 2

    const audit = await prisma.auditLog.findFirst({ where: { action: 'PAYMENT_CONFIRMED', entityId: order.id } });
    expect(audit).toBeTruthy();
  });

  it('rifiuta mark-paid su ordine non in PENDING_PAYMENT', async () => {
    const company = await seedCompany({ name: 'X' });
    const buyer = await seedUser({ company, email: 'b@t.l', password: 'P12345Aaa' });
    const order = await prisma.order.create({
      data: {
        orderNumber: 'MFD-2026-X',
        userId: buyer.id,
        companyId: company.id,
        status: 'CONFIRMED', // già confermato
        paymentMethod: 'BANK_TRANSFER',
        subtotal: 0, taxAmount: 0, total: 0,
      },
    });

    const a = agent();
    await loginAdmin(a);
    const csrf = await getCsrfFromAdminPage(a, `/admin/orders/${order.id}`);

    const res = await a.post(`/admin/orders/${order.id}/mark-paid`)
      .type('form')
      .send({ _csrf: csrf, paymentReference: 'CRO-X' });

    expect([400, 409, 422]).toContain(res.status);
  });
});
```

- [ ] **Step 2: Run test — verifica fallisce**

```bash
cd shop
npm test -- tests/integration/admin.markPaid.test.js
```

Atteso: FAIL (route non esiste, 404 o errore CSRF).

- [ ] **Step 3: Implementa controller**

Aggiungi in `shop/src/controllers/adminController.js`:

```javascript
exports.markOrderAsPaid = async (req, res) => {
  const { id } = req.params;
  const { paymentReference, paidAt } = req.body;

  const order = await prisma.order.findUnique({
    where: { id },
    include: { items: true, user: true },
  });
  if (!order) return res.status(404).render('error', { message: 'Ordine non trovato', code: 404 });
  if (order.status !== 'PENDING_PAYMENT') {
    return res.status(409).render('error', {
      message: `Impossibile marcare pagato: ordine in stato ${order.status}`,
      code: 409,
    });
  }

  // Atomico: aggiorna ordine + decrementa stock per ogni item, in transazione
  const paidDate = paidAt ? new Date(paidAt) : new Date();
  await prisma.$transaction(async (tx) => {
    // Decrementa stock atomic
    for (const item of order.items) {
      const upd = await tx.product.updateMany({
        where: { id: item.productId, stock: { gte: item.quantity } },
        data: { stock: { decrement: item.quantity } },
      });
      if (upd.count === 0) {
        throw new Error(`INSUFFICIENT_STOCK:${item.productName}`);
      }
    }
    await tx.order.update({
      where: { id },
      data: {
        status: 'CONFIRMED',
        paidAt: paidDate,
        paymentReference: paymentReference?.trim() || null,
      },
    });
  });

  // Audit log
  await logAudit(req, {
    action: 'PAYMENT_CONFIRMED',
    entityType: 'Order',
    entityId: id,
    metadata: { paymentReference, paidAt: paidDate.toISOString(), oldStatus: 'PENDING_PAYMENT', newStatus: 'CONFIRMED' },
  });

  // Email cliente "pagamento ricevuto"
  const updated = await prisma.order.findUnique({ where: { id }, include: { user: true } });
  await emailUtil.sendPaymentReceived(updated, updated.user).catch(err =>
    logEmailFailure({
      to: updated.user.email,
      subject: `Pagamento ricevuto — ordine ${updated.orderNumber}`,
      templateName: 'sendPaymentReceived',
      err,
      context: { orderId: id },
    })
  );

  return res.redirect(`/admin/orders/${id}?paid=1`);
};
```

Imports necessari in alto al file (verificare siano già presenti):

```javascript
const prisma = require('../config/database');
const emailUtil = require('../utils/email');
const { logAudit } = require('../utils/audit');
const { logEmailFailure } = require('../utils/emailLogger');
```

- [ ] **Step 4: Aggiungi route**

Apri `shop/src/routes/admin.js`. Aggiungi:

```javascript
router.post('/orders/:id/mark-paid', adminCtrl.markOrderAsPaid);
```

(Verifica che il middleware admin auth sia già applicato a tutto il router; tipicamente lo è.)

- [ ] **Step 5: Run test — verifica passa**

```bash
cd shop
npm test -- tests/integration/admin.markPaid.test.js
```

Atteso: PASS entrambi i test (success + reject).

- [ ] **Step 6: Run intera suite**

```bash
cd shop
npm test
```

Atteso: tutti verdi.

- [ ] **Step 7: Commit**

```bash
git add shop/src/controllers/adminController.js shop/src/routes/admin.js shop/tests/integration/admin.markPaid.test.js
git commit -m "feat(admin): markOrderAsPaid endpoint con stock decrement atomico + audit log"
```

---

## Task 9: Admin UI — bottone + modal mark-paid

**Files:**
- Create: `shop/src/views/admin/orders/_mark-paid-modal.ejs`
- Modify: `shop/src/views/admin/orders/show.ejs`

- [ ] **Step 1: Crea partial modal**

Crea `shop/src/views/admin/orders/_mark-paid-modal.ejs`:

```html
<div id="mark-paid-modal" class="modal" hidden>
  <div class="modal-backdrop js-modal-close"></div>
  <div class="modal-content">
    <h3>Marca pagato — Ordine <%= order.orderNumber %></h3>
    <form method="POST" action="/admin/orders/<%= order.id %>/mark-paid">
      <%- include('../../partials/_csrf') %>
      <label>
        Data pagamento
        <input type="date" name="paidAt" value="<%= new Date().toISOString().slice(0, 10) %>" required>
      </label>
      <label>
        CRO bonifico (opzionale)
        <input type="text" name="paymentReference" maxlength="64" placeholder="es. ABC123CRO456">
      </label>
      <p>Importo atteso: <strong>€ <%= order.total.toFixed(2) %></strong></p>
      <p style="color:#666;font-size:13px">
        Conferma solo dopo verifica visiva su estratto conto. Non reversibile senza intervento manuale.
      </p>
      <div class="modal-actions">
        <button type="button" class="btn btn-secondary js-modal-close">Annulla</button>
        <button type="submit" class="btn btn-primary">Conferma pagamento</button>
      </div>
    </form>
  </div>
</div>
```

- [ ] **Step 2: Modifica show.ejs**

Apri `shop/src/views/admin/orders/show.ejs`. Trova la sezione status/azioni (cerca "status" o "btn"). Aggiungi:

```html
<% if (order.status === 'PENDING_PAYMENT') { %>
  <button type="button" class="btn btn-primary js-open-mark-paid">Marca pagato</button>
<% } %>
```

In fondo al file, prima della chiusura, includi il modal:

```html
<%- include('./_mark-paid-modal', { order }) %>
```

- [ ] **Step 3: Aggiungi JS handler (separato, no inline per CSP)**

Verifica che il file `shop/public/assets/js/admin.js` esista. Se sì, aggiungi:

```javascript
document.addEventListener('DOMContentLoaded', () => {
  const openBtn = document.querySelector('.js-open-mark-paid');
  const modal = document.getElementById('mark-paid-modal');
  if (openBtn && modal) {
    openBtn.addEventListener('click', () => { modal.hidden = false; });
    modal.querySelectorAll('.js-modal-close').forEach(el =>
      el.addEventListener('click', () => { modal.hidden = true; })
    );
  }
});
```

Se `admin.js` non è ancora linkato in `views/admin/_layout.ejs` (o equivalente), aggiungerlo:

```html
<script src="/assets/js/admin.js" nonce="<%= cspNonce %>" defer></script>
```

- [ ] **Step 4: Smoke browser test (manuale, opzionale in agentic)**

```bash
cd shop
npm run dev
```

Apri `http://localhost:3000/admin/orders/<id ordine PENDING_PAYMENT>`, clicca "Marca pagato", verifica modal si apre, submit funziona.

In agentic execution, questo step è skippato e si confida sui test integration di Task 8 + smoke render template.

- [ ] **Step 5: Commit**

```bash
git add shop/src/views/admin/orders/_mark-paid-modal.ejs shop/src/views/admin/orders/show.ejs shop/public/assets/js/admin.js
git commit -m "feat(admin-ui): bottone + modal mark-paid su show ordine PENDING_PAYMENT"
```

---

## Task 10: Aggiorna view checkout — rimuovi Stripe Elements, aggiungi blocco IBAN

**Files:**
- Modify: `shop/src/views/shop/checkout.ejs`
- Modify: `shop/src/views/shop/order-success.ejs` (se necessario)

- [ ] **Step 1: Rimuovi Stripe Elements da checkout.ejs**

Apri `shop/src/views/shop/checkout.ejs`. Cerca riferimenti a `stripe`, `Stripe(`, `card-element`, `paymentIntent`, `clientSecret`. Rimuovi:
- `<script src="https://js.stripe.com/v3/">`
- Markup `<div id="card-element">` e relativi
- Logica JS Stripe (in `public/assets/js/checkout.js` o inline)

- [ ] **Step 2: Aggiungi sezione bonifico**

Sostituisci la sezione "Metodo di pagamento" con:

```html
<section class="payment-method">
  <h2>Metodo di pagamento</h2>
  <p>Lo shop accetta esclusivamente <strong>bonifico bancario</strong>. Dopo la conferma dell'ordine riceverai via email i dati per effettuare il pagamento. La spedizione partirà entro 2 giorni lavorativi dalla ricezione del bonifico.</p>
  <input type="hidden" name="paymentMethod" value="BANK_TRANSFER">
</section>
```

Il submit del form ora va in POST `/shop/checkout` come prima, ma senza JavaScript di Stripe. Il redirect risultante porta a `/shop/checkout/success`.

- [ ] **Step 3: Aggiorna order-success.ejs**

Apri `shop/src/views/shop/order-success.ejs`. Aggiungi blocco IBAN visibile in pagina (oltre alla email):

```html
<% if (order.status === 'PENDING_PAYMENT') { %>
<section class="bank-transfer-instructions" style="background:#f6f7f9;padding:24px;border-radius:8px;margin-top:32px">
  <h2>Effettua il bonifico</h2>
  <table style="width:100%;max-width:520px">
    <tr><td>Beneficiario</td><td><%= bank.beneficiary %></td></tr>
    <tr><td>IBAN</td><td><code><%= bank.iban %></code></td></tr>
    <tr><td>Banca</td><td><%= bank.name %></td></tr>
    <% if (bank.bic) { %><tr><td>BIC</td><td><%= bank.bic %></td></tr><% } %>
    <tr><td>Causale</td><td><code><%= order.orderNumber %></code></td></tr>
    <tr><td>Importo</td><td><strong>€ <%= order.total.toFixed(2) %></strong></td></tr>
  </table>
  <p>Hai ricevuto anche una email con queste istruzioni. La spedizione parte entro 2 giorni dal pagamento ricevuto.</p>
</section>
<% } %>
```

- [ ] **Step 4: Aggiorna controller per passare `bank` a order-success**

In `shop/src/controllers/orderController.js`, modifica `exports.checkoutSuccess`:

```javascript
exports.checkoutSuccess = async (req, res) => {
  const { orderId } = req.query;
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: { include: { product: true } }, address: true, company: true },
  });
  if (!order || order.userId !== req.user.id) return res.redirect('/shop');
  res.render('shop/order-success', {
    order,
    title: 'Ordine confermato',
    bank: {
      beneficiary: process.env.BANK_BENEFICIARY,
      iban: process.env.BANK_IBAN,
      name: process.env.BANK_NAME,
      bic: process.env.BANK_BIC || null,
    },
  });
};
```

- [ ] **Step 5: Smoke render**

```bash
cd shop
npm test
```

Atteso: tutti i test passano. (Test integration coprono già il post-checkout redirect; il render della view non è asserito ma se fallisce per missing variable l'app crasha.)

- [ ] **Step 6: Commit**

```bash
git add shop/src/views/shop/checkout.ejs shop/src/views/shop/order-success.ejs shop/src/controllers/orderController.js
git commit -m "feat(checkout-ui): rimuovi Stripe Elements, mostra istruzioni IBAN"
```

---

## Task 11: Admin CSV export — rimuovi label STRIPE

**Files:**
- Modify: `shop/src/controllers/adminController.js`

- [ ] **Step 1: Localizza riga**

```bash
cd shop
grep -n "STRIPE.*Bonifico" src/controllers/adminController.js
```

- [ ] **Step 2: Sostituisci**

```javascript
// Prima
o.paymentMethod === 'STRIPE' ? 'Carta' : 'Bonifico',

// Dopo
'Bonifico',
```

- [ ] **Step 3: Run test**

```bash
cd shop
npm test
```

Atteso: tutti verdi (probabilmente nessun test asserisce il valore della label CSV).

- [ ] **Step 4: Commit**

```bash
git add shop/src/controllers/adminController.js
git commit -m "refactor(admin): CSV export sempre 'Bonifico' (no più Stripe)"
```

---

## Task 12: Cron commercialista — weekly accountant export

**Files:**
- Create: `shop/src/jobs/weeklyAccountantExport.js`
- Create: `shop/src/jobs/scheduler.js`
- Modify: `shop/server.js`
- Modify: `shop/package.json` (aggiungi `node-cron`, `csv-stringify`)
- Create: `shop/tests/unit/jobs.weeklyAccountantExport.test.js`

- [ ] **Step 1: Aggiungi dipendenze**

```bash
cd shop
npm install node-cron csv-stringify
```

Atteso: deps aggiunte a package.json. Nessun warning critico.

- [ ] **Step 2: Scrivi test failing**

Crea `shop/tests/unit/jobs.weeklyAccountantExport.test.js`:

```javascript
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
  });
  afterAll(async () => { await prisma.$disconnect(); });

  it('genera CSV ordini settimana e invia email al commercialista', async () => {
    const company = await seedCompany({ name: 'Cliente A', vatNumber: 'IT12345678901', sdiCode: 'ABCDE12' });
    const buyer = await seedUser({ company, email: 'b@t.l', password: 'P12345Aaa' });

    // 2 ordini CONFIRMED nei 7 giorni precedenti, 1 fuori finestra
    const now = new Date();
    const inWindow = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
    const outOfWindow = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    await prisma.order.createMany({
      data: [
        { orderNumber: 'MFD-IN-1', userId: buyer.id, companyId: company.id, status: 'CONFIRMED', paymentMethod: 'BANK_TRANSFER', subtotal: 100, taxAmount: 22, total: 122, paidAt: inWindow, createdAt: inWindow, updatedAt: inWindow },
        { orderNumber: 'MFD-IN-2', userId: buyer.id, companyId: company.id, status: 'SHIPPED', paymentMethod: 'BANK_TRANSFER', subtotal: 50, taxAmount: 11, total: 61, paidAt: inWindow, createdAt: inWindow, updatedAt: inWindow },
        { orderNumber: 'MFD-OUT', userId: buyer.id, companyId: company.id, status: 'CONFIRMED', paymentMethod: 'BANK_TRANSFER', subtotal: 10, taxAmount: 2.2, total: 12.2, paidAt: outOfWindow, createdAt: outOfWindow, updatedAt: outOfWindow },
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

    // Audit log creato
    const audit = await prisma.auditLog.findFirst({ where: { action: 'WEEKLY_INVOICE_EXPORT' } });
    expect(audit).toBeTruthy();
  });

  it('non invia email se nessun ordine nella settimana', async () => {
    await runWeeklyAccountantExport();
    expect(sentMails).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run test — verifica fallisce**

```bash
cd shop
npm test -- tests/unit/jobs.weeklyAccountantExport.test.js
```

Atteso: FAIL (modulo non esiste).

- [ ] **Step 4: Implementa job**

Crea `shop/src/jobs/weeklyAccountantExport.js`:

```javascript
const { stringify } = require('csv-stringify/sync');
const prisma = require('../config/database');
const transporter = require('../utils/email').__transporter || null;
const nodemailer = require('nodemailer');
const logger = require('../utils/logger');

// Lazy transporter (riusa pattern da utils/email.js)
function getTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
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
    paidAt: o.paidAt?.toISOString() || '',
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
      metadata: JSON.stringify({ ordersCount: orders.length, recipient: process.env.ACCOUNTANT_EMAIL, filename }),
    },
  });

  logger.info({ orders: orders.length, to: process.env.ACCOUNTANT_EMAIL }, 'weekly-accountant-export: completato');
}

module.exports = { runWeeklyAccountantExport };
```

- [ ] **Step 5: Run test — verifica passa**

```bash
cd shop
npm test -- tests/unit/jobs.weeklyAccountantExport.test.js
```

Atteso: PASS entrambi i test.

- [ ] **Step 6: Crea scheduler**

Crea `shop/src/jobs/scheduler.js`:

```javascript
const cron = require('node-cron');
const logger = require('../utils/logger');
const { runWeeklyAccountantExport } = require('./weeklyAccountantExport');

function startScheduler() {
  if (process.env.NODE_ENV === 'test') {
    logger.info('scheduler: skip in test env');
    return;
  }

  // Lunedì 08:00 UTC = 09:00 ora legale Italia / 10:00 ora solare
  cron.schedule('0 8 * * 1', async () => {
    try {
      logger.info('cron: starting weekly accountant export');
      await runWeeklyAccountantExport();
    } catch (err) {
      logger.error({ err }, 'cron: weekly accountant export failed');
    }
  }, { timezone: 'UTC' });

  logger.info('scheduler: started — weekly accountant export Mon 08:00 UTC');
}

module.exports = { startScheduler };
```

- [ ] **Step 7: Wire scheduler in server.js**

Apri `shop/server.js`. Dopo `app.listen(...)` (o equivalente), aggiungi:

```javascript
const { startScheduler } = require('./src/jobs/scheduler');
startScheduler();
```

- [ ] **Step 8: Smoke load app**

```bash
cd shop
NODE_ENV=development node -e "require('./server.js'); setTimeout(() => process.exit(0), 1000);" 2>&1 | grep -E "scheduler|cron"
```

Atteso: log "scheduler: started — weekly accountant export Mon 08:00 UTC".

- [ ] **Step 9: Run intera suite**

```bash
cd shop
npm test
```

Atteso: tutti verdi.

- [ ] **Step 10: Commit**

```bash
git add shop/package.json shop/package-lock.json shop/src/jobs/ shop/server.js shop/tests/unit/jobs.weeklyAccountantExport.test.js
git commit -m "feat(jobs): cron weekly export ordini al commercialista (lun 08:00 UTC)"
```

---

## Task 13: Rimuovi dipendenza stripe

**Files:**
- Modify: `shop/package.json`
- Modify: `shop/package-lock.json`

- [ ] **Step 1: Verifica nessun riferimento residuo a Stripe**

```bash
cd shop
grep -rn "stripe\|Stripe\|STRIPE" src/ views/ --include="*.js" --include="*.ejs"
```

Atteso: nessun risultato (commenti già rimossi nei task precedenti). Se appare qualcosa, rimuovi prima di proseguire.

- [ ] **Step 2: Disinstalla**

```bash
cd shop
npm uninstall stripe
```

Atteso: `stripe` rimosso da `package.json` e `package-lock.json`. Riduzione node_modules ~50MB.

- [ ] **Step 3: Smoke load app**

```bash
cd shop
node -e "require('./src/app.js')"
```

Atteso: nessun errore "Cannot find module 'stripe'".

- [ ] **Step 4: Run intera suite**

```bash
cd shop
npm test
```

Atteso: tutti verdi.

- [ ] **Step 5: Verifica npm audit**

```bash
cd shop
npm audit
```

Atteso: 0 vulnerabilities (o se presenti, non legate a stripe).

- [ ] **Step 6: Commit**

```bash
git add shop/package.json shop/package-lock.json
git commit -m "chore(deps): rimuovi stripe ^14.17.0 (bonifico-only)"
```

---

## Task 14: Aggiorna DEPLOYMENT.md

**Files:**
- Modify: `docs/DEPLOYMENT.md`

- [ ] **Step 1: Rimuovi riferimenti Stripe**

Apri `docs/DEPLOYMENT.md`. Cerca "Stripe" e rimuovi tutte le occorrenze.

- [ ] **Step 2: Aggiungi sezione "Riconciliazione bonifici"**

Aggiungi dopo la sezione "Verifica post-deploy":

```markdown
## Riconciliazione bonifici (operatività admin)

Workflow standard per ogni ordine in stato `PENDING_PAYMENT`:

1. Apri estratto conto online della banca beneficiaria.
2. Cerca bonifici in entrata con causale = `MFD-YYYY-NNNNN` (numero ordine).
3. Verifica:
   - Importo coincide con `order.total`
   - Beneficiario = ragione sociale MF Depur Srl
   - Ordinante = ragione sociale company del cliente (o sua banca tramite SEPA)
4. In `/admin/orders/<id>` clicca "Marca pagato":
   - Data pagamento (default = oggi)
   - CRO bonifico (opzionale, copia da estratto conto)
5. Conferma → ordine passa a `CONFIRMED`, stock decrementato, email cliente "ordine in preparazione".
6. Procedi con preparazione spedizione e invio tracking via "spedito".

**Non confermare** se l'importo non corrisponde: contatta il cliente prima.

**Audit log** registra ogni `PAYMENT_CONFIRMED` con `paymentReference`, `paidAt`, attore admin. Consultabile in `/admin/audit-log` o via DB.
```

- [ ] **Step 3: Aggiorna sezione ENV produzione**

Cerca la sezione che lista ENV richieste. Rimuovi `STRIPE_*`. Aggiungi:

```env
# Bonifico
BANK_BENEFICIARY="MF Depur Srl"
BANK_IBAN="..."
BANK_NAME="..."
BANK_BIC=""

# Email transazionale
SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=587
SMTP_USER=...
SMTP_PASS=...
EMAIL_FROM="MF Depur <info@mfdepur.com>"
EMAIL_REPLY_TO=info@mfdepur.com
ADMIN_NOTIFY_EMAIL=info@mfdepur.com

# Cron commercialista
ACCOUNTANT_EMAIL=...
ACCOUNTANT_NAME=...
```

- [ ] **Step 4: Verifica nessuna inconsistenza residua**

```bash
grep -n "stripe\|Stripe\|STRIPE\|paymentIntent" docs/DEPLOYMENT.md
```

Atteso: nessun risultato.

- [ ] **Step 5: Commit**

```bash
git add docs/DEPLOYMENT.md
git commit -m "docs(deployment): runbook riconciliazione bonifici, rimuovi Stripe"
```

---

## Task 15: Smoke end-to-end finale

**Files:** nessuna modifica codice.

- [ ] **Step 1: Reset DB dev**

```bash
cd shop
rm -f prisma/dev.db
npx prisma migrate deploy
npm run db:seed
```

Atteso: DB ricreato con dati seed, admin user con ADMIN_PASSWORD.

- [ ] **Step 2: Smoke browser flow completo (manuale)**

Avvia dev server:

```bash
cd shop
npm run dev
```

Browser:
1. Vai su `http://localhost:3000`
2. Registra utente nuovo + crea company (vat number fittizio)
3. Approva la company come admin (login admin → /admin/companies)
4. Da utente: aggiungi prodotti al carrello, vai a checkout
5. Submit checkout → redirect a `/shop/checkout/success`
6. Verifica:
   - Pagina success mostra IBAN + causale + totale
   - Email log su console mostra invio "order-confirmation" al cliente e "admin notice" all'admin
   - DB: ordine in `PENDING_PAYMENT`, stock prodotto INVARIATO
7. Login admin → `/admin/orders/<id>` → click "Marca pagato"
8. Compila modal con CRO e data → conferma
9. Verifica:
   - Pagina admin mostra status `CONFIRMED`
   - Email log su console mostra "payment-received" inviata al cliente
   - DB: ordine `CONFIRMED`, `paidAt` valorizzato, stock decrementato, `auditLog` ha `PAYMENT_CONFIRMED`

In agentic execution, questo step può essere skippato e ci si affida ai test integration.

- [ ] **Step 3: Run job manualmente per test**

```bash
cd shop
node -e "require('./src/jobs/weeklyAccountantExport').runWeeklyAccountantExport().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); })"
```

Atteso: log job eseguito. Se ci sono ordini in finestra: email inviata (in dev → catturata da nodemailer ethereal o log).

- [ ] **Step 4: Run finale npm test + lint**

```bash
cd shop
npm run lint
npm test
```

Atteso: 0 errori lint, tutti i test verdi.

- [ ] **Step 5: Verifica branch è clean per merge**

```bash
git status
git log --oneline master..HEAD
```

Atteso: working tree clean, ~14 commit nel branch (uno per task).

- [ ] **Step 6: (no commit, smoke finale completato)**

Pronto per PR / merge a master.

---

## Self-review

Verifica spec coverage prima di considerare il piano completo:

| Spec section | Task copertura |
|---|---|
| Schema diff | Task 1 |
| Codice da rimuovere (5 file Stripe) | Task 4, 5, 11, 13 |
| Codice nuovo (checkout, mark-paid, cron) | Task 5, 7, 8, 9, 10, 12 |
| ENV produzione | Task 3 |
| Workflow ordine cliente | Task 5, 7, 10 |
| Workflow riconciliazione admin | Task 8, 9 |
| Workflow fattura fase 1 commercialista | Task 12 |
| Email transazionale (template, sender) | Task 7 |
| DEPLOYMENT.md aggiornato | Task 14 |

**Spec section non coperti in Plan 1 (vanno in Plan 2 — infrastructure):**
- DNS records (SPF/DKIM/DMARC, Cloudflare)
- Brevo account setup
- Sentry/UptimeRobot/B2 setup
- Caddy/PM2/Postgres provisioning
- Backup pipeline
- Hetzner snapshot
- Cutover go-live

Sono fuori scope del code refactor: piano di provisioning sarà scritto separatamente come estensione di DEPLOYMENT.md.

**Type/method consistency check:**
- `runWeeklyAccountantExport` definito in Task 12, riferito in scheduler.js stesso task ✓
- `markOrderAsPaid` definito in Task 8, route in stesso task, partial UI in Task 9 ✓
- `sendPaymentReceived` definito in Task 7, chiamato in Task 8 ✓
- `sendAdminNewOrderNotice` definito in Task 7, chiamato in Task 5 ✓
- `bank` object passato a render: definito in Task 5 (postCheckout/getCheckout), Task 7 (email), Task 10 (order-success) — chiavi consistenti `{beneficiary, iban, name, bic}` ✓

**Placeholder scan:** nessun "TBD"/"TODO"/"implementare dopo" nei task.

---

## Out of scope (esplicito)

- Migrazione Postgres (M3-bis): plan separato (infra)
- 2FA admin (M7)
- API banca per auto-riconciliazione (M7)
- BullMQ + Redis email queue (M7)
- XML SDI inline (M2 con codice cliente)
- GitHub Actions deploy auto (post go-live)

## Open dipendenze esterne (richieste al cliente)

- IBAN definitivo + ragione sociale + banca per `BANK_*` ENV
- Email + nome studio commercialista per `ACCOUNTANT_*` ENV

Senza questi due input il deploy in prod non parte (fail-fast su env.js); per dev/test sono OK valori dummy.
