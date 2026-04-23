# System Patterns — MFDEPUR Shop

## Architettura complessiva

**Pattern:** MVC classico con Prisma ORM, nessun layer service/repository.

```
┌─────────────────────────────────────────────┐
│            server.js  (bootstrap)           │
│            prisma.$connect + signals        │
└────────────────────┬────────────────────────┘
                     │
┌────────────────────▼────────────────────────┐
│              src/app.js  (Express)          │
│  ┌─────────────────────────────────────┐    │
│  │ 1. trust proxy (prod)               │    │
│  │ 2. HTTPS redirect (prod)            │    │
│  │ 3. /stripe/webhook (rawBody PRIMA   │    │
│  │    di express.json)                 │    │
│  │ 4. cspNonce → helmet                │    │
│  │ 5. express.json/urlencoded/cookies  │    │
│  │ 6. CSRF double-submit               │    │
│  │ 7. rate-limit auth                  │    │
│  │ 8. static public/ + /uploads        │    │
│  │ 9. EJS view engine                  │    │
│  │ 10. injectUser + locals             │    │
│  │ 11. routers: auth/shop/account/admin│    │
│  │ 12. 404 + csrf-error + error handler│    │
│  └─────────────────────────────────────┘    │
└────────────────────┬────────────────────────┘
                     │
       ┌─────────────┼─────────────┐
       │             │             │
   ┌───▼───┐    ┌────▼────┐   ┌────▼────┐
   │routes/│    │middleware│  │ utils/  │
   └───┬───┘    └─────────┘   └─────────┘
       │
   ┌───▼─────────┐
   │ controllers │
   └──────┬──────┘
          │
     ┌────▼────┐        ┌──────────┐
     │ Prisma  │◄──────►│ SQLite   │
     │ client  │        │ (dev.db) │
     └─────────┘        └──────────┘
```

## Pattern osservati

### Autenticazione
- **JWT access token** (15m, cookie `httpOnly`, `sameSite=lax`)
- **JWT refresh token** (7d, cookie `httpOnly`, `sameSite=strict`, persistito in DB `Session`)
- `injectUser` middleware estrae JWT da cookie, popola `req.user` e `res.locals.user`
- `requireAuth`, `requireAdmin`, `requireApprovedCompany` guards
- Password: `bcryptjs.hash(pw, 12)`

### CSRF
- **csrf-csrf (double-submit)** — token per-GET (regenerato), verificato su ogni mutazione
- Escluso da `/stripe/webhook` (montato prima del middleware)
- Cookie `sameSite='lax'`

### CSP
- **Nonce-based** per `scriptSrc`: `res.locals.cspNonce` generato da `middleware/nonce.js`, iniettato nei template come `<script nonce="<%= cspNonce %>">`
- **Debito tecnico aperto:** `styleSrc` ha ancora `'unsafe-inline'` (207 inline style nei template EJS)

### Payment (Stripe)
- PaymentIntent flow
- Webhook `/stripe/webhook` con `rawBody` + signature verification (fail-close)
- ⚠ **Gap:** update ordine non in `$transaction`, stock decrement non atomico, no idempotency oltre quella nativa Stripe

### Persistenza
- **Prisma** + **SQLite (dev)** — in prod richiede Postgres
- Middleware `$use` custom in `config/database.js` per serializzare `Product.features` e `Product.images` come JSON string (workaround SQLite)
- Nessuna `migrations/` history → schema versioning inesistente
- Modelli: `Company`, `User`, `Session`, `Category`, `Product`, `Cart`, `CartItem`, `Address`, `Order`, `OrderItem`, `AuditLog`

### Audit trail
- `utils/audit.js` scrive su `AuditLog` (userId, action, entityType, entityId, metadata JSON, ip, ua)
- Chiamato da `adminController` (approve/reject/suspend company, status change order) e `account` (GDPR delete)
- ⚠ **Gap:** nessuna UI admin per consultare audit log; no redaction su metadata

### Email
- Nodemailer wrapper in `utils/email.js`
- Trigger: verify email, reset password, order confirmation, admin notify approval
- ⚠ **Gap:** errori silenziati con `.catch(() => {})` — nessun log/retry/queue

### Upload file
- Multer `memoryStorage` → magic-number detection → persist con filename `crypto.randomBytes`
- Storage: `shop/uploads/` (gitignored)
- Servito da `/uploads` static
- ⚠ **Dip:** multer `^1.4.5-lts.1` ha CVE note (→ valutare 2.x)

### Template engine
- EJS con partials (`partials/_header.ejs`, `_admin-footer.ejs`, ecc.)
- Variabili globali iniettate via `res.locals`: `user`, `csrfToken`, `cspNonce`, `currentPath`, `baseUrl`
- Testi in italiano

## Bounded context

```
┌─────────────────────────┐   ┌─────────────────────────┐
│  PUBLIC / CATALOG       │   │  ACCOUNT (B2B portal)   │
│  /shop, /shop/product/* │   │  /account/* (auth)      │
│  homepage, static       │   │  orders, addresses,     │
│                         │   │  profile, GDPR export   │
└────────────┬────────────┘   └────────────┬────────────┘
             │                              │
             └───────────┬──────────────────┘
                         │ (shared: auth, cart, checkout)
┌────────────────────────▼────────────────────────┐
│  CHECKOUT + PAYMENTS                             │
│  /shop/checkout, Stripe PaymentIntent,           │
│  /stripe/webhook, order fulfilment state machine │
└────────────────────────┬────────────────────────┘
                         │
┌────────────────────────▼────────────────────────┐
│  ADMIN (staff)                                   │
│  /admin/* — dashboard, products, categories,     │
│  orders, companies, audit (missing UI), export   │
└──────────────────────────────────────────────────┘
```

## Legacy / fuori scope audit

- **Root `index.html` (42KB)** — landing statica legacy, servita da Hostinger come `www.mfdepur.com`
- **Root `assets/`** — asset della landing statica
- **`New Sites/`** — duplicato/staging della landing statica (cartella inutilizzata)
- **`shop/public/index.html`** — servita da `express.static` come homepage dello shop; da verificare se è placeholder, landing B2B, o duplicato
- **`shop/SPECIFICA.md`** — spec cliente (contenuto non ispezionato)
