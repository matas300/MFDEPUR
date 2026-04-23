# M0 — Quick Wins & Safety Net (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (raccomandato) o `superpowers:executing-plans`. Steps usano checkbox (`- [ ]`) per tracking. Implementare un task per volta; commit dopo ogni task.

**Goal:** Eliminare i rischi di sicurezza/operativi a basso sforzo individuati nell'audit del 2026-04-23 (20 task, ~1-2 giorni uomo).

**Architecture:** Interventi mirati su `shop/src/` senza introdurre nuove dipendenze o refactor strutturali. Nuovi file: `src/config/env.js` (fail-fast env), `src/config/constants.js` (TAX_RATE, enum stati). Modifiche localizzate a controller/route/middleware per validation, rate-limit, clamp numerici, ownership check.

**Tech stack:** Express 4.18, Prisma 5, express-validator 7, express-rate-limit 7 (già installati — zero nuove dipendenze richieste).

**Pre-flight (orchestrator, NON delegato):** Creare branch `feat/M0-quick-wins` da `master`. Tutti i commit su questo branch. Niente merge fino a fine M0.

**Note su testing:** il progetto non ha un test framework (M4 lo introdurrà). In M0 ogni task si verifica con **grep/curl/runtime check** descritti in "Verifica" di ciascun task. Non bloccante.

**Convenzioni commit:** `<tipo>(<scope>): <msg>` — es. `fix(account): validate POST /profile input` · `chore(seed): fail-fast without ADMIN_PASSWORD` · `security(rate-limit): add limiter to checkout`.

---

## File structure (creati / modificati)

| File | Azione | Responsabilità |
|---|---|---|
| `shop/src/config/env.js` | **create** | Validazione fail-fast env vars critiche all'avvio |
| `shop/src/config/constants.js` | **create** | Costanti condivise: `TAX_RATE`, `ORDER_STATUSES`, `COMPANY_STATUSES`, transizioni stato ordini |
| `shop/server.js` | modify | `require('./src/config/env')` come prima riga |
| `shop/prisma/seed.js` | modify | Guard prod + fail-fast su `ADMIN_PASSWORD` |
| `shop/package.json` | modify | `engines.node` |
| `.nvmrc` | **create** (root) | Versione Node pinata |
| `shop/.env.example` | modify | Documentare tutte le env vars |
| `shop/prisma/schema.prisma` | modify | `@unique` su `Order.orderNumber` + migration |
| `shop/src/app.js` | modify | Rate limit su `/shop/checkout`, `/shop/cart/*` |
| `shop/src/routes/account.js` | modify | Rate limit `/account/delete`, validation `POST /profile` e `POST /addresses` |
| `shop/src/controllers/orderController.js` | modify | Verifica ownership `addressId`, log `AuditLog` su Stripe webhook invalid-sig |
| `shop/src/controllers/productController.js` | modify | Rimozione import `path`, clamp numerici, verifica existence `categoryId`, max-length notes |
| `shop/src/controllers/adminController.js` | modify | Validation enum `Company.status` / `Order.status`, state machine ordini, max-length free-text |

---

## Batch 0 — Foundation (sequenziale, orchestrator o 1 subagent solo)

Crea le fondamenta riutilizzate dagli altri batch. **Deve finire prima di dispatch dei batch A-E.**

### Task G0-1: `src/config/env.js` (fail-fast env validation)

**Files:**
- Create: `shop/src/config/env.js`
- Modify: `shop/server.js` (riga 1)

- [ ] **Step 1:** creare `shop/src/config/env.js`:

```js
// src/config/env.js
// Valida all'avvio le env var critiche. Fail-fast (throw) se mancano o troppo corte.
// Importato come prima riga in server.js.

require('dotenv').config();

const REQUIRED = [
  // Auth / CSRF — almeno 32 char per entropy adeguata
  { name: 'JWT_SECRET',          minLength: 32 },
  { name: 'JWT_REFRESH_SECRET',  minLength: 32 },
  { name: 'CSRF_SECRET',         minLength: 32 },
  // Auth expiry — default string zod-like
  { name: 'JWT_EXPIRES_IN' },
  { name: 'JWT_REFRESH_EXPIRES_IN' },
  // Stripe — fail-fast sempre (no fallback silent)
  { name: 'STRIPE_SECRET_KEY' },
  { name: 'STRIPE_PUBLISHABLE_KEY' },
  { name: 'STRIPE_WEBHOOK_SECRET' },
  // DB
  { name: 'DATABASE_URL' },
];

const RECOMMENDED = [
  // Email — se mancano, le email non partono (warning, non fatal)
  'EMAIL_HOST', 'EMAIL_PORT', 'EMAIL_USER', 'EMAIL_PASS', 'EMAIL_FROM',
  'BASE_URL', 'ADMIN_EMAIL',
];

function validate() {
  const missing = [];
  const tooShort = [];

  for (const { name, minLength } of REQUIRED) {
    const v = process.env[name];
    if (!v || v.length === 0) {
      missing.push(name);
      continue;
    }
    if (minLength && v.length < minLength) {
      tooShort.push(`${name} (${v.length} char, richiesti ${minLength})`);
    }
  }

  if (missing.length || tooShort.length) {
    const lines = [
      'Configurazione env non valida. Impossibile avviare.',
      '',
      missing.length  ? `  Mancanti: ${missing.join(', ')}` : null,
      tooShort.length ? `  Troppo corte: ${tooShort.join(', ')}` : null,
      '',
      'Genera segreti con:  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
      'Vedi .env.example per lista completa.',
    ].filter(Boolean).join('\n');
    console.error('\n' + lines + '\n');
    process.exit(1);
  }

  const warnings = RECOMMENDED.filter(n => !process.env[n]);
  if (warnings.length) {
    console.warn(`⚠ env opzionali mancanti: ${warnings.join(', ')} — alcune feature potrebbero non funzionare.`);
  }
}

validate();

module.exports = { validate };
```

