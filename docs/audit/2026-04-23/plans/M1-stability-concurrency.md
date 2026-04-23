# M1 — Stability & Concurrency (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development`. Steps usano checkbox (`- [ ]`). Un task → un commit.

**Goal:** Rendere `shop/` resistente a concorrenza, shutdown forzato, failure di I/O (SMTP/Stripe) e unhandled rejection. Blocker go-live (gate M1+M2+M3+M4).

**Architecture:**
- `asyncHandler(fn)` util montato a livello di **route** (wrappa handler → cattura rejection → `next(err)` → error handler centrale in `app.js`).
- `observability.js` wrapper Sentry **opt-in** (no-op se `SENTRY_DSN` mancante, così dev non richiede DSN).
- `server.js` riscritto con graceful shutdown: cattura `SIGTERM`/`SIGINT`, chiude server HTTP (`server.close`) + Prisma, timeout 30s fallback a `exit(1)`. `unhandledRejection`/`uncaughtException` → log → `shutdown('FATAL')`.
- `orderController._finalizeOrder` avvolto in `prisma.$transaction(async tx => ...)` — ricalcolo server-side totali + decremento stock atomico + creazione OrderItems.
- Idempotency: `idempotencyKey` sul `POST /shop/checkout` (generato dal client dal CSRF token o UUID form-scoped) propagato a Stripe + TTL in-memory/DB per dedupe.
- Email: `.catch(() => {})` sostituiti con `.catch(err => log error + persist in EmailFailureLog)`. Retry automatico escluso dal scope di M1 (sarà M7 con BullMQ).

**Tech stack:** Express 4.18, Prisma 5, Stripe 14, Nodemailer 8 + `@sentry/node ^8` (nuova dep, opt-in).

---

## File structure (M1)

| File | Azione | Responsabilità |
|---|---|---|
| `shop/src/utils/asyncHandler.js` | **create** | Wrapper che converte handler async in middleware Express compatibile |
| `shop/src/utils/observability.js` | **create** | Init/report Sentry opt-in; default no-op |
| `shop/src/utils/emailLogger.js` | **create** | Logger strutturato per failure email + scrittura in `EmailFailureLog` |
| `shop/prisma/schema.prisma` | modify | Nuovo model `EmailFailureLog` + migration |
| `shop/package.json` | modify | `@sentry/node` in deps |
| `shop/server.js` | modify | Refactor graceful shutdown + Sentry init |
| `shop/src/app.js` | modify | Sentry error handler (se DSN set) + niente altro |
| `shop/src/utils/email.js` | modify | Propagare errori ai chiamanti (throw) + log strutturato interno |
| `shop/src/routes/auth.js` | modify | Wrap handler async con `asyncHandler` |
| `shop/src/routes/shop.js` | modify | idem |
| `shop/src/routes/account.js` | modify | idem |
| `shop/src/routes/admin.js` | modify | idem |
| `shop/src/routes/sitemap.js` | modify | idem (è già async) |
| `shop/src/controllers/orderController.js` | modify | `_finalizeOrder` in `$transaction`; idempotency su `postCheckout`; webhook retry convention; email failure logging |
| `shop/src/controllers/authController.js` | modify | Email failure logging |
| `shop/src/controllers/adminController.js` | modify | Email failure logging |

**Pre-flight (orchestrator):** branch `feat/M1-stability-concurrency` da `master`.

**Testing:** come M0, nessun framework di test. Verifiche via `node -c` (syntax), curl/script runtime (race condition, shutdown), grep su pattern `.catch(() => {})` per conferma sostituzione.

---

## Wave 1 — Foundation (1 subagent sequenziale)

### Task F-1: `src/utils/asyncHandler.js`

**Files:** Create `shop/src/utils/asyncHandler.js`

- [ ] **Step 1:** creare il file con contenuto:

```js
// src/utils/asyncHandler.js
// Wrappa un handler async per Express 4: promise rejection diventa next(err)
// passato all'error handler centrale in app.js, invece di hang della request.

module.exports = function asyncHandler(fn) {
  return function wrapped(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};
```

- [ ] **Step 2 — Verifica:**
```bash
node -e "const h = require('./shop/src/utils/asyncHandler'); const wrapped = h(async () => { throw new Error('x') }); wrapped({}, {}, (err) => console.log('captured:', err.message))"
# Expected: "captured: x"
```

- [ ] **Step 3 — Commit:**
```bash
git add shop/src/utils/asyncHandler.js
git commit -m "chore(utils): asyncHandler wrapper for route handlers"
```

**Ref:** M1-T1, CQ-002.

---

### Task F-2: `src/utils/observability.js` (Sentry opt-in)

**Files:** Create `shop/src/utils/observability.js`

- [ ] **Step 1:** creare il file:

