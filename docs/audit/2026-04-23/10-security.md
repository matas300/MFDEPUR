# Audit Sicurezza — MFDEPUR Shop

**Sub-agent:** Explore (security) · **Risk score:** HIGH

> ⚠ **Caveat:** i riferimenti `file:line` provengono dal report sub-agent; alcuni possono avere lievi imprecisioni sulle line number e vanno verificati prima di applicare fix.

## Verdetto

Postura solida sul perimetro (CSRF double-submit, CSP con nonce per `scriptSrc`, Helmet, rate limit auth, webhook Stripe fail-close, bcryptjs cost 12, JWT access+refresh), **ma** permangono buchi critici su validazione input, autorizzazione di risorse (IDOR indirizzi), atomicità Stripe/stock, rate limit su checkout/GDPR, dipendenza Multer 1.x con CVE note, `unsafe-inline` su `styleSrc`, e logging senza redaction.

## Findings critici (azione immediata)

| ID | Severity | Area | Titolo | Location |
|---|---|---|---|---|
| SEC-004 | critical | rate-limit | Nessun rate limit su `POST /shop/checkout` | `shop/src/routes/shop.js:27` |
| SEC-005 | critical | rate-limit | Nessun rate limit su `POST /account/delete` (GDPR) | `shop/src/routes/account.js:112-164` |
| SEC-007 | critical | stripe | Race condition su `payment_intent.succeeded` — update non transazionale | `shop/src/controllers/orderController.js:160-174` |

**SEC-004/005** → wrap con `rateLimit({ windowMs: 60_000, max: 10 })` su checkout e `max: 3/h` su delete.
**SEC-007** → avvolgere lo `UPDATE` di `Order.status` + stock decrement in `prisma.$transaction([...])`; aggiungere unique constraint su `(paymentIntentId, status)` per idempotency.

## Findings high

| ID | Area | Titolo | Location |
|---|---|---|---|
| SEC-001 | validation | Nessuna validazione su `POST /account/profile` (firstName, lastName, phone) | `shop/src/routes/account.js:20-27` |
| SEC-002 | validation | Nessuna validazione su `POST /account/addresses` (street, CAP, province) | `shop/src/routes/account.js:38-55` |
| SEC-003 | validation | Admin product/category create/update: `parseInt/parseFloat` senza range, no check categoryId | `shop/src/controllers/productController.js:162-266` |
| SEC-006 | rate-limit | `/auth/login` 10 tent/15m = 960/giorno per IP — troppo permissivo | `shop/src/app.js:87` |
| SEC-008 | stripe | Server dovrebbe **sempre** ricalcolare totale dal carrello DB prima di creare `PaymentIntent`, mai fidarsi di body/metadata | `shop/src/controllers/orderController.js:41-120` |
| SEC-010 | authz | Ownership indirizzo non verificata in `POST /shop/checkout` — IDOR su `addressId` fra company | `shop/src/controllers/orderController.js:41-75` |
| SEC-013 | deps | `multer ^1.4.5-lts.1` ha CVE-2022-24434; 1.x LTS fuori manutenzione | `shop/package.json:26` |
| SEC-022 | authz | Admin product update non verifica existence (Prisma update su id inesistente è silent null/throw) | `shop/src/controllers/productController.js:181-187` |
| SEC-028 | authz | Admin order status change non valida enum né state machine (es. `DELIVERED`→`PENDING`) | `shop/src/controllers/adminController.js:226-250` |
| SEC-031 | validation | `minOrderQty/stock/lowStockAlert` possono essere negativi | `shop/src/controllers/productController.js:247-248` |

## Findings medium

| ID | Area | Titolo | Location |
|---|---|---|---|
| SEC-011 | upload | MIME validation basata su client; check magic-number OK ma estensione non whitelisted esplicitamente | `shop/src/controllers/adminController.js:345-374` |
| SEC-015 | headers | `styleSrc` con `'unsafe-inline'` (TODO noto) — 207 inline style sparsi nei template | `shop/src/app.js:62` |
| SEC-016 | logging | `console.error` log payload/err senza redaction di token/password/carta | `shop/src/app.js:132`, `orderController.js:143,156`, `utils/audit.js:22` |
| SEC-018 | csrf | Cookie CSRF `sameSite='lax'` — valutare `'strict'` | `shop/src/middleware/csrf.js:43-55` |
| SEC-021 | validation | Product `categoryId` non verificato che esista prima di create/update | `shop/src/controllers/productController.js:238-266` |
| SEC-025 | validation | `verifyEmail` token accettato senza validazione format (`/^[a-f0-9]{64}$/`) | `shop/src/controllers/authController.js:130-144` |
| SEC-027 | authz | Admin company status non validato contro enum `PENDING\|APPROVED\|REJECTED\|SUSPENDED` | `shop/src/controllers/adminController.js:291-316` |
| SEC-037 | logging | `logAudit` metadata non redacta password/token/carta prima del `JSON.stringify` | `shop/src/utils/audit.js:16` |
| SEC-040 | audit | Admin login non genera evento `AuditLog` | `shop/src/controllers/authController.js:71-79` |

## Findings low/info (selezione)

- **SEC-012** limite upload 5MB default, no min-size (0 byte accettato)
- **SEC-019** `JWT_EXPIRES_IN` default `'15m'` OK, aggiungere fail-fast se env non set
- **SEC-020** reset password token non è one-time-use (non marcato `used` dopo l'uso)
- **SEC-023** `sortOrder` categoria senza clamp (negativi o valori enormi)
- **SEC-024** `order.notes` senza max-length
- **SEC-026** `Company.notes` admin senza max-length
- **SEC-029** `trackingNumber` senza validazione format
- **SEC-030** `stripePublicKey` esposto in template (è corretto, è una chiave pubblica — aggiungere commento)
- **SEC-034** cancellazione account: transazione ok ma error handling migliorabile
- **SEC-039** duplicato `vatNumber` prevenuto in register ma servirebbe enforce anche in update

## Positive observations

- CSRF double-submit con `csrf-csrf`, token per-GET, escluso dal webhook Stripe
- Webhook Stripe fail-close su secret/rawBody/firma (commit `60ad629`)
- CSP nonce-based su `scriptSrc`, no `unsafe-inline` (commit `79ca025`)
- Password policy: min 10 char, upper/lower/digit (`express-validator` in `auth.js`)
- `bcryptjs.hash(password, 12)` — cost adeguato
- Email/reset token con 32-byte hex entropy + expiry in DB
- GDPR: export JSON + soft-delete anonimizzazione + session invalidation
- Upload: magic-number detection + `memoryStorage` + filename `crypto.randomBytes`
- RBAC: `requireAdmin`, `requireApprovedCompany`
- Access 15m + refresh 7d con `httpOnly` + `sameSite='strict'` sul refresh
- `AuditLog` con IP/UA tracking

## Open questions (da chiarire con product owner)

1. Numero massimo di session concorrenti per utente?
2. Schema `Order` include campi `refundAmount/refundAt/reason`?
3. Stato dopo admin cancel di un ordine `SHIPPED`: soft-delete o reversal?
4. Rate limit `/auth/forgot-password` è per-IP o per-email? (per-IP è bypassabile con VPN)
5. Metodo = POST-only su webhook Stripe? (method confusion mitigation)
6. CSV export admin: BOM UTF-8 è testato su Excel Win/Mac?