- [ ] **Step 2:** modificare `shop/server.js` — sostituire la riga 1 con:

```js
require('./src/config/env'); // deve essere la PRIMA riga (valida env e fail-fast)
const app = require('./src/app');
```

- [ ] **Step 3 — Verifica:**
```bash
cd shop && JWT_SECRET="" node server.js
# Expected: stampa "Configurazione env non valida" + lista + exit 1
# Poi con .env reale:
node server.js
# Expected: avvio normale, nessun errore di env
```

- [ ] **Step 4 — Commit:**
```bash
git add shop/src/config/env.js shop/server.js
git commit -m "chore(env): fail-fast validation for critical env vars"
```

**Ref finding:** M0-T4, PROD-015, PROD-017.

---

### Task G0-2: `shop/.env.example` completo

**Files:**
- Modify: `shop/.env.example`

- [ ] **Step 1:** leggere `shop/.env.example` attuale. Se mancano variabili, aggiungerle. Stato finale atteso (esatto):

```env
# ─── Server ───────────────────────────────────────────────────────────────────
NODE_ENV=development
PORT=3000
BASE_URL=http://localhost:3000

# ─── Database ─────────────────────────────────────────────────────────────────
# Dev: SQLite locale (file). Prod: Postgres (sarà introdotto in M3-T1).
DATABASE_URL="file:./dev.db"

# ─── Auth (JWT) ───────────────────────────────────────────────────────────────
# Generare con:  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
JWT_SECRET=change_me_32_bytes_hex
JWT_REFRESH_SECRET=change_me_32_bytes_hex
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

# ─── CSRF ─────────────────────────────────────────────────────────────────────
CSRF_SECRET=change_me_32_bytes_hex

# ─── Stripe ───────────────────────────────────────────────────────────────────
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...

# ─── Email (nodemailer) ───────────────────────────────────────────────────────
EMAIL_HOST=smtp.example.com
EMAIL_PORT=587
EMAIL_USER=user@example.com
EMAIL_PASS=change_me
EMAIL_FROM="MF Depur <noreply@mfdepur.com>"

# ─── Admin seed (usato SOLO da prisma/seed.js in dev) ─────────────────────────
ADMIN_EMAIL=admin@mfdepur.com
ADMIN_PASSWORD=change_me_strong_min_10

# ─── Uploads ──────────────────────────────────────────────────────────────────
UPLOAD_MAX_SIZE_MB=5
```

- [ ] **Step 2 — Verifica:**
```bash
grep -E "process\.env\." shop/src/**/*.js shop/server.js shop/prisma/seed.js 2>/dev/null \
  | grep -oE "process\.env\.[A-Z_]+" | sort -u > /tmp/used.txt
grep -oE "^[A-Z_]+=" shop/.env.example | tr -d '=' | sort -u > /tmp/documented.txt
diff /tmp/used.txt /tmp/documented.txt
# Expected: tutte le env vars usate sono presenti in .env.example (OK se diff vuoto o solo righe in documented.txt)
```

- [ ] **Step 3 — Commit:**
```bash
git add shop/.env.example
git commit -m "docs(env): documenta tutte le env vars con placeholder sicuri"
```

**Ref finding:** M0-T5, PROD-007.

---

### Task G0-3: `src/config/constants.js`

**Files:**
- Create: `shop/src/config/constants.js`

- [ ] **Step 1:** creare `shop/src/config/constants.js`:

```js
// src/config/constants.js
// Costanti condivise. Single source of truth — se cambia qualcosa qui,
// cambia in tutto il sistema.

// IVA ordinaria italiana. M2 introdurrà aliquote per-product.
const TAX_RATE = 0.22;

// Stati Order (schema.prisma:166 + business rules)
const ORDER_STATUSES = Object.freeze([
  'PENDING', 'PAYMENT_FAILED', 'CONFIRMED', 'PROCESSING',
  'SHIPPED', 'DELIVERED', 'CANCELLED', 'REFUNDED',
]);

// Transizioni permesse. Un admin non può forzare DELIVERED→PENDING.
// (Stripe webhook può portare PENDING→CONFIRMED o PENDING→PAYMENT_FAILED.)
const ORDER_STATUS_TRANSITIONS = Object.freeze({
  PENDING:        ['CONFIRMED', 'PAYMENT_FAILED', 'CANCELLED'],
  PAYMENT_FAILED: ['PENDING', 'CANCELLED'],
  CONFIRMED:      ['PROCESSING', 'CANCELLED', 'REFUNDED'],
  PROCESSING:     ['SHIPPED', 'CANCELLED', 'REFUNDED'],
  SHIPPED:        ['DELIVERED', 'REFUNDED'],
  DELIVERED:      ['REFUNDED'],
  CANCELLED:      [],
  REFUNDED:       [],
});

// Stati Company (schema.prisma:21 + business rules)
const COMPANY_STATUSES = Object.freeze(['PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED']);

// Max length campi free-text (usati da controller per slice/validation)
const MAX_LEN = Object.freeze({
  orderNotes:      1000,
  companyNotes:    2000,
  trackingNumber:  100,
  addressStreet:   200,
  addressCity:     100,
  firstName:       100,
  lastName:        100,
  phone:           30,
});

module.exports = {
  TAX_RATE,
  ORDER_STATUSES,
  ORDER_STATUS_TRANSITIONS,
  COMPANY_STATUSES,
  MAX_LEN,
};
```

- [ ] **Step 2 — Verifica:**
```bash
cd shop && node -e "console.log(require('./src/config/constants'))"
# Expected: stampa l'oggetto con TAX_RATE, ORDER_STATUSES, etc.
```

- [ ] **Step 3 — Commit:**
```bash
git add shop/src/config/constants.js
git commit -m "chore(config): centralize TAX_RATE + ORDER_STATUSES + transitions"
```

**Ref finding:** M0-T12, CQ-007, CQ-015.

---

## Batch A — Package & seed hardening (parallelizzabile)

**Scope subagent:** modifiche piccole e isolate a `package.json`, `.nvmrc`, `prisma/seed.js`.

### Task A-1: `engines.node` + `.nvmrc`

**Files:**
- Modify: `shop/package.json`
- Create: `.nvmrc` (root del repo, non dentro `shop/`)

- [ ] **Step 1:** aggiungere in `shop/package.json`, subito dopo `"description"`:
```json
  "engines": {
    "node": ">=18.17.0"
  },
```

- [ ] **Step 2:** creare `.nvmrc` nella **root del repo** (non in `shop/`) con contenuto:
```
20
```

- [ ] **Step 3 — Verifica:**
```bash
node -e "console.log(require('./shop/package.json').engines)"
# Expected: { node: '>=18.17.0' }
cat .nvmrc
# Expected: 20
```

- [ ] **Step 4 — Commit:**
```bash
git add shop/package.json .nvmrc
git commit -m "chore(node): pin engines.node >=18.17.0 + .nvmrc"
```

**Ref finding:** M0-T3, PROD-013.

---

### Task A-2: `prisma/seed.js` — guard prod + fail-fast `ADMIN_PASSWORD`

**Files:**
- Modify: `shop/prisma/seed.js`

- [ ] **Step 1:** leggere `shop/prisma/seed.js` completo.

- [ ] **Step 2:** aggiungere come **prime righe del file** (prima di qualsiasi altro codice):

```js
if (process.env.NODE_ENV === 'production') {
  console.error('❌ seed.js non è eseguibile in produzione. NODE_ENV=production rifiutato.');
  process.exit(1);
}
```

- [ ] **Step 3:** sostituire `const adminPassword = process.env.ADMIN_PASSWORD || 'CambiaSubito!123';` (o simile) con:

```js
const adminPassword = process.env.ADMIN_PASSWORD;
if (!adminPassword || adminPassword.length < 10) {
  console.error('❌ ADMIN_PASSWORD non impostata o troppo corta (min 10 char). Aborto.');
  process.exit(1);
}
```

Se anche `Demo1234!` (mock company) è hardcoded in seed, sostituirlo analogamente con:
```js
const demoCompanyPassword = process.env.SEED_DEMO_PASSWORD || require('crypto').randomBytes(12).toString('base64');
console.log(`ℹ️  Password demo company generata: ${demoCompanyPassword}`);
```

- [ ] **Step 4 — Verifica:**
```bash
cd shop
# 1. Guard prod
NODE_ENV=production node prisma/seed.js
# Expected: exit 1 con messaggio "non eseguibile in produzione"

# 2. Fail-fast ADMIN_PASSWORD
unset ADMIN_PASSWORD && node prisma/seed.js
# Expected: exit 1 con messaggio "ADMIN_PASSWORD non impostata"
```

- [ ] **Step 5 — Commit:**
```bash
git add shop/prisma/seed.js
git commit -m "chore(seed): guard prod + fail-fast without ADMIN_PASSWORD"
```

**Ref finding:** M0-T1, M0-T2, PROD-005, PROD-023.

---

## Batch B — Route `account.js` validation + ownership (parallelizzabile con A/C/D/E)

**Scope subagent:** tutte le modifiche a `shop/src/routes/account.js` (validation profile/addresses, rate limit delete) + 1 modifica a `orderController.js` (ownership addressId).