```js
// src/utils/observability.js
// Wrapper Sentry opt-in. Se SENTRY_DSN non è settata, tutte le funzioni sono no-op.
// Così dev/CI non richiedono DSN.

let Sentry = null;
let enabled = false;

function init() {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  try {
    Sentry = require('@sentry/node');
    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV || 'development',
      release: process.env.APP_VERSION || undefined,
      tracesSampleRate: 0, // no APM per ora
    });
    enabled = true;
    console.log('📡 Sentry inizializzato');
  } catch (err) {
    console.warn('⚠ Sentry non disponibile (@sentry/node non installato?):', err.message);
  }
}

function captureException(err, context = {}) {
  if (!enabled) return;
  Sentry.captureException(err, { extra: context });
}

function errorHandler() {
  // Middleware Express 4 compatibile. No-op se Sentry non attivo.
  if (!enabled) return (err, req, res, next) => next(err);
  return Sentry.Handlers.errorHandler();
}

function requestHandler() {
  if (!enabled) return (req, res, next) => next();
  return Sentry.Handlers.requestHandler();
}

module.exports = { init, captureException, errorHandler, requestHandler };
```

- [ ] **Step 2 — Verifica (senza DSN):**
```bash
node -e "const o = require('./shop/src/utils/observability'); o.init(); o.captureException(new Error('x')); console.log('no-op ok')"
# Expected: "no-op ok" (nessun error anche senza @sentry/node installato)
```

- [ ] **Step 3 — Commit:**
```bash
git add shop/src/utils/observability.js
git commit -m "chore(utils): observability wrapper with opt-in Sentry"
```

**Ref:** M1-T8, PROD-014.

---

### Task F-3: install `@sentry/node`

**Files:** Modify `shop/package.json` + `shop/package-lock.json` (auto)

- [ ] **Step 1:**
```bash
cd shop && npm install @sentry/node@^8 --save
```

- [ ] **Step 2 — Verifica:**
```bash
node -e "const S = require('@sentry/node'); console.log('sentry version:', S.SDK_VERSION || 'unknown')"
# Expected: una stringa versione
grep '"@sentry/node"' shop/package.json
# Expected: una riga con la versione ^8.x
```

- [ ] **Step 3 — Commit:**
```bash
git add shop/package.json shop/package-lock.json
git commit -m "chore(deps): add @sentry/node ^8 (opt-in via SENTRY_DSN)"
```

**Ref:** M1-T8.

---

### Task F-4: refactor `server.js` con graceful shutdown + Sentry init

**Files:** Modify `shop/server.js`

- [ ] **Step 1:** sostituire **integralmente** il contenuto di `shop/server.js` con:

```js
require('./src/config/env'); // PRIMA riga: valida env e fail-fast

const observability = require('./src/utils/observability');
observability.init(); // Sentry (opt-in). DEVE stare prima di require('./src/app').

const app = require('./src/app');
const prisma = require('./src/config/database');

const PORT = process.env.PORT || 3000;
const SHUTDOWN_TIMEOUT_MS = 30_000;

let server = null;
let shuttingDown = false;

async function start() {
  try {
    await prisma.$connect();
    console.log('✅ Database connesso');

    server = app.listen(PORT, () => {
      console.log(`🚀 MF Depur Shop in esecuzione su http://localhost:${PORT}`);
      console.log(`   Admin panel: http://localhost:${PORT}/admin`);
      console.log(`   Ambiente: ${process.env.NODE_ENV || 'development'}`);
    });

    server.on('error', (err) => {
      console.error('❌ Errore server HTTP:', err);
      observability.captureException(err, { where: 'server.listen' });
      process.exit(1);
    });
  } catch (err) {
    console.error('❌ Errore avvio server:', err);
    observability.captureException(err, { where: 'start' });
    process.exit(1);
  }
}

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n⏸  Shutdown richiesto (${signal}), chiudo connessioni…`);

  // Timeout: se 30s non bastano, force exit (connessioni hung).
  const forceTimer = setTimeout(() => {
    console.error('⛔ Shutdown timeout, force exit.');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceTimer.unref();

  try {
    if (server) await new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
    await prisma.$disconnect();
    console.log('✅ Shutdown completato.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Errore durante shutdown:', err);
    observability.captureException(err, { where: 'shutdown' });
    process.exit(1);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

// Fatal: lo stato applicativo è potenzialmente corrotto dopo un'eccezione non
// catturata o una rejection non gestita. Log + shutdown, non "proseguiamo".
process.on('unhandledRejection', (reason) => {
  console.error('❗ Unhandled Rejection:', reason);
  observability.captureException(reason instanceof Error ? reason : new Error(String(reason)),
    { where: 'unhandledRejection' });
  shutdown('UNHANDLED_REJECTION');
});

process.on('uncaughtException', (err) => {
  console.error('❗ Uncaught Exception:', err);
  observability.captureException(err, { where: 'uncaughtException' });
  shutdown('UNCAUGHT_EXCEPTION');
});

start();
```

