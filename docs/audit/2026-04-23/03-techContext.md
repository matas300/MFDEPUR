# Tech Context — MFDEPUR Shop

> Fonti: `shop/package.json`, `shop/server.js`, `shop/src/app.js`, `shop/prisma/schema.prisma` (letti in fase 1).

## Stack principale

| Area | Tech | Versione | Note |
|---|---|---|---|
| Runtime | Node.js | (non fissata — **no `engines`**) | ⚠ gap |
| Web framework | Express | ^4.18.2 | Express 5 rilasciato — valutare migrazione |
| Template engine | EJS | ^3.1.9 | |
| ORM | Prisma | ^5.10.0 | |
| DB dev | SQLite | `shop/prisma/dev.db` | |
| DB prod | *da confermare* | — | schema parla di `DATABASE_URL` ma datasource è `sqlite` |
| Payment | Stripe | ^14.17.0 | webhook fail-close (commit `60ad629`) |
| Email | Nodemailer | ^8.0.5 | |
| Auth | JWT (jsonwebtoken) + cookie-parser | ^9.0.2 | pattern cookie-JWT, no express-session |
| Password hash | bcryptjs | ^2.4.3 | pure-JS (più lento di `bcrypt` nativo) |
| CSRF | csrf-csrf | ^4.0.3 | double-submit (modern, sostituisce csurf deprecato) |
| Rate limit | express-rate-limit | ^7.2.0 | applicato solo a `/auth/*` |
| Security headers | Helmet | ^7.1.0 | CSP con nonce, HSTS prod |
| Upload file | Multer | ^1.4.5-lts.1 | ⚠ 1.x ha CVE note — valutare 2.x |
| Validation | express-validator | ^7.0.1 | |
| Dev | Nodemon | ^3.1.0 | |

## Script npm

```json
"start":     "node server.js"
"dev":       "nodemon server.js"
"db:migrate":"npx prisma migrate dev"
"db:push":   "npx prisma db push"
"db:studio": "npx prisma studio"
"db:seed":   "node prisma/seed.js"
```

### ⚠ Gap rispetto a CLAUDE.md

CLAUDE.md promette:
- `npm run build` — **non esiste**
- `npm test` — **non esiste**
- `npm run lint` — **non esiste**

**Nessun test framework installato** (jest/mocha/vitest/supertest). **Nessun linter** (eslint/prettier). Da risolvere in milestone "Production Readiness".

## Architettura

```
shop/
├─ server.js              # bootstrap, prisma.$connect, signal handlers, start(PORT)
├─ prisma/
│  ├─ schema.prisma       # Company, User, Session, Category, Product, Cart,
│  │                      # CartItem, Address, Order, OrderItem, AuditLog
│  ├─ seed.js
│  └─ dev.db              (gitignored)
├─ public/                # static: assets/, css/, img/, js/, index.html
├─ uploads/               (gitignored, multer target)
├─ views/                 # EJS: admin/, auth/, account/, shop/, partials/, error.ejs, privacy.ejs
└─ src/
   ├─ app.js              # express, middleware stack, mount routers
   ├─ config/database.js  # Prisma client singleton
   ├─ middleware/
   │   ├─ auth.js         # injectUser (JWT)
   │   ├─ csrf.js         # ensureCsrfSession, doubleCsrfProtection, injectCsrfToken, csrfErrorHandler
   │   └─ nonce.js        # res.locals.cspNonce per CSP
   ├─ routes/
   │   ├─ auth.js         /auth/*
   │   ├─ shop.js         /shop/*
   │   ├─ account.js      /account/*
   │   ├─ admin.js        /admin/*
   │   └─ sitemap.js      /sitemap.xml
   ├─ controllers/
   │   ├─ authController.js
   │   ├─ productController.js
   │   ├─ cartController.js
   │   ├─ orderController.js   # include stripeWebhook
   │   └─ adminController.js
   └─ utils/
       ├─ audit.js        # AuditLog writer
       └─ email.js        # nodemailer wrapper
```

### Middleware pipeline (`src/app.js`)

1. `trust proxy 1` (prod)
2. HTTPS redirect (prod) — applicato PRIMA del webhook
3. **`/stripe/webhook`** — `express.raw()` + rawBody + controller (PRIMA di `express.json`)
4. `cspNonce` → Helmet (CSP con nonce per scriptSrc, HSTS prod)
5. `express.json()`, `express.urlencoded()`, `cookieParser()`
6. CSRF: `ensureCsrfSession` → `doubleCsrfProtection` → `injectCsrfToken`
7. Rate limit su `/auth/login` (10/15min), `/auth/register` (5/1h), `/auth/forgot-password` (5/1h)
8. Static `public/`, `/uploads`
9. EJS view engine
10. `injectUser`, `res.locals.currentPath`, `res.locals.baseUrl`
11. Routes
12. 404 handler → `error.ejs`
13. `csrfErrorHandler`
14. Error handler generico (no stack leak in prod)

## Domain model (osservazioni veloci)

- **B2B**: `Company` con `vatNumber` unique, `status` (PENDING/APPROVED/REJECTED/SUSPENDED) → Users → Orders
- **Fiscalità IT già modellata**: `Order.taxRate default 0.22`, `taxAmount`, `subtotal`, `shippingCost`, `total` separati — copre base IVA ordinaria; manca evidenza di supporto aliquote differenti (es. 10% sanitari, reverse charge, esenzioni)
- **SDI code + PEC** su `Company` — predisposto per fatturazione elettronica; da verificare esistenza di generatore XML FatturaPA
- **AuditLog** indicizzato su `entityType+entityId`, `userId`, `createdAt` — buona base per traceability admin
- **Session**: refresh token DB-backed (cascade delete su user)
- **Cart**: user-scoped, unique `cartId+productId`
- **Product**: `priceOnRequest`, `minOrderQty`, `unit` (kg default) — chiaramente B2B wholesale

## Posture di sicurezza già applicata

- CSP con nonce, no `unsafe-inline` in `scriptSrc` (commit `79ca025`)
- `styleSrc` ancora con `unsafe-inline` (TODO esplicito in `app.js:62`)
- HSTS 1 anno + preload in prod (commit `348c63a`)
- HTTPS redirect in prod (commit `348c63a`)
- Stripe webhook fail-close su secret/rawBody/firma (commit `60ad629`)
- GDPR: export dati + cancellazione account (commit `419b18d`)
- CSRF double-submit su tutte le route applicative (escluso webhook Stripe)
- Rate limit solo su `/auth/*` — **non** su checkout/order creation
- Error handler maschera stack in produzione

## Assenti / da verificare (flag iniziali, non esaustivi)

- ❌ Test (framework assente)
- ❌ Lint (framework assente)
- ❌ `engines` in package.json (Node version non fissata)
- ❌ `.env.example` (da verificare in fase 2)
- ❌ Script `npm run build` (CLAUDE.md lo promette)
- ⚠ DB prod: datasource SQLite, non è scalabile — serve Postgres o MySQL
- ⚠ Multer 1.x (CVE note)
- ⚠ `unsafe-inline` in styleSrc
- ⚠ Rate limit mancante su checkout/order
- ⚠ `server.js` fa logging di unhandledRejection senza terminare il processo (state potenzialmente corrotto)