**⚠ Attenzione:** i 4 task di questo batch toccano lo stesso file `routes/account.js` — devono essere applicati in sequenza **dentro il batch**. La parallelizzazione è verso gli altri batch.

### Task B-1: Rate limit su `/account/delete`

**Files:**
- Modify: `shop/src/routes/account.js`

- [ ] **Step 1:** in cima a `shop/src/routes/account.js` aggiungere (dopo `require` esistenti):
```js
const rateLimit = require('express-rate-limit');

const deleteAccountLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 ora
  max: 3,
  keyGenerator: (req) => req.user?.id || req.ip,
  message: 'Troppi tentativi di cancellazione. Riprova tra un\'ora.',
});
```

- [ ] **Step 2:** modificare la definizione `router.post('/delete', async (req, res) => {` in:
```js
router.post('/delete', deleteAccountLimiter, async (req, res) => {
```

- [ ] **Step 3 — Commit:**
```bash
git add shop/src/routes/account.js
git commit -m "security(rate-limit): /account/delete max 3/hour per user"
```

**Ref finding:** M0-T7, SEC-005.

---

### Task B-2: Validation `POST /account/profile`

**Files:**
- Modify: `shop/src/routes/account.js`

- [ ] **Step 1:** aggiungere a `require`:
```js
const { body, validationResult } = require('express-validator');
const { MAX_LEN } = require('../config/constants');
```

- [ ] **Step 2:** sostituire l'handler `router.post('/profile', async (req, res) => { ... })` con:

```js
router.post('/profile',
  [
    body('firstName').trim().notEmpty().isLength({ max: MAX_LEN.firstName })
      .withMessage(`Nome obbligatorio (max ${MAX_LEN.firstName} caratteri)`),
    body('lastName').trim().notEmpty().isLength({ max: MAX_LEN.lastName })
      .withMessage(`Cognome obbligatorio (max ${MAX_LEN.lastName} caratteri)`),
    body('phone').optional({ checkFalsy: true }).trim().isLength({ max: MAX_LEN.phone })
      .withMessage(`Telefono troppo lungo (max ${MAX_LEN.phone} caratteri)`),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(422).render('account/profile', {
        title: 'Profilo',
        errors: errors.array().map(e => e.msg),
      });
    }
    const { firstName, lastName, phone } = req.body;
    await prisma.user.update({
      where: { id: req.user.id },
      data: {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        phone: phone?.trim() || null,
      },
    });
    res.redirect('/account/profile?success=1');
  }
);
```

- [ ] **Step 3 — Verifica runtime:** avviare server e testare:
```bash
# Login → POST /account/profile con firstName vuoto
# Expected: 422 + pagina profile con lista errori
# POST con firstName valido → 302 redirect /account/profile?success=1
```

- [ ] **Step 4 — Commit:**
```bash
git add shop/src/routes/account.js
git commit -m "security(account): validate POST /profile input (length, required)"
```

**Ref finding:** M0-T8, SEC-001.

---

### Task B-3: Validation `POST /account/addresses`

**Files:**
- Modify: `shop/src/routes/account.js`

- [ ] **Step 1:** sostituire l'handler `router.post('/addresses', async (req, res) => { ... })` con:

```js
router.post('/addresses',
  [
    body('label').optional({ checkFalsy: true }).trim().isLength({ max: 80 }),
    body('street').trim().notEmpty().isLength({ max: MAX_LEN.addressStreet })
      .withMessage(`Via obbligatoria (max ${MAX_LEN.addressStreet})`),
    body('city').trim().notEmpty().isLength({ max: MAX_LEN.addressCity })
      .withMessage(`Città obbligatoria (max ${MAX_LEN.addressCity})`),
    body('province').trim().matches(/^[A-Z]{2}$/)
      .withMessage('Provincia: 2 lettere maiuscole (es. MI)'),
    body('postalCode').trim().matches(/^\d{5}$/)
      .withMessage('CAP: 5 cifre'),
    body('country').optional({ checkFalsy: true }).trim().isLength({ min: 2, max: 2 }).isAlpha()
      .withMessage('Country code ISO-2 (es. IT)'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const addresses = await prisma.address.findMany({
        where: { companyId: req.user.companyId },
        orderBy: { isDefault: 'desc' },
      });
      return res.status(422).render('account/addresses', {
        title: 'Indirizzi di spedizione',
        addresses,
        errors: errors.array().map(e => e.msg),
      });
    }

    const { label, street, city, province, postalCode, country, isDefault } = req.body;

    // Operazione atomica: reset isDefault + create in single transaction (M1-T6 anticipato)
    await prisma.$transaction(async (tx) => {
      if (isDefault === 'on') {
        await tx.address.updateMany({
          where: { companyId: req.user.companyId },
          data: { isDefault: false },
        });
      }
      await tx.address.create({
        data: {
          companyId: req.user.companyId,
          label: label || 'Sede legale',
          street: street.trim(),
          city: city.trim(),
          province: province.trim().toUpperCase(),
          postalCode: postalCode.trim(),
          country: (country || 'IT').toUpperCase(),
          isDefault: isDefault === 'on',
        },
      });
    });
    res.redirect('/account/addresses?success=1');
  }
);
```