- [ ] **Step 2:** modificare `shop/src/app.js` — aggiungere all'inizio, **dopo** la `const app = express();`:

```js
const observability = require('./utils/observability');
app.use(observability.requestHandler()); // no-op se Sentry disabilitato
```

E **prima** dell'error handler generico (riga ~131 `app.use((err, req, res, next) => {`), aggiungere:
```js
app.use(observability.errorHandler()); // cattura errori prima del render custom
```

- [ ] **Step 3 — Verifica (dev env):**
```bash
cd shop && npm run dev
# Expected: app parte, "Database connesso", "MF Depur Shop in esecuzione"
# In un altro terminal:
# kill -TERM $(pgrep -f "node server.js" | head -1)
# Expected nel log: "Shutdown richiesto (SIGTERM)..." seguito da "Shutdown completato."
# Processo termina con exit 0.
```

Se non è fattibile testare SIGTERM interattivamente nella sessione (es. dev non disponibile), verificare almeno il parse:
```bash
node -c shop/server.js && node -c shop/src/app.js
# Expected: nessun errore
```

- [ ] **Step 4 — Commit:**
```bash
git add shop/server.js shop/src/app.js
git commit -m "feat(runtime): graceful shutdown + Sentry init + fatal-on-unhandled"
```

**Ref:** M1-T2, M1-T3, M1-T8, CQ-003, PROD-003, PROD-019.

---

## Wave 2 — Parallel batches (3 subagent)

### Batch α — orderController internals (1 subagent)

Tutte le modifiche a `shop/src/controllers/orderController.js`. **Non toccare altri file.**

#### Task α-1: `$transaction` atomica in `_finalizeOrder`

**Files:** Modify `shop/src/controllers/orderController.js`

- [ ] **Step 1:** leggere l'intero `orderController.js`. Trovare la funzione `_finalizeOrder` (o il blocco equivalente che: aggiorna status ordine → decrementa stock → crea OrderItems). Pattern esistente (probabilmente):

```js
async function _finalizeOrder(orderId) {
  await prisma.order.update({ where: { id: orderId }, data: { status: 'CONFIRMED', paidAt: new Date() } });
  const items = await prisma.orderItem.findMany({ where: { orderId } });
  for (const it of items) {
    await prisma.product.update({ where: { id: it.productId }, data: { stock: { decrement: it.quantity } } });
  }
  // ... email, ecc.
}
```

- [ ] **Step 2:** sostituire con versione transazionale + ricalcolo server-side + failure-safe:

```js
// Finalizza un ordine in CONFIRMED atomicamente: decrementa stock e blocca
// se uno stock è insufficiente. Tutto in singola transazione Prisma.
// Se fallisce, l'ordine rimane nello stato precedente (caller decide cosa fare).
async function _finalizeOrder(orderId, { paidAt = new Date(), paymentIntentId = null } = {}) {
  return await prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: { items: true },
    });
    if (!order) throw new Error(`Order ${orderId} not found`);
    if (order.status === 'CONFIRMED') {
      return order; // idempotent: webhook duplicato, già confermato
    }
    if (order.status !== 'PENDING' && order.status !== 'PAYMENT_FAILED') {
      throw new Error(`Cannot finalize order in status ${order.status}`);
    }

    // Verifica + decremento stock atomico. Prisma lancia se stock < quantity? No,
    // Prisma decrement va sotto zero. Verifichiamo noi prima.
    for (const it of order.items) {
      const prod = await tx.product.findUnique({
        where: { id: it.productId },
        select: { id: true, stock: true, name: true },
      });
      if (!prod) throw new Error(`Product ${it.productId} not found`);
      if (prod.stock < it.quantity) {
        const e = new Error(`Stock insufficiente per ${prod.name}: richiesti ${it.quantity}, disponibili ${prod.stock}`);
        e.code = 'INSUFFICIENT_STOCK';
        throw e;
      }
    }

    // Decrement stock
    for (const it of order.items) {
      await tx.product.update({
        where: { id: it.productId },
        data: { stock: { decrement: it.quantity } },
      });
    }

    // Update order
    const updated = await tx.order.update({
      where: { id: orderId },
      data: {
        status: 'CONFIRMED',
        paidAt,
        ...(paymentIntentId ? { paymentIntentId } : {}),
      },
      include: { items: true, company: true, user: true, address: true },
    });

    return updated;
  });
}
```

