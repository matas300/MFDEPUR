# Audit Code Quality & Stabilità — MFDEPUR Shop

**Sub-agent:** Explore (code quality) · **Overall grade:** B

> ⚠ **Caveat:** riferimenti `file:line` da report sub-agent; verificare prima di fix.

## Verdetto

Architettura MVC pulita e middleware ben posizionati. Stabilità runtime con buchi: handler async senza wrapper (`next(err)` non garantito), graceful shutdown incompleto (manca SIGTERM), race su stock senza transazione, `.catch(() => {})` silenti su email. Controller "fat" (logica DB inline) e costanti sparse (es. `0.22`).

## File oltre 500 righe (soglia CLAUDE.md)

| File | Righe stimate | Split suggerito |
|---|---|---|
| `shop/src/controllers/adminController.js` | ~411 | `dashboardController`, `orderAdminController`, `companyController` |
| `shop/src/controllers/productController.js` | ~280 | `productShopController` (pubblico) + `productAdminController` |

> Nota: la soglia del progetto è 500 righe — `adminController` è sotto ma prossimo, `productController` ben sotto. Split consigliato comunque per **separation of concerns**, non per dimensione.

## Findings high

| ID | Area | Titolo | Location |
|---|---|---|---|
| CQ-001 | concurrency | Race condition su stock decrement non atomica (in loop) | `orderController.js:210-217` (`_finalizeOrder`) |
| CQ-002 | errors | Handler async senza try/catch né wrapper `asyncHandler` → promise rejection sfugge a Express 4 | multipli controller |
| CQ-003 | shutdown | Solo `SIGINT` gestito, manca `SIGTERM`; server HTTP non chiuso con `server.close()` prima di `prisma.$disconnect()` | `server.js:22-34` |

**CQ-002** → introdurre `asyncHandler`:
```js
const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
```
Wrappare tutti i controller o migrare a Express 5 (async-aware di default).

**CQ-003** → aggiungere:
```js
const server = app.listen(PORT, ...);
async function shutdown(signal) {
  server.close(async () => { await prisma.$disconnect(); process.exit(0); });
  setTimeout(() => process.exit(1), 30_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
```

## Findings medium

| ID | Area | Titolo | Location |
|---|---|---|---|
| CQ-004 | routing | GET `/shop/cart` accessibile a company non-APPROVED → messaggio confuso | `routes/shop.js:12-23` |
| CQ-005 | async | Email: `.catch(() => {})` silenzia failure nodemailer (reset password, conferme, approval) | `orderController.js:225,228`, `authController.js:198`, `adminController.js:303` |
| CQ-006 | structure | Controller "fat": logica DB diretta, nessun layer service/repository | tutti `controllers/*.js` |
| CQ-007 | structure | `TAX_RATE 0.22` hardcoded in 4 punti, no `constants.js` | `orderController.js:28,62,78`, `cartController.js:19` |
| CQ-009 | tech-debt | TODO su `styleSrc` `unsafe-inline` non risolto | `app.js:61` |
| CQ-010 | routing | `GET /admin/orders/export.csv` senza timeout/stream → DoS su DB grande | `adminController.js:158-169` |
| CQ-011 | concurrency | `Address.isDefault` flag: `updateMany false` + `create true` non atomico → race possibile multi-default | `routes/account.js:40-44` |

## Findings low/info

- **CQ-008** naming OK (camelCase coerente); solo nota.
- **CQ-012** sitemap non include `/account/*` `/admin/*` (corretto); aggiungere `robots.txt` con Disallow.
- **CQ-013** multer memoryStorage OK — nulla di urgente.
- **CQ-014** webhook Stripe firma non valida → solo `console.warn` invece di `AuditLog`.
- **CQ-015** `ORDER_STATUSES` hardcoded in `adminController.js:80` → centralizzare in `config/constants.js`.
- **CQ-016** logout non invalida refresh token in blacklist (design B2B accettabile, refresh ha 7d).
- **CQ-017** `generateOrderNumber()` conta ordini anno → due POST concorrenti possono generare lo stesso `MFD-2024-0006`; aggiungere `@unique` su `Order.orderNumber`.
- **CQ-018** routing OK (pattern REST coerente).
- **CQ-019** import `path` non usato in `productController.js:2`.
- **CQ-020** `/account/export` non mostra conferma pre-download (design voluto — minore).

## Positive observations

- Middleware stack ben ordinato (rawBody webhook → HTTPS redirect → Helmet → json → CSRF → auth)
- Password policy 10+ char con upper/lower/digit
- Transazione Prisma su GDPR delete (`routes/account.js:135-151`)
- Prisma `$use` middleware per JSON features/images (workaround SQLite corretto)
- `logAudit` async non-blocking con try/catch
- REST pattern coerente
- Stripe webhook fail-close con metadata tracking
- `qStr()` helper in `productController` per normalizzare query
- GDPR soft-delete + export + diritto oblio

## Open questions

1. SQLite supporta `$transaction()` con isolamento pessimistico (read-lock) per stock? Probabilmente non con la precisione di Postgres — migrazione obbligatoria.
2. Quante email perse per `.catch(() => {})` silenzioso? Monitoring?
3. Admin panel ha test E2E su CRUD prodotti/ordini?
4. Se `Order.user` è `null` (user anonimizzato GDPR), il webhook Stripe resiste?