- [ ] **Step 2 — Verifica:**
```
# POST con postalCode="abc" → 422 + errore CAP
# POST con province="milano" → 422 + errore Provincia
# POST valido → 302 + indirizzo creato
```

- [ ] **Step 3 — Commit:**
```bash
git add shop/src/routes/account.js
git commit -m "security(account): validate POST /addresses + atomic isDefault"
```

**Ref finding:** M0-T9, SEC-002, CQ-011 (bonus: già atomico).

---

### Task B-4: Ownership `addressId` al checkout

**Files:**
- Modify: `shop/src/controllers/orderController.js`

- [ ] **Step 1:** leggere `shop/src/controllers/orderController.js` — trovare la funzione `postCheckout` (o simile) e individuare il punto in cui viene usato `req.body.addressId`.

- [ ] **Step 2:** **prima** dell'uso di `addressId` nel DB (prima di qualsiasi `prisma.order.create` o `prisma.$transaction`), inserire:

```js
// Verifica ownership indirizzo: deve appartenere alla company dell'utente
if (addressId) {
  const addr = await prisma.address.findFirst({
    where: { id: addressId, companyId: req.user.companyId },
    select: { id: true },
  });
  if (!addr) {
    return res.status(403).render('error', {
      message: 'Indirizzo non valido o non autorizzato.',
      code: 403,
    });
  }
}
```

Adattare il tipo di risposta (JSON vs render) al pattern esistente nel controller se diverso.

- [ ] **Step 3 — Verifica manuale:**
```
# User di companyA → POST /shop/checkout con addressId di companyB
# Expected: 403 Forbidden (non 500, non ordine creato)
```

- [ ] **Step 4 — Commit:**
```bash
git add shop/src/controllers/orderController.js
git commit -m "security(checkout): verify addressId ownership against user company (IDOR fix)"
```

**Ref finding:** M0-T10, SEC-010.

---

## Batch C — Rate limits e routes sicure (parallelizzabile)

**Scope subagent:** modifiche a `app.js` (rate limit checkout) + `routes/shop.js` (rate limit cart).

**⚠ Nota:** il rate limit di checkout andrebbe in `app.js` dove sono già le altre definizioni di limiter; oppure in `routes/shop.js` inline. Seguire la convenzione esistente — nell'audit si osserva che limiter sono già in `app.js:87-89`, quindi aggiungere lì.

### Task C-1: Rate limit `POST /shop/checkout`

**Files:**
- Modify: `shop/src/app.js`

- [ ] **Step 1:** in `shop/src/app.js`, dopo le 3 definizioni di `rateLimit` esistenti (~riga 87-89), aggiungere:

```js
app.use('/shop/checkout', rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  keyGenerator: (req) => req.user?.id || req.ip,
  message: 'Troppi tentativi di checkout. Riprova tra un minuto.',
}));
```

- [ ] **Step 2 — Verifica:**
```
# Script: 11 POST /shop/checkout in <60s
# Expected: 11° → 429
```

- [ ] **Step 3 — Commit:**
```bash
git add shop/src/app.js
git commit -m "security(rate-limit): /shop/checkout max 10/min per user"
```

**Ref finding:** M0-T6, SEC-004.

---

### Task C-2: Rate limit `/shop/cart/*` (mutations)

**Files:**
- Modify: `shop/src/app.js`

- [ ] **Step 1:** aggiungere subito dopo C-1:

```js
// Rate limit mutations carrello (add/update/remove/clear — non i GET read)
app.use(['/shop/cart/add', '/shop/cart/update', '/shop/cart/remove', '/shop/cart/clear', '/shop/cart/item'], rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  keyGenerator: (req) => req.user?.id || req.ip,
  message: 'Troppe operazioni sul carrello. Rallenta un attimo.',
}));
```

- [ ] **Step 2 — Verifica:**
```
# Script: 61 POST /shop/cart/add in <60s
# Expected: 61° → 429
```

- [ ] **Step 3 — Commit:**
```bash
git add shop/src/app.js
git commit -m "security(rate-limit): /shop/cart/* mutations max 60/min per user"
```

**Ref finding:** M0-T13, SHOP-017.

---

## Batch D — Controller hardening (parallelizzabile — più file distinti)

**Scope subagent:** modifiche a `productController.js` e `adminController.js`. File distinti, possono essere ulteriormente paralleli internamente se si splitta D-Prod / D-Admin.

### Task D-1: Rimuovere import `path` inutilizzato in `productController.js`

**Files:**
- Modify: `shop/src/controllers/productController.js`

- [ ] **Step 1:** riga 2 del file — rimuovere `const path = require('path');` se non usata nel file.

- [ ] **Step 2 — Verifica:**
```bash
grep -n "path\." shop/src/controllers/productController.js
# Expected: nessuna riga (o solo in contesti non-path module, es. path-to-something)
grep -c "require('path')" shop/src/controllers/productController.js
# Expected: 0
```

- [ ] **Step 3 — Commit:**
```bash
git add shop/src/controllers/productController.js
git commit -m "refactor(product): rm unused path import"
```