Aggiornare i chiamanti (`stripeWebhook`, `postCheckout` per bonifico) per usare la nuova firma:
```js
const updated = await _finalizeOrder(orderId, { paymentIntentId: event.data.object.id });
```

- [ ] **Step 3 — Verifica sintassi:**
```bash
node -c shop/src/controllers/orderController.js
```

- [ ] **Step 4 — Commit:**
```bash
git add shop/src/controllers/orderController.js
git commit -m "security(order): atomic stock + status update in \$transaction"
```

**Ref:** M1-T4, SHOP-004, CQ-001, SEC-007, SHOP-010.

---

#### Task α-2: Idempotency su `POST /shop/checkout`

**Files:** Modify `shop/src/controllers/orderController.js`

- [ ] **Step 1:** in testa al file, aggiungere una cache in-memory con TTL:

```js
// In-memory idempotency cache: key → { orderId, expiresAt }
// TTL: 5 minuti. Per scala prod con multi-istanza servirà Redis (scope M7).
const IDEMPOTENCY_TTL_MS = 5 * 60 * 1000;
const idempotencyCache = new Map();

function idempotencyGet(key) {
  const entry = idempotencyCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    idempotencyCache.delete(key);
    return null;
  }
  return entry;
}

function idempotencySet(key, orderId) {
  idempotencyCache.set(key, { orderId, expiresAt: Date.now() + IDEMPOTENCY_TTL_MS });
}

// Housekeeping: rimuovi entry scadute ogni 10 minuti
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of idempotencyCache.entries()) {
    if (v.expiresAt < now) idempotencyCache.delete(k);
  }
}, 10 * 60 * 1000).unref();
```

- [ ] **Step 2:** all'inizio di `postCheckout`, **prima** di qualsiasi operazione DB:

```js
const idempotencyKey = req.body.idempotencyKey || req.get('idempotency-key');
if (idempotencyKey) {
  const hit = idempotencyGet(idempotencyKey);
  if (hit) {
    // Duplicato: rispondi con lo stesso risultato senza creare un nuovo ordine.
    return res.redirect(`/account/orders/${hit.orderId}?idempotent=1`);
  }
}
```

E, **dopo** la creazione dell'ordine avvenuta con successo (variabile `order`):
```js
if (idempotencyKey) idempotencySet(idempotencyKey, order.id);
```