**Ref finding:** M0-T11, CQ-019.

---

### Task D-2: Clamp numerici + existence `categoryId` + max-length notes su product

**Files:**
- Modify: `shop/src/controllers/productController.js`

- [ ] **Step 1:** aggiungere in testa al file (dopo i require esistenti):
```js
const { MAX_LEN } = require('../config/constants');

const clampInt = (v, min, max, def = 0) => {
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) return def;
  return Math.max(min, Math.min(max, n));
};
const clampFloat = (v, min, max, def = 0) => {
  const n = parseFloat(v);
  if (Number.isNaN(n)) return def;
  return Math.max(min, Math.min(max, n));
};
```

- [ ] **Step 2:** individuare la funzione `_parseProductBody` (o simile). Sostituire le estrazioni numeriche con i clamp:

```js
function _parseProductBody(body) {
  const data = {
    name: body.name?.trim() || '',
    slug: body.slug?.trim() || '',
    description: body.description?.trim() || null,
    shortDesc: body.shortDesc?.trim().slice(0, 300) || null,
    price: clampFloat(body.price, 0, 1_000_000, 0),
    comparePrice: body.comparePrice ? clampFloat(body.comparePrice, 0, 1_000_000, 0) : null,
    sku: body.sku?.trim() || null,
    stock: clampInt(body.stock, 0, 1_000_000, 0),
    lowStockAlert: clampInt(body.lowStockAlert, 0, 10_000, 10),
    unit: body.unit?.trim() || 'kg',
    minOrderQty: clampInt(body.minOrderQty, 1, 10_000, 1),
    isActive: body.isActive === 'on' || body.isActive === true,
    isFeatured: body.isFeatured === 'on' || body.isFeatured === true,
    priceOnRequest: body.priceOnRequest === 'on' || body.priceOnRequest === true,
    imageUrl: body.imageUrl?.trim() || null,
    technicalSheet: body.technicalSheet?.trim() || null,
    categoryId: body.categoryId || null,
  };
  // Sanity: comparePrice > price o null
  if (data.comparePrice !== null && data.comparePrice <= data.price) {
    data.comparePrice = null;
  }
  return data;
}
```

- [ ] **Step 3:** nelle funzioni che creano/aggiornano product (`adminCreate`/`adminUpdate` — adattare ai nomi reali), **prima** della `prisma.product.create/update`, aggiungere:

```js
if (data.categoryId) {
  const cat = await prisma.category.findUnique({
    where: { id: data.categoryId },
    select: { id: true },
  });
  if (!cat) {
    return res.status(400).render('error', { message: 'Categoria non valida.', code: 400 });
  }
}
```

E per l'update, verificare esistenza del product:
```js
const existing = await prisma.product.findUnique({
  where: { id: req.params.id },
  select: { id: true },
});
if (!existing) {
  return res.status(404).render('error', { message: 'Prodotto non trovato.', code: 404 });
}
```

- [ ] **Step 4:** trovare la funzione `adminCategoryCreate`/`adminCategoryUpdate` e applicare clamp a `sortOrder`:
```js
sortOrder: clampInt(body.sortOrder, 0, 10_000, 0),
```

- [ ] **Step 5 — Verifica:**
```
# Admin POST product con price=-5 stock=-999 → salvato con price=0 stock=0
# Admin POST product con categoryId="nonesiste" → 400 "Categoria non valida"
# Admin PUT product con id inesistente → 404
```

- [ ] **Step 6 — Commit:**
```bash
git add shop/src/controllers/productController.js
git commit -m "security(product): clamp numerics + verify category/product existence"
```

**Ref finding:** M0-T14, M0-T18, SEC-021, SEC-022, SEC-023, SEC-031, SEC-032.

---

### Task D-3: Validation enum `Company.status` + `AuditLog` su admin login

**Files:**
- Modify: `shop/src/controllers/adminController.js`
- (opzionale) `shop/src/controllers/authController.js`

- [ ] **Step 1:** in `adminController.js`, in testa aggiungere:
```js
const { COMPANY_STATUSES, MAX_LEN } = require('../config/constants');
```

- [ ] **Step 2:** trovare la funzione che aggiorna `Company.status` (cerca `prisma.company.update` con `status`). Prima di update, inserire:

```js
const { status, notes } = req.body;
if (!COMPANY_STATUSES.includes(status)) {
  return res.status(400).render('error', {
    message: `Stato company non valido. Ammessi: ${COMPANY_STATUSES.join(', ')}`,
    code: 400,
  });
}
const safeNotes = notes ? String(notes).slice(0, MAX_LEN.companyNotes) : undefined;
await prisma.company.update({
  where: { id: req.params.id },
  data: { status, notes: safeNotes },
});
```

- [ ] **Step 3 — Verifica:**
```
# Admin POST con status="HACKED" → 400
# Admin POST con notes di 5000 char → salvato a 2000 char
```

- [ ] **Step 4 — Commit:**
```bash
git add shop/src/controllers/adminController.js
git commit -m "security(admin): validate Company.status enum + clamp notes length"
```

**Ref finding:** M0-T16, M0-T17 (companyNotes), SEC-027.

---

### Task D-4: State machine `Order.status` + max-length `trackingNumber`/`notes`

**Files:**
- Modify: `shop/src/controllers/adminController.js`

- [ ] **Step 1:** aggiungere in testa (se non già fatto in D-3):
```js
const { ORDER_STATUSES, ORDER_STATUS_TRANSITIONS, MAX_LEN } = require('../config/constants');
```

- [ ] **Step 2:** trovare la funzione `updateOrderStatus` (o simile) in `adminController.js`. Pattern da applicare:

```js
async function updateOrderStatus(req, res) {
  const { status, trackingNumber, adminNotes } = req.body;
  if (!ORDER_STATUSES.includes(status)) {
    return res.status(400).render('error', {
      message: `Stato ordine non valido. Ammessi: ${ORDER_STATUSES.join(', ')}`,
      code: 400,
    });
  }

  const current = await prisma.order.findUnique({
    where: { id: req.params.id },
    select: { id: true, status: true },
  });
  if (!current) {
    return res.status(404).render('error', { message: 'Ordine non trovato.', code: 404 });
  }

  const allowed = ORDER_STATUS_TRANSITIONS[current.status] || [];
  if (status !== current.status && !allowed.includes(status)) {
    return res.status(400).render('error', {
      message: `Transizione non permessa: ${current.status} → ${status}. Permessi: ${allowed.join(', ') || '(nessuno)'}`,
      code: 400,
    });
  }

  const data = { status };
  if (trackingNumber !== undefined) data.trackingNumber = String(trackingNumber).slice(0, MAX_LEN.trackingNumber);
  if (adminNotes !== undefined)     data.adminNotes     = String(adminNotes).slice(0, MAX_LEN.orderNotes);
  if (status === 'SHIPPED'   && !current.shippedAt)    data.shippedAt = new Date();
  if (status === 'DELIVERED' && !current.deliveredAt) data.deliveredAt = new Date();

  await prisma.order.update({ where: { id: current.id }, data });
  await logAudit(req, {
    action: 'ORDER_STATUS_CHANGE',
    entityType: 'Order',
    entityId: current.id,
    metadata: { from: current.status, to: status },
  });
  res.redirect(`/admin/orders/${current.id}`);
}
```

Attenzione: se la funzione esistente include anche `current.shippedAt`/`deliveredAt` nella select iniziale, aggiungerli a `select:`. Adattare al pattern.

- [ ] **Step 3 — Verifica:**
```
# Admin tenta DELIVERED → PENDING su ordine DELIVERED → 400 "Transizione non permessa"
# Admin valid PROCESSING → SHIPPED → 302 + shippedAt valorizzato
# Admin status="HACKED" → 400
# Admin tracking di 500 char → salvato a 100 char
```

- [ ] **Step 4 — Commit:**
```bash
git add shop/src/controllers/adminController.js
git commit -m "security(admin): Order status state machine + clamp tracking/notes"
```

**Ref finding:** M0-T15, M0-T17 (order parts), SEC-028, SEC-029.

---

### Task D-5: Log `AuditLog` su Stripe webhook firma invalida

**Files:**
- Modify: `shop/src/controllers/orderController.js`

- [ ] **Step 1:** trovare il blocco che gestisce firma webhook Stripe invalida (grep `constructEvent`/`invalid`/`stripe-webhook`). Pattern da applicare:

```js
} catch (err) {
  // Log strutturato + persistente in AuditLog
  try {
    await prisma.auditLog.create({
      data: {
        userId: null,
        userEmail: null,
        action: 'STRIPE_WEBHOOK_INVALID_SIG',
        entityType: 'Webhook',
        entityId: null,
        metadata: JSON.stringify({ error: err.message?.slice(0, 500) }),
        ipAddress: req.ip,
        userAgent: req.get('user-agent')?.slice(0, 500),
      },
    });
  } catch (_) { /* best-effort */ }
  console.warn('[stripe-webhook] firma non valida:', err.message);
  return res.status(400).send('Invalid signature');
}
```

(Adattare al pattern esistente: se il controller usa già `logAudit` con una req-like object, preferirlo. Se il `req` dentro al webhook handler non ha `user` ma ha `ip/headers`, usare il pattern diretto sopra.)

- [ ] **Step 2 — Verifica:**
```
# curl webhook con firma sbagliata → 400 + riga in AuditLog
# SELECT * FROM AuditLog WHERE action = 'STRIPE_WEBHOOK_INVALID_SIG' ORDER BY createdAt DESC LIMIT 1
```

- [ ] **Step 3 — Commit:**
```bash
git add shop/src/controllers/orderController.js
git commit -m "security(stripe): log invalid webhook signature to AuditLog"
```

**Ref finding:** M0-T20, CQ-014.

---

## Batch E — Schema constraint (parallelizzabile, ma standalone per Prisma)

### Task E-1: `@unique` su `Order.orderNumber` + migration

**Files:**
- Modify: `shop/prisma/schema.prisma`
- Create: new dir in `shop/prisma/migrations/`