- [ ] **Step 3:** modificare `shop/views/shop/checkout.ejs` (NOTA: questo è l'unico caso in Batch α che tocca un file fuori da `orderController.js`; accettabile perché il campo hidden `idempotencyKey` fa parte della feature):

Trovare il `<form>` del checkout e aggiungere, come primo campo hidden dopo il `csrf`:
```html
<input type="hidden" name="idempotencyKey" value="<%= typeof idempotencyKey !== 'undefined' ? idempotencyKey : '' %>">
```

E in `getCheckout` (stesso controller), passare la chiave alla view:
```js
const idempotencyKey = require('crypto').randomUUID();
res.render('shop/checkout', { /* ... altri locals ... */, idempotencyKey });
```

- [ ] **Step 4 — Verifica:**
```bash
node -c shop/src/controllers/orderController.js
```

- [ ] **Step 5 — Commit:**
```bash
git add shop/src/controllers/orderController.js shop/views/shop/checkout.ejs
git commit -m "security(checkout): idempotency key (5min TTL) to block double-submit"
```

**Ref:** M1-T5, SHOP-005.

---

#### Task α-3: Stripe webhook retry convention

**Files:** Modify `shop/src/controllers/orderController.js`

- [ ] **Step 1:** trovare la funzione `stripeWebhook`. All'interno dello switch `event.type`, per il branch `payment_intent.succeeded` (o simile), avvolgere il `_finalizeOrder` in try/catch che:

```js
// Pattern: se _finalizeOrder fallisce per errore transiente (DB giù), torna 500
// così Stripe riprova il webhook. Se fallisce per business logic (es. INSUFFICIENT_STOCK),
// segna PAYMENT_FAILED e torna 200 (no retry utile).
try {
  await _finalizeOrder(orderId, { paymentIntentId: event.data.object.id });
} catch (err) {
  console.error('[stripe-webhook] _finalizeOrder fallito:', err.message);
  if (err.code === 'INSUFFICIENT_STOCK') {
    // Business: marchia l'ordine come payment_failed (Stripe ha già incassato — servirà refund manuale)
    await prisma.order.update({
      where: { id: orderId },
      data: { status: 'PAYMENT_FAILED', adminNotes: `Finalize fallito: ${err.message}` },
    }).catch(() => {});
    return res.status(200).json({ received: true, warning: err.message });
  }
  // Errore transiente: 500 → Stripe ritenta.
  return res.status(500).json({ error: 'transient failure, please retry' });
}
```

- [ ] **Step 2 — Verifica sintassi:**
```bash
node -c shop/src/controllers/orderController.js
```

- [ ] **Step 3 — Commit:**
```bash
git add shop/src/controllers/orderController.js
git commit -m "feat(stripe-webhook): retry-aware error handling (500 transient, 200 business)"
```

**Ref:** M1-T10, SHOP-019.

---

### Batch β — Routes asyncHandler wrap (1 subagent)

Scope: applicare `asyncHandler` a tutti gli handler async dichiarati **a livello di route** (sia `ctrl.func` che inline `async (req, res) => {}`).

#### Task β-1: wrap `routes/auth.js`

**Files:** Modify `shop/src/routes/auth.js`

- [ ] **Step 1:** leggere integralmente il file.

- [ ] **Step 2:** in cima, aggiungere:
```js
const asyncHandler = require('../utils/asyncHandler');
```

- [ ] **Step 3:** per ogni `router.<method>('/path', ..., handler)` dove il handler è async (o è un `ctrl.funzione` che è async):
  - Se handler inline: `router.post('/x', async (req, res) => {...})` → `router.post('/x', asyncHandler(async (req, res) => {...}))`
  - Se handler da controller: `router.post('/x', ctrl.login)` → `router.post('/x', asyncHandler(ctrl.login))`
  - Se ci sono più middleware: `router.post('/x', mw1, mw2, ctrl.login)` → `router.post('/x', mw1, mw2, asyncHandler(ctrl.login))`
  - **NON wrappare middleware sincroni** come `requireAuth`, validator chains di `express-validator`, rate limiter.

- [ ] **Step 4 — Verifica:**
```bash
node -c shop/src/routes/auth.js
grep -c "asyncHandler(" shop/src/routes/auth.js
# Expected: un numero >= 1 corrispondente al numero di handler async
```

- [ ] **Step 5 — Commit:**
```bash
git add shop/src/routes/auth.js
git commit -m "refactor(routes/auth): wrap async handlers with asyncHandler"
```

---

#### Task β-2: wrap `routes/shop.js`

Stesso pattern di β-1 applicato a `shop/src/routes/shop.js`. Handler dal file:
```js
router.get('/', productCtrl.getCatalog);
router.get('/product/:slug', productCtrl.getProduct);
router.get('/cart', cartCtrl.getCart);
router.get('/cart/count', requireAuth, cartCtrl.getCartCount);
router.post('/cart/add', requireAuth, requireApprovedCompany, cartCtrl.addItem);
// ... etc
```

Tutti i `ctrl.func` sono async → wrap tutti con `asyncHandler`.

- [ ] **Step 1:** aggiungere `const asyncHandler = require('../utils/asyncHandler');`

- [ ] **Step 2:** wrappare ogni handler:
```js
router.get('/', asyncHandler(productCtrl.getCatalog));
router.get('/product/:slug', asyncHandler(productCtrl.getProduct));
router.get('/cart', asyncHandler(cartCtrl.getCart));
router.get('/cart/count', requireAuth, asyncHandler(cartCtrl.getCartCount));
router.post('/cart/add', requireAuth, requireApprovedCompany, asyncHandler(cartCtrl.addItem));
router.post('/cart/update', requireAuth, requireApprovedCompany, asyncHandler(cartCtrl.updateItem));
router.post('/cart/item/:id', requireAuth, requireApprovedCompany, asyncHandler(cartCtrl.updateItem));
router.post('/cart/remove', requireAuth, requireApprovedCompany, asyncHandler(cartCtrl.removeItem));
router.post('/cart/item/:id/remove', requireAuth, requireApprovedCompany, asyncHandler(cartCtrl.removeItem));
router.post('/cart/clear', requireAuth, requireApprovedCompany, asyncHandler(cartCtrl.clearCart));
router.get('/checkout', requireAuth, requireApprovedCompany, asyncHandler(orderCtrl.getCheckout));
router.post('/checkout', requireAuth, requireApprovedCompany, asyncHandler(orderCtrl.postCheckout));
router.get('/checkout/success', requireAuth, requireApprovedCompany, asyncHandler(orderCtrl.checkoutSuccess));
router.get('/checkout/cancel', requireAuth, requireApprovedCompany, asyncHandler(orderCtrl.checkoutCancel));
```

- [ ] **Step 3 — Verifica + Commit:**
```bash
node -c shop/src/routes/shop.js
git add shop/src/routes/shop.js
git commit -m "refactor(routes/shop): wrap async handlers with asyncHandler"
```

---

#### Task β-3: wrap `routes/account.js`

Stesso pattern. Il file ha **sia** `ctrl.func` sia **inline** async handler (es. `router.post('/profile', [...validation...], async (req, res) => { ... })`).

- [ ] **Step 1:** aggiungere `const asyncHandler = require('../utils/asyncHandler');`

- [ ] **Step 2:** wrappare ogni handler async:
  - Per `router.get('/orders', requireApprovedCompany, orderCtrl.getMyOrders)` → `asyncHandler(orderCtrl.getMyOrders)`
  - Per handler inline con validation array: `router.post('/profile', [body(...),...], async (req, res) => {...})` → `router.post('/profile', [body(...),...], asyncHandler(async (req, res) => {...}))`
  - Stesso per `/addresses`, `/addresses/:id/delete`, `/export`, `/delete`, ecc.
  - I GET synchronous (es. `router.get('/', (req, res) => res.render(...))`) **non wrap**.

- [ ] **Step 3 — Verifica:**
```bash
node -c shop/src/routes/account.js
# Verifica che tutti i blocchi async sono wrappati:
grep -c "async (req, res)" shop/src/routes/account.js
grep -c "asyncHandler(" shop/src/routes/account.js
# I due numeri devono combaciare (o asyncHandler >= async)
```

- [ ] **Step 4 — Commit:**
```bash
git add shop/src/routes/account.js
git commit -m "refactor(routes/account): wrap async handlers with asyncHandler"
```

---

#### Task β-4: wrap `routes/admin.js`

Stesso pattern. Tutti gli handler admin sono async (CRUD products/categories/orders/companies).

- [ ] **Step 1:** leggere + aggiungere import + wrap tutti.

- [ ] **Step 2 — Verifica + Commit:**
```bash
node -c shop/src/routes/admin.js
git add shop/src/routes/admin.js
git commit -m "refactor(routes/admin): wrap async handlers with asyncHandler"
```

---

#### Task β-5: wrap `routes/sitemap.js`

Se contiene un handler async, applicare asyncHandler. Altrimenti commit `--allow-empty` con messaggio `chore: confirm routes/sitemap sync (no wrap needed)`.

- [ ] **Step 1:** leggere + decidere.
- [ ] **Step 2:** applicare wrap se async. Altrimenti skip (no commit).
- [ ] **Step 3:** commit se modificato.

---

### Batch γ — Email resilience (1 subagent)

Scope: rimuovere `.catch(() => {})` silenti + log strutturato + persistenza failure in DB (tabella `EmailFailureLog`).

#### Task γ-1: Prisma model `EmailFailureLog`

**Files:** Modify `shop/prisma/schema.prisma` + generate migration

- [ ] **Step 1:** aggiungere alla fine di `shop/prisma/schema.prisma`:

```prisma
// ─── EMAIL FAILURE LOG ────────────────────────────────────────────────────────
// Registra i tentativi di invio email falliti. M7 introdurrà retry automatico
// via BullMQ. Per ora il log serve solo per visibilità + manual resend.

model EmailFailureLog {
  id           String   @id @default(cuid())
  toAddress    String
  subject      String
  templateName String?  // es. "sendPasswordReset", "sendOrderConfirmation"
  errorMessage String
  errorCode    String?  // SMTP code se disponibile
  context      String?  // JSON con orderId/userId/etc per debug
  createdAt    DateTime @default(now())

  @@index([createdAt])
  @@index([toAddress])
}
```

- [ ] **Step 2:** generare la migration:
```bash
cd shop && npx prisma migrate dev --name email_failure_log
# Expected: crea nuova dir shop/prisma/migrations/YYYY..._email_failure_log/
```

Se `prisma migrate dev` fallisce perché **non esiste** ancora `prisma/migrations/` (M3-T2 non è stata fatta), usare invece:
```bash
cd shop && npx prisma db push
# Applica lo schema senza history — accettabile per dev. Aggiungere commento nel commit.
```

- [ ] **Step 3 — Verifica:**
```bash
node -e "const p = require('./shop/src/config/database'); p.emailFailureLog.count().then(c => console.log('count:', c)).catch(e => console.error('ERR:', e.message))"
# Expected: "count: 0" (o errore chiaro se schema non applicato)
```

- [ ] **Step 4 — Commit:**
```bash
git add shop/prisma/schema.prisma shop/prisma/migrations/ 2>/dev/null || git add shop/prisma/schema.prisma
git commit -m "db(email): add EmailFailureLog model for tracking send failures"
```

**Ref:** M1-T7.

---

#### Task γ-2: `src/utils/emailLogger.js`

**Files:** Create `shop/src/utils/emailLogger.js`

- [ ] **Step 1:** creare il file:

```js
// src/utils/emailLogger.js
// Logga le failure di invio email: console + AuditLog-like tabella DB.

const prisma = require('../config/database');
const observability = require('./observability');

async function logEmailFailure({ to, subject, templateName, err, context = {} }) {
  const errorMessage = err?.message || String(err);
  const errorCode    = err?.code ? String(err.code) : null;
  console.error(`[email-failure] to=${to} template=${templateName || 'unknown'} err=${errorMessage}`);
  observability.captureException(err instanceof Error ? err : new Error(errorMessage),
    { kind: 'email-send-failure', to, subject, templateName, ...context });
  try {
    await prisma.emailFailureLog.create({
      data: {
        toAddress: to,
        subject: subject?.slice(0, 200) || 'unknown',
        templateName: templateName?.slice(0, 80) || null,
        errorMessage: errorMessage.slice(0, 1000),
        errorCode,
        context: Object.keys(context).length ? JSON.stringify(context).slice(0, 2000) : null,
      },
    });
  } catch (logErr) {
    // Ultimo fallback: se anche il DB è giù, almeno console ha loggato.
    console.error('[email-failure] impossibile persistere log:', logErr.message);
  }
}

module.exports = { logEmailFailure };
```

- [ ] **Step 2 — Verifica:**
```bash
node -c shop/src/utils/emailLogger.js
```

- [ ] **Step 3 — Commit:**
```bash
git add shop/src/utils/emailLogger.js
git commit -m "chore(utils): emailLogger — structured + persistent failure logging"
```

---

#### Task γ-3: sostituire `.catch(() => {})` silenti nei chiamanti

**Files:** Modify `shop/src/controllers/orderController.js`, `shop/src/controllers/authController.js`, `shop/src/controllers/adminController.js`

**Occorrenze da sostituire (da recon M1):**
- `adminController.js:348` — `emailUtil.sendCompanyApproved(user).catch(() => {})`
- `authController.js:150` — `prisma.session.deleteMany({...}).catch(() => {})` → **mantenere silenzioso** (è solo cleanup session, non email — vedi nota sotto)
- `authController.js:198` — `email.sendPasswordReset(user, resetUrl).catch(() => {})`
- `orderController.js:247` — `emailUtil.sendOrderConfirmation(order, user).catch(() => {})`
- `orderController.js:250` — `emailUtil.sendNewOrderNotificationAdmin(order, order.company).catch(() => {})`

- [ ] **Step 1:** in ogni controller che invia email, aggiungere:
```js
const { logEmailFailure } = require('../utils/emailLogger');
```

- [ ] **Step 2 — adminController.js:348** — sostituire:
```js
await emailUtil.sendCompanyApproved(user).catch(() => {});
```
con:
```js
await emailUtil.sendCompanyApproved(user).catch((err) => logEmailFailure({
  to: user.email,
  subject: 'Account approvato',
  templateName: 'sendCompanyApproved',
  err,
  context: { userId: user.id, companyId: user.companyId },
}));
```

- [ ] **Step 3 — authController.js:198** — sostituire:
```js
await email.sendPasswordReset(user, resetUrl).catch(() => {});
```
con:
```js
await email.sendPasswordReset(user, resetUrl).catch((err) => logEmailFailure({
  to: user.email,
  subject: 'Reset password',
  templateName: 'sendPasswordReset',
  err,
  context: { userId: user.id },
}));
```

- [ ] **Step 4 — authController.js:150 — NON toccare.** `prisma.session.deleteMany(...).catch(() => {})` è cleanup idempotente, silenzio è accettabile. Aggiungere solo un commento:
```js
await prisma.session.deleteMany({ where: { refreshToken } }).catch(() => {}); // idempotent cleanup, silenzioso OK
```

- [ ] **Step 5 — orderController.js:247** — sostituire:
```js
await emailUtil.sendOrderConfirmation(order, user).catch(() => {});
```
con:
```js
await emailUtil.sendOrderConfirmation(order, user).catch((err) => logEmailFailure({
  to: user.email,
  subject: `Ordine ${order.orderNumber}`,
  templateName: 'sendOrderConfirmation',
  err,
  context: { orderId: order.id, userId: user.id },
}));
```

- [ ] **Step 6 — orderController.js:250** — sostituire:
```js
await emailUtil.sendNewOrderNotificationAdmin(order, order.company).catch(() => {});
```
con:
```js
await emailUtil.sendNewOrderNotificationAdmin(order, order.company).catch((err) => logEmailFailure({
  to: process.env.ADMIN_EMAIL || 'admin',
  subject: `Nuovo ordine ${order.orderNumber}`,
  templateName: 'sendNewOrderNotificationAdmin',
  err,
  context: { orderId: order.id, companyId: order.company?.id },
}));
```

- [ ] **Step 7 — Verifica:**
```bash
for f in shop/src/controllers/adminController.js shop/src/controllers/authController.js shop/src/controllers/orderController.js; do node -c "$f" && echo "OK $f" || echo "FAIL $f"; done
# Expected: OK OK OK

grep -rEn "\.catch\(\s*\(\s*\)\s*=>\s*\{\s*\}\s*\)" shop/src/controllers/ | grep -v "idempotent cleanup"
# Expected: output vuoto (tutte le occorrenze silenziose sono state sostituite tranne quella commentata)
```

- [ ] **Step 8 — Commit:**
```bash
git add shop/src/controllers/adminController.js shop/src/controllers/authController.js shop/src/controllers/orderController.js
git commit -m "security(email): log failures via EmailFailureLog (no more silent catch)"
```

**Ref:** M1-T7, CQ-005.

---

## Wrap-up (orchestrator, NON delegato)

- [ ] **Step 1 — Smoke test:** `cd shop && npm run dev`. Verificare avvio pulito. Se `SENTRY_DSN` non impostata, il log deve dire "MF Depur Shop in esecuzione" senza crash. Nessun messaggio Sentry.

- [ ] **Step 2 — Test shutdown manuale:** in un altro shell:
```bash
ps aux | grep "node server.js" | grep -v grep
# Copia il PID
kill -TERM <PID>
# Nel log server: "Shutdown richiesto (SIGTERM)..." → "Shutdown completato." → exit 0
```

- [ ] **Step 3 — Test race stock (opzionale, se si ha setup con 2+ product):**
```bash
# Con 2 checkout concorrenti sull'ultimo pezzo (via curl o script), uno deve completare e l'altro ricevere INSUFFICIENT_STOCK
```

- [ ] **Step 4 — Conteggio commit:**
```bash
git log --oneline master..HEAD
# Expected: ~12-15 commit M1
```

- [ ] **Step 5 — Merge in master (se smoke test OK):**
```bash
git checkout master
git merge --no-ff feat/M1-stability-concurrency -m "Merge branch 'feat/M1-stability-concurrency' — M1 audit 2026-04-23"
```

- [ ] **Step 6 — Aggiornare memoria + activeContext:**
  - Marcare M1 come completata in `docs/audit/2026-04-23/01-activeContext.md`
  - Aggiornare `~/.claude/projects/.../memory/audit_roadmap_2026-04-23.md` con `[x] M1 done`
  - Commit: `docs(audit): M1 merged — aggiorna activeContext`

---

## Riepilogo coverage

| Task plan | Ref audit | Finding principali | Task già chiusi in M0 |
|---|---|---|---|
| F-1 | M1-T1 | CQ-002 | — |
| F-2 | M1-T8 (parziale — solo wrapper) | PROD-014 | — |
| F-3 | M1-T8 | PROD-014 | — |
| F-4 | M1-T2, M1-T3, M1-T8 | CQ-003, PROD-003, PROD-019 | — |
| α-1 | M1-T4 | SHOP-004, CQ-001, SEC-007, SHOP-010 | — |
| α-2 | M1-T5 | SHOP-005 | — |
| α-3 | M1-T10 | SHOP-019 | — |
| β-1..5 | M1-T1 (wrap routes) | CQ-002 | — |
| γ-1/2/3 | M1-T7 | CQ-005 | — |
| — | M1-T6 | CQ-011 | ✅ chiuso in M0-B-3 (POST /addresses atomic $transaction) |
| — | M1-T9 | SEC-019 | ✅ chiuso in M0-G0-1 (env validator fail-fast) |

**Copertura totale:** 10/10 task M1 (8 implementati + 2 già chiusi in M0).

## Decomposizione esecutiva (subagent-driven)

| Wave | Chi | Cosa | Durata stimata |
|---|---|---|---|
| 0 | orchestrator | branch `feat/M1-stability-concurrency` | instant |
| 1 | 1 subagent (sequenziale) | F-1 asyncHandler, F-2 observability, F-3 npm install sentry, F-4 server.js refactor + app.js | ~10-15 min |
| 2 | **3 subagent paralleli** | Batch α (orderController internals), β (routes wrap), γ (email resilience) | ~15-20 min wall-clock |
| 3 | orchestrator | smoke test + merge | ~5 min |

Totale: ~30-40 min wall-clock.

## Note importanti

- **Batch β deve partire DOPO Wave 1** (usa `asyncHandler` creato in F-1).
- **Batch γ deve partire DOPO Wave 1** (usa `observability` in `emailLogger.js`).
- **Batch α è indipendente da F-1** ma comunque lo aspetta per coerenza (inoltre α-2 richiede `randomUUID` che è nativo node, non serve nulla di F-1).
- Se `prisma migrate dev` richiede conferme interattive o il DB è in stato inaspettato, il subagent γ-1 deve **fermarsi** e segnalare, non forzare.
- `@sentry/node ^8` richiede Node 18+ (già garantito da M0-A-1).