- [ ] **Step 1:** in `shop/prisma/schema.prisma`, sulla definizione `model Order`, trovare la riga:
```prisma
orderNumber     String    @unique
```
Se è già presente `@unique`, **il task è no-op** (skip a step 3 con motivazione nel commit "chore: confirm Order.orderNumber unique"). Altrimenti aggiungere `@unique`.

Verifica con:
```bash
grep "orderNumber" shop/prisma/schema.prisma
```

- [ ] **Step 2:** generare migration:
```bash
cd shop && npx prisma migrate dev --name order_number_unique
# Expected: nuova dir shop/prisma/migrations/YYYYMMDDHHMMSS_order_number_unique/
# Se il vincolo esisteva già, migrate non genera nulla. OK.
```

- [ ] **Step 3 — Verifica:**
```bash
node -e "require('./src/config/database').order.count().then(c => console.log('OK',c))"
# Expected: OK N (app connette al DB senza errori schema)
```

Test duplicato:
```bash
node -e "
const p = require('./src/config/database');
(async () => {
  try {
    await p.order.create({ data: { orderNumber: 'TEST-DUP', /* ...campi minimi... */ } });
    await p.order.create({ data: { orderNumber: 'TEST-DUP', /* idem */ } });
    console.log('FAIL: duplicato non bloccato');
  } catch (e) {
    console.log('OK: duplicato bloccato ->', e.code);
  }
})()
"
# Expected: "OK: duplicato bloccato -> P2002"
```

Se il test richiede troppi campi, skip — verificare semplicemente `npx prisma db push --preview-feature` o `migrate status`.

- [ ] **Step 4 — Commit:**
```bash
git add shop/prisma/schema.prisma shop/prisma/migrations/
git commit -m "db(order): @unique on orderNumber to prevent race duplicates"
```

**Ref finding:** M0-T19, CQ-017.

---

## Wrap-up (orchestrator, NON delegato)

- [ ] **Step 1 — Smoke test complessivo:** avviare il server in dev e verificare che l'app parta senza errori:
```bash
cd shop && npm run dev
# Expected: "Database connesso" + "MF Depur Shop in esecuzione" senza errori di env
```

- [ ] **Step 2 — Prova rapida navigazione:**
  - `http://localhost:3000/` → landing / homepage
  - `http://localhost:3000/auth/login` → form login
  - `http://localhost:3000/shop` → catalog
  - login con utente di test → checkout flow (verificare rate limit visibile sul 11° tentativo)

- [ ] **Step 3 — Verifica lista commit M0:**
```bash
git log --oneline master..HEAD
# Expected: lista di ~15-18 commit M0 (alcuni task possono aver generato più commit, altri uno solo)
```

- [ ] **Step 4 — Merge M0 in master (opzionale, chiedere al PO):**
```bash
git checkout master && git merge --no-ff feat/M0-quick-wins -m "feat(M0): quick wins + safety net (audit 2026-04-23)"
```

- [ ] **Step 5 — Aggiornare stato milestone:**
  - Aggiornare `docs/audit/2026-04-23/01-activeContext.md` con "Fase M0 ✅ completata"
  - Aggiornare memoria persistente `audit_roadmap_2026-04-23.md` con `[x] M0 done`
  - Commit finale: `docs(audit): M0 completata`

---

## Riepilogo coverage audit

| Task plan | Ref audit | Finding |
|---|---|---|
| G0-1 | M0-T4 | PROD-015, PROD-017 |
| G0-2 | M0-T5 | PROD-007 |
| G0-3 | M0-T12 | CQ-007, CQ-015 |
| A-1 | M0-T3 | PROD-013 |
| A-2 | M0-T1, M0-T2 | PROD-005, PROD-023 |
| B-1 | M0-T7 | SEC-005 |
| B-2 | M0-T8 | SEC-001 |
| B-3 | M0-T9 | SEC-002 (+ bonus CQ-011 atomico) |
| B-4 | M0-T10 | SEC-010 |
| C-1 | M0-T6 | SEC-004 |
| C-2 | M0-T13 | SHOP-017 |
| D-1 | M0-T11 | CQ-019 |
| D-2 | M0-T14, T18 | SEC-021/022/023/031/032 |
| D-3 | M0-T16, T17 (company) | SEC-027 |
| D-4 | M0-T15, T17 (order) | SEC-028, SEC-029 |
| D-5 | M0-T20 | CQ-014 |
| E-1 | M0-T19 | CQ-017 |

Copertura: **20/20 task** del master document M0.

## Decomposizione esecutiva (subagent-driven)

| Wave | Chi | Cosa | Dipende da |
|---|---|---|---|
| 0 | orchestrator | Pre-flight branch `feat/M0-quick-wins` | — |
| 1 | 1 subagent (sequenziale) | G0-1, G0-2, G0-3 | wave 0 |
| 2 | 5 subagent **paralleli** | Batch A, B, C, D, E | wave 1 |
| 3 | orchestrator | Wrap-up + merge opzionale | wave 2 |

Tempo atteso totale: 1.5-3 ore (1 sessione).
