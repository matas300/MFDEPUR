# MFDEPUR — Master Document Audit & Roadmap

**Data audit:** 2026-04-23
**Commit di partenza:** `6fbd3f0`
**Auditor:** Claude Opus 4.7 (orchestrator) + 5 sub-agent Explore paralleli
**Perimetro:** `shop/` (tutto il resto — `index.html` root, `assets/`, `New Sites/` — è legacy statico e fuori scope)

---

## Executive summary

La codebase **`shop/`** ha fondamenta architettoniche solide (MVC + Prisma, middleware di sicurezza ben posizionati, webhook Stripe fail-close, CSRF double-submit, CSP con nonce) ma **NON è pronta per la produzione B2B italiana**. Tre famiglie di blocker:

1. **Compliance fiscale IT** — FatturaPA/SDI completamente assente, IVA hardcoded 22%, calcoli monetari con `Number` invece di `Decimal`, numerazione ordini non conforme a ISO 11582.
2. **Stabilità runtime & operazioni** — SQLite non scalabile, nessuna migration history, `SIGTERM` ignorato, race condition su stock+ordine+webhook, test suite assente, nessun CI/CD, nessun health check, logging unstructured.
3. **Buchi di validazione & autorizzazione** — input senza `express-validator` in metà delle route applicative, IDOR su `addressId` al checkout, rate limit mancante su endpoint critici (checkout, delete account), webhook Stripe che aggiorna stato senza transazione.

~125 findings totali (9 critical, 28 high, ~42 medium, ~46 low/info).

**Raccomandazione:** non andare in produzione prima del completamento di **M1 + M2 + M3 + M4** (test). M0 è quick-win preliminare, M5/M6/M7 sono miglioramenti post go-live.

### Gate di go-live (condizioni necessarie e sufficienti)

- [ ] Tutti i task `[BLOCKER]` completati e dimostrabili con test automatizzati
- [ ] Backup DB testato con restore completo su staging
- [ ] Deploy-to-staging passato da CI con test + lint verdi
- [ ] Fatturazione elettronica SDI testata su ambiente di test Agenzia Entrate / SaaS provider
- [ ] Stress test checkout 50 concurrent senza race, senza 5xx, senza duplicati

---

## Indice milestone

| # | Milestone | Stima | Gate go-live | Parallelizzabile |
|---|---|---|---|---|
| M0 | Quick wins & safety net | 1–2 gg | no | seq |
| M1 | Stability & concurrency | 3–5 gg | ✅ **blocker** | no |
| M2 | Fiscal compliance IT | 5–10 gg | ✅ **blocker** | con M3 |
| M3 | Production readiness (DB + ops) | 5–7 gg | ✅ **blocker** | con M2 |
| M4 | Test & code quality | 5 gg (parallela a M1/M2/M3) | ✅ **blocker** | sì |
| M5 | UI/UX hardening | 3–5 gg | no (post go-live) | sì |
| M6 | Admin & business completeness | 5–7 gg | no | sì |
| M7 | Advanced hardening | 3 gg | no (opzionale) | sì |

Totale minimo per go-live: **~3 settimane-uomo** concentrate (M0+M1+M2+M3+M4), a condizione che M2 abbia decisione rapida sul provider SDI.

---

## M0 — Quick wins & safety net

**Obiettivo:** eliminare regressioni imminenti e aggiungere rete di sicurezza con interventi piccoli ad alto ROI, prima di toccare le cose grosse.

### Task

| ID | Task | Azione | Criterio accettazione | Ref finding |
|---|---|---|---|---|
| M0-T1 | Rimuovere fallback `ADMIN_PASSWORD` | In `prisma/seed.js:11` sostituire `|| 'CambiaSubito!123'` con `|| (() => { throw new Error('ADMIN_PASSWORD obbligatorio') })()` | `node prisma/seed.js` senza env → crash con messaggio chiaro | PROD-005 |
| M0-T2 | Guard `seed.js` contro prod | Prima riga: `if (process.env.NODE_ENV === 'production') { throw new Error('seed non eseguibile in prod') }` | Test: `NODE_ENV=production node prisma/seed.js` → crash | PROD-023 |
| M0-T3 | `engines.node` in `package.json` | Aggiungere `"engines": { "node": ">=18.17.0" }` + `.nvmrc` con `18.17.0` | `npm install` su Node 16 fallisce con warning | PROD-013 |
| M0-T4 | Fail-fast su env critiche | In `config/env.js` (nuovo) validare all'avvio: `JWT_SECRET`, `JWT_REFRESH_SECRET`, `CSRF_SECRET` (min 32 char), `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`. Importato come prima riga in `server.js`. | Avvio senza env → `process.exit(1)` con messaggio che elenca le mancanti | PROD-015/017 |
| M0-T5 | `.env.example` completo e committato | Listare tutte le 20 env vars del progetto con placeholder sicuri e commento "generato con `openssl rand -hex 32`" dove pertinente | Diff `grep 'process.env' shop/src shop/server.js` vs `.env.example` → nessun mancante | PROD-007 |
| M0-T6 | Rate limit `POST /shop/checkout` | Aggiungere `rateLimit({ windowMs: 60_000, max: 10, keyGenerator: req => req.user?.id \|\| req.ip })` | Test: 11° request in 60s → 429 | SEC-004 |
| M0-T7 | Rate limit `POST /account/delete` | `rateLimit({ windowMs: 60*60_000, max: 3, keyGenerator: req => req.user.id })` | Test: 4° tentativo in 1h → 429 | SEC-005 |
| M0-T8 | Validation `POST /account/profile` | `express-validator`: `body('firstName').trim().isLength({min:1,max:100})`, idem `lastName`; `body('phone').optional().isLength({max:30})`; restituire 422 con mappa errori | Test: body vuoto / stringhe > 100 char → 422 | SEC-001 |
| M0-T9 | Validation `POST /account/addresses` | `body('street').trim().isLength({min:1,max:200})`, `body('postalCode').matches(/^\d{5}$/)`, `body('province').matches(/^[A-Z]{2}$/)`, `body('city').trim().isLength({min:1,max:100})`, `body('country').isLength({min:2,max:2})` | Test: CAP `abc` → 422 | SEC-002 |
| M0-T10 | Verifica ownership `addressId` al checkout | In `orderController.postCheckout`: `const addr = await prisma.address.findFirst({ where: { id: addressId, companyId: req.user.companyId } }); if (!addr) throw 403` | Test: utente di company A invia `addressId` di company B → 403 | SEC-010 |
| M0-T11 | Rimuovere import `path` non usato | `shop/src/controllers/productController.js:2` | `grep -n "require('path')" shop/src/controllers/productController.js` → vuoto | CQ-019 |
| M0-T12 | Centralizzare `TAX_RATE` | Creare `src/config/constants.js` con `TAX_RATE = 0.22`; sostituire 4 occorrenze. Marcare `// TODO M2: per-product taxRate` | `grep '0.22' src/` → solo in `constants.js` | CQ-007 |
| M0-T13 | Estendere rate limit a `/shop/cart/*` | `rateLimit({ windowMs: 60_000, max: 60, keyGenerator: req => req.user?.id \|\| req.ip })` su tutte le cart routes | 61° add in 60s → 429 | SHOP-017 |
| M0-T14 | Clamp numerici su admin product form | `minOrderQty: Math.max(1, parseInt(b.minOrderQty)\|\|1)`, `stock: Math.max(0, ...)`, `lowStockAlert: Math.max(0, ...)`, `sortOrder: Math.max(0, Math.min(10000, ...))` | Test: body negativo → valore normalizzato ≥ 0 | SEC-031, SEC-023 |
| M0-T15 | Validation state machine su `Order.status` (admin) | Array `ORDER_STATUSES` in constants.js + transizioni permesse `{PENDING:['CONFIRMED','CANCELLED'],CONFIRMED:['PROCESSING','CANCELLED'],...}`; 400 se transizione invalida | Test: tentare `DELIVERED→PENDING` → 400 | SEC-028 |
| M0-T16 | Validation enum su `Company.status` (admin) | Check contro `['PENDING','APPROVED','REJECTED','SUSPENDED']` prima di update | Test: status arbitrario → 400 | SEC-027 |
| M0-T17 | Max-length su campi free-text | `notes` ordine (1000), `Company.notes` admin (2000), `Order.trackingNumber` (100) | Test: input 2000 char → tronco o 422 | SEC-024/026/029 |
| M0-T18 | Verifica existence `categoryId` su product | Prima di create/update: `if (categoryId) { const c = await prisma.category.findUnique(...); if (!c) throw 400 }` | Test: `categoryId` inesistente → 400 | SEC-021 |
| M0-T19 | Prisma `@unique` su `Order.orderNumber` | Schema Prisma + migration | `npx prisma migrate dev` OK; `INSERT` duplicato fallisce | CQ-017 |
| M0-T20 | Stripe: log `invalid-signature` in `AuditLog` | Sostituire `console.warn` con `await logAudit(req, { action: 'STRIPE_WEBHOOK_INVALID_SIG', entityType: 'Webhook', metadata: { err: err.message } })` | Webhook con firma invalida → riga in `AuditLog` | CQ-014 |

**Dipendenze M0:** nessuna. Eseguibile subito.

---

## M1 — Stability & concurrency

**Obiettivo:** rendere il runtime robusto a concorrenza, shutdown, failure transienti. Blocker go-live.

### Task

| ID | Task | Azione | Criterio accettazione | Ref finding |
|---|---|---|---|---|
| M1-T1 | `asyncHandler` wrapper per controller | Creare `src/utils/asyncHandler.js`: `module.exports = fn => (req,res,next) => Promise.resolve(fn(req,res,next)).catch(next);`. Wrappare tutti i controller async. In alternativa: migrazione a Express 5. | Test: controller che fa `throw` → error handler centrale → 500 con JSON/EJS (non hang) | CQ-002 |
| M1-T2 | Graceful shutdown SIGTERM/SIGINT + `server.close()` | Refactor `server.js`: memorizzare `server = app.listen(...)`, handler comune `shutdown(signal)` con `server.close() → prisma.$disconnect() → process.exit(0)`, timeout 30s `setTimeout(() => process.exit(1), 30_000).unref()`. Gestire sia `SIGTERM` che `SIGINT`. | Test: `kill -TERM $PID` → log "graceful"; nuove connessioni rifiutate; connessioni in-flight completate entro 30s | CQ-003, PROD-003 |
| M1-T3 | `unhandledRejection`/`uncaughtException` → shutdown | Trasformare in: log strutturato + chiamata `shutdown('FATAL')` invece di solo log | Test: `throw` in un setTimeout → log + terminazione | PROD-019 |
| M1-T4 | Transazione Prisma stock+ordine | In `orderController._finalizeOrder`: avvolgere in `prisma.$transaction(async tx => { ...recalc subtotal da DB... ; update Order status; decrement stock; create OrderItems })`. Ricalcolo totale server-side prima del commit. | Test: 2 checkout concorrenti sull'ultima unità → 1 successo, 1 fallito con 409 | SHOP-004, CQ-001, SEC-007, SHOP-010 |
| M1-T5 | Idempotency key su checkout | Aggiungere `idempotencyKey` (UUID generato dal client o da token CSRF) salvato temporaneamente; rifiutare request con stessa key in finestra 5 min. Usare anche `idempotencyKey` Stripe. | Test: doppio submit entro 5 min → secondo è no-op (200 con stesso orderId) | SHOP-005 |
| M1-T6 | Atomicità `Address.isDefault` | `POST/PATCH /account/addresses` in `$transaction`: `updateMany({ where:{companyId, isDefault:true}, data:{isDefault:false} })` + `create/update({isDefault:true})` | Test: 2 create concorrenti con `isDefault:true` → solo uno finale è default | CQ-011 |
| M1-T7 | Email failure logging + retry path | Sostituire `.catch(() => {})` con `.catch(err => log.error({err, to, subject}, 'email send failed'))`; aggiungere tabella `EmailQueue` con retry cron (o BullMQ in M7) | Test: SMTP down → riga nel log; eventualmente riga `EmailQueue` con status `failed` | CQ-005 |
| M1-T8 | Integrazione Sentry | `npm i @sentry/node`; init in `server.js` prima di `app.listen`, DSN da env `SENTRY_DSN` (optional); middleware prima error handler | Test: `throw` in controller → evento visibile in Sentry staging | PROD-014 |
| M1-T9 | Fail-close JWT_EXPIRES_IN senza default nascosti | Rendere `JWT_EXPIRES_IN`/`JWT_REFRESH_EXPIRES_IN` obbligatorie in `config/env.js` (M0-T4) | Avvio senza env → crash | SEC-019 |
| M1-T10 | Stripe webhook retry/queue (base) | Se update fallisce dopo 2 retry in-request, loggare + ritornare 500 (Stripe riprova). Opzionale evoluzione in M7 con BullMQ. | Test: simulare DB down → webhook 500 → Stripe retries → riuscita | SHOP-019 |

**Dipendenze:** M0-T1..T20 (preferibile).

---

## M2 — Fiscal compliance IT (B2B)

**Obiettivo:** rendere l'app **vendibile legalmente** a imprese italiane. Blocker go-live.

> **Decisione strategica richiesta al product owner prima di iniziare:**
> - **SDI integration mode:** (a) SaaS (FattureInCloud, Aruba Fatturazione, Fiscozen, Register.it) con API, oppure (b) generazione XML in-house + invio PEC, oppure (c) canale diretto SDI (complesso, richiede certificati).
> - **Clienti PA previsti?** → se sì, split payment (art.17-ter) + CUP/CIG.
> - **Clienti UE intra-EU previsti?** → se sì, reverse charge + esenzione IVA.
> - **Aliquote IVA da supportare:** solo 22% o anche 10%/5%/4%?

### Task (ordine consigliato di esecuzione)

| ID | Task | Azione | Criterio accettazione | Ref finding |
|---|---|---|---|---|
| M2-T1 | Decimal.js lato server | `npm i decimal.js`. Refactor `cartController` + `orderController` + `adminController.exportCsv`: tutti i calcoli (subtotale, tax, shipping, total) via `Decimal`, convertiti a `Prisma.Decimal` solo alla persistenza. Eliminare calcoli in `public/js/shop.js` per totali ufficiali (lato client solo visualizzazione). Arrotondamento commerciale a 2 decimali: `.toDecimalPlaces(2, Decimal.ROUND_HALF_UP)`. | Test: ordine con `unitPrice=0.10 × qty=3` → total `0.30` esatto (non `0.30000000000000004`); ricalcolo server ignora body | SHOP-003, SHOP-010 |
| M2-T2 | `taxRate` per-product (opzionale multi-aliquota) | Aggiungere `Product.taxRate Decimal @default(0.22)` allo schema. Calcolo ordine: per-item `line.taxAmount = line.subtotal × item.taxRate`. `Order.taxRate` diventa informativo (aliquota aggregata) o si rimuove. Supportare aliquote 4/5/10/22. | Test: ordine con mix 10% e 22% → taxAmount corretto per item, total aggregato corretto | SHOP-002 |
| M2-T3 | Reverse charge & esenzione (se serve) | Flag `Company.vatRegime` (`NORMAL`, `REVERSE_CHARGE_EU`, `EXPORT_EXEMPT`, `PA_SPLIT`); calcolo: se `REVERSE_CHARGE_EU` → `taxAmount=0` + marcatura fattura `N6.x`; se `PA_SPLIT` → IVA scissa; se `EXPORT_EXEMPT` → `N3.x`. | Test: company con `REVERSE_CHARGE_EU` → ordine con `taxAmount=0` e causale in XML | SHOP-002 |
| M2-T4 | Modello `Invoice` separato da `Order` | Nuovo schema Prisma: `Invoice { id, invoiceNumber (per-anno, unique), year, orderId (unique FK), pdfUrl, xmlUrl, sdiId?, sdiStatus?, issuedAt, revokedAt? }`. | Migration OK; `@@unique(invoiceNumber, year)` | SHOP-011 |
| M2-T5 | Sequenza progressiva fatture per anno | Query transazionale: `const n = (await tx.invoice.count({ where: { year } })) + 1; create({ invoiceNumber: n, year })`; lock in `$transaction`. | Test: 100 create concorrenti → 1..100 senza duplicati, senza gap | SHOP-011 |
| M2-T6 | Salvataggio nuovo indirizzo al checkout | Se `addressId` non è fornito ma body contiene `street/city/...`: creare `Address` nella stessa transazione dell'ordine (ownership = `req.user.companyId`). | Test: checkout con nuovo indirizzo → `Address` creato + `Order.addressId` valorizzato | SHOP-007 |
| M2-T7 | Workflow bonifico: `PENDING` finché admin conferma | `paymentMethod='BANK_TRANSFER'` → order rimane `PENDING`. Email cliente con dati IBAN. Admin UI: azione "Segna come pagato" → `CONFIRMED` + `paidAt=now()` + `AuditLog('ORDER_BANK_PAID')`. | Test: checkout bonifico → status `PENDING` + email con IBAN; admin-click → `CONFIRMED` | SHOP-009 |
| M2-T8 | Generazione PDF fattura | Libreria: `pdfmake` o `puppeteer` (server-side). Template: intestazione fornitore, cliente (nome, P.IVA, CF, SDI, PEC, indirizzo), righe ordine, totali, IVA, causali, firma. PDF salvato in `shop/invoices/YYYY/` (nuova cartella, gitignored) o su S3. | Test: `invoiceController.generatePdf(orderId)` → PDF scaricabile valido | SHOP-001 |
| M2-T9 | Generazione XML FatturaPA | Implementare (o integrare) generatore XML v1.2.2 ufficiale SDI (FPR12 per privati, FPA12 per PA). Campi: `FatturaElettronicaHeader` (Trasmittente, CessionarioCommittente con `SDI`/`PEC`), `FatturaElettronicaBody` (DatiGenerali, DatiBeni, DatiPagamento). Validazione contro XSD ufficiale Agenzia Entrate. | Test: XML generato passa validazione XSD ufficiale | SHOP-001, SHOP-013 |
| M2-T10 | Firma digitale XML (CAdES/XAdES) | Se invio diretto SDI: firma `.p7m` con certificato digitale intestato a MF Depur. Se SaaS: il provider firma, non serve. | Dipende da M2-T11 scelta provider | SHOP-001 |
| M2-T11 | Invio SDI | Due opzioni:<br>**A)** SaaS (raccomandato): API provider (es. FattureInCloud/Aruba) → POST XML, ricezione `sdiId` + stato.<br>**B)** PEC: invio email a `sdi01@pec.fatturapa.it` con XML firmato allegato, parsing ricevuta. | Test: fattura reale inviata su ambiente test SDI (o sandbox provider); `sdiStatus='ACCEPTED'` | SHOP-001 |
| M2-T12 | Invio fattura al cliente | Email automatica post `sdiStatus='DELIVERED'` con PDF allegato + link download account | Test: ordine completato → cliente riceve email con PDF; `/account/invoices` elenca fatture | SHOP-001 |
| M2-T13 | Blocco hard-delete fatture < 10 anni | In `routes/account.js` GDPR delete: `if (invoices.some(i => daysSince(i.issuedAt) < 10*365)) → soft delete + mantieni Invoice`. Anonimizzare User ma non Invoice. | Test: delete account con fattura di 1 anno fa → user anonimizzato, invoice conservata | SHOP-014 |
| M2-T14 | Shipping zones (minima) | Nuovo schema `ShippingRate { id, country, province?, minWeightKg?, maxWeightKg?, rate Decimal }`. Controller: al checkout calcola shipping dalla rate matrix. Admin UI per gestire rate. | Test: ordine da provincia X → shipping calcolato; ordine estero → rate diverso | SHOP-015 |
| M2-T15 | UI admin audit log (fatture + ordini) | Pagina `/admin/audit-log` con filtri (action, entity, date, user), export CSV. Viewer paginato. | Test: admin naviga audit log, filtra su `ORDER_STATUS_CHANGE` → lista filtrata | SHOP-020 |

**Dipendenze:** M0; M1-T4 (transazione ordine) deve precedere M2-T5; decisione provider SDI.

---

## M3 — Production readiness (DB + ops)

**Obiettivo:** infrastruttura di base per girare in produzione Hostinger. Blocker go-live.

### Task

| ID | Task | Azione | Criterio accettazione | Ref finding |
|---|---|---|---|---|
| M3-T1 | Migrazione SQLite → PostgreSQL | Aggiornare `schema.prisma` datasource a `postgresql`. Rimuovere middleware `$use` custom JSON (`config/database.js`) e migrare `Product.features`/`images` a campi `Json` nativi. Creare DB Postgres (managed, es. Aiven/Neon/Supabase/Railway o VPS Hostinger). Migrare dati dev se rilevanti. | Test: `npm run db:migrate` su Postgres staging → schema applicato; app funziona end-to-end | PROD-001, PROD-018 |
| M3-T2 | Migration history Prisma | `npx prisma migrate dev --name init` per generare baseline; commit della dir `prisma/migrations/`. Aggiungere `prisma migrate deploy` al deploy script. | `ls prisma/migrations/` → ≥1 migration; `prisma migrate status` pulito | PROD-002 |
| M3-T3 | Structured logging (pino) + morgan | `npm i pino pino-http morgan`. Sostituire `console.log/error` con `log.info/error` (pino JSON). `morgan('combined', { stream: pinoStream })` per HTTP log. Correlation-id middleware (`req.id = crypto.randomUUID()`). | Test: log prod → JSON con `req.id`, `level`, `msg`, `time`; un errore genera evento tracciabile | PROD-006 |
| M3-T4 | Health check endpoint | `GET /health` (pubblico): check Prisma `SELECT 1`, memory OK → 200 `{status:'ok',db:'ok'}`; altrimenti 503. `GET /healthz` identico ma senza DB (solo liveness). | Test: `curl /health` durante DB down → 503 | PROD-012 |
| M3-T5 | Compression middleware | `npm i compression`; montare `app.use(compression())` prima dello static. | Test: `curl -H 'Accept-Encoding: gzip' /shop` → header `Content-Encoding: gzip` | PROD-011 |
| M3-T6 | Backup strategy documentata + automatica | Cron su VPS (o serverless) che esegue `pg_dump` notte → upload S3/B2 con retention 30gg. Script `scripts/backup.sh` committato. Documentare restore in `docs/DEPLOYMENT.md`. | Test: restore su staging da backup recente → DB integro | PROD-010 |
| M3-T7 | Dockerfile + `.dockerignore` | `Dockerfile` multi-stage: build dep → copy src → `CMD ["node","server.js"]`. Base: `node:20-alpine`. `.dockerignore` esclude `node_modules`, `.env`, `.git`, `uploads`, `dev.db*`. | Test: `docker build . && docker run -p 3000:3000 --env-file .env` → app risponde | PROD-024 |
| M3-T8 | CI/CD pipeline (GitHub Actions) | `.github/workflows/ci.yml`: job su PR e push → install, lint, test, build. `.github/workflows/deploy.yml`: su tag `v*.*.*` deploy via SSH (Hostinger) o container push. | Test: PR con test fallito → merge bloccato; tag → deploy automatico | PROD-009 |
| M3-T9 | `README.md` + `docs/DEPLOYMENT.md` | Root `README.md`: setup, dev, test, deploy short. `docs/DEPLOYMENT.md`: runbook step-by-step per Hostinger (SSH, env, migrate, PM2/systemd, health check, rollback, backup restore). | Un nuovo dev segue README e ha app girante in dev in <15min | PROD-021/022 |
| M3-T10 | PM2 / systemd config | File `ecosystem.config.js` (PM2) o `.service` (systemd) con autostart, restart on crash, log rotation. | Test: kill app → PM2 la rilancia entro 5s | PROD-003 (sinergia) |
| M3-T11 | Cookie `Secure` flag in prod | Verificare tutti i cookie (CSRF, JWT access, JWT refresh) con `secure: IS_PROD` già impostato. Aggiungere test. | Test integration: in prod mode, `Set-Cookie` contiene `Secure` | — |
| M3-T12 | Prisma logging warn in prod | `new PrismaClient({ log: ['warn','error'] })` in prod (non solo `error`) | Log prod include warning Prisma | PROD-020 |
| M3-T13 | `compression` ok anche con webhook raw | Verificare che `compression()` NON comprima `/stripe/webhook` (montato prima del middleware) — già così per ordine, ma aggiungere test | Test: webhook riceve body raw non compresso | — |

**Dipendenze:** M0, ideale M1 completa. M3-T1 (Postgres) è prerequisito per M2-T5 (sequence atomica). M3-T7/T8 dipendono da M4 (test).

---

## M4 — Test & code quality (parallela a M1/M2/M3)

**Obiettivo:** rendere il codice verificabile e la pipeline bloccante. Blocker go-live (senza test non si deploya).

### Task

| ID | Task | Azione | Criterio accettazione | Ref finding |
|---|---|---|---|---|
| M4-T1 | ESLint + Prettier | `npm i -D eslint @eslint/js prettier eslint-config-prettier`. Config `eslint.config.js` con regole Node + security (no-console limitato, no-eval, etc.). Script `npm run lint`. | `npm run lint` passa; regola `no-unused-vars` rileva l'import `path` non usato | PROD-004 |
| M4-T2 | Vitest setup | `npm i -D vitest @vitest/coverage-v8 supertest`. `vitest.config.js`. Script `npm test` / `npm run test:cov`. | `npm test` passa su suite vuota | PROD-004 |
| M4-T3 | Test unitari controller | Test su `generateOrderNumber`, calcoli Decimal, state machine status, validation clamps | >70% coverage su `src/controllers/` | — |
| M4-T4 | Test integration auth | Supertest su register → verify email → login → refresh → logout → reset password. Mockare nodemailer. | Tutti verdi | — |
| M4-T5 | Test integration checkout | Seed DB test, simulare carrello → checkout → stub Stripe PaymentIntent → webhook → verifica stato DB. Includere race condition test (2 checkout sull'ultima unità). | Tutti verdi; race test dimostra vincitore unico | M1-T4 |
| M4-T6 | Test integration RBAC/IDOR | Utente company A prova ad usare addressId di company B → 403 | Verde | SEC-010 |
| M4-T7 | E2E Playwright (golden path B2B) | Registra company → admin approve (API) → login → aggiungi prodotti → checkout bonifico → admin segna pagato → download fattura. Un solo flow, robusto. | CI verde end-to-end | — |
| M4-T8 | CI gate test+lint | `ci.yml` blocca merge se `lint`/`test`/`build` falliscono | PR con test rotto → check rosso | M3-T8 |

**Dipendenze:** può iniziare subito; parti sostanziali (M4-T5) dipendono da M1-T4.

---

## M5 — UI/UX hardening (post go-live o in parallelo)

**Obiettivo:** ridurre superficie XSS residua, migliorare a11y, piccole feature UX.

### Task

| ID | Task | Azione | Criterio accettazione | Ref finding |
|---|---|---|---|---|
| M5-T1 | Refactor 207 inline style | Sostituire inline `style="..."` con classi CSS utility (`.mt-1`, `.text-muted`, ecc.) o nonce per gli style dinamici residui. | `grep -r 'style="' shop/views/` → 0 (o <10 giustificati con nonce) | CSP-001 |
| M5-T2 | Rimuovere `'unsafe-inline'` da `styleSrc` | Helmet CSP: `styleSrc: ["'self'", (req,res) => \`'nonce-${res.locals.cspNonce}'\`, ...]` | App funziona sotto CSP hardened | SEC-015, SHOP-016 |
| M5-T3 | `scope` su `<th>` tabelle | Tutte le tabelle `<th scope="col">` / `scope="row"` dove applicabile | Audit axe-core → 0 violazioni scope | A11Y-001 |
| M5-T4 | `loading="lazy"` esteso | Tutte le `<img>` in cart, order-detail, admin-list | `grep 'loading="lazy"'` su tutte le `<img>` product | UX-001 |
| M5-T5 | `aria-describedby` su errori form | In register/login/checkout: `<input aria-describedby="pw-error"> <small id="pw-error">...</small>` | Screen reader annuncia errore linkato | A11Y-002 |
| M5-T6 | `Intl.NumberFormat('it-IT')` su prezzi | Helper `formatEuro(n)` usato ovunque (view + JS client) | `€ 1.234,56` in UI | I18N-001 |
| M5-T7 | `inputmode` su email/tel | `<input type="email" inputmode="email">`, `<input type="tel" inputmode="tel">` | Mobile mostra tastiera corretta | FORMS-001 |
| M5-T8 | Confirm dialog su azioni distruttive | `data-confirm` consistente su delete address, cancel order, delete account | Test: click senza JS mostra conferma | UX-002 |
| M5-T9 | `robots.txt` | Creare `shop/public/robots.txt` con `Sitemap: /sitemap.xml` + `Disallow: /account /admin` | `curl /robots.txt` → 200 | SEO-001 |
| M5-T10 | Error ID tracking pagina 500 | `errorId = req.id` (da M3-T3) visibile in pagina errore | User vede ID; admin può cercarlo in log | ERROR-001 |
| M5-T11 | Hint 3DS su checkout | Small sotto pulsante pagamento: "Potrebbe essere richiesta autenticazione 3D Secure (SMS/app)" | Presente in `checkout.ejs` | CHECKOUT-001 |
| M5-T12 | `minOrderQty` enfatizzato in catalog | Badge visibile sulla card prodotto se `minOrderQty > 1` | Badge presente | UX-003 |
| M5-T13 | Guest cart fallback su localStorage corrotto | `try { JSON.parse(ls) } catch { ls.clear(); toast.error('Carrello resettato') }` | Test: localStorage con JSON invalid → toast + clear | CART-001 |

**Dipendenze:** può partire dopo M0.

---

## M6 — Admin & business completeness (post go-live)

| ID | Task | Azione | Criterio accettazione | Ref finding |
|---|---|---|---|---|
| M6-T1 | Multi-user company con ruoli | Aggiungere `User.companyRole` (`COMPANY_ADMIN`, `BUYER`, `VIEWER`); enforce su routes (`BUYER` non può modificare indirizzi company, `VIEWER` non può ordinare). | Test RBAC per ciascun ruolo | SHOP-018 |
| M6-T2 | Approval workflow ordini interno company | Flag opzionale su Company: `requiresOrderApproval`. Se true: ordini in `AWAITING_APPROVAL` finché `COMPANY_ADMIN` approva. | Test: BUYER crea ordine → stato intermedio → ADMIN approve → flow normale | SHOP-018 |
| M6-T3 | Export bulk ordini + fatture | `/admin/export` ZIP con CSV ordini + PDF fatture (periodo filtrabile) | Admin scarica ZIP con 100 ordini + fatture | — |
| M6-T4 | Tracking carrier integrazione | API DHL/GLS/SDA per tracking automatico post-spedizione; link in email cliente | Admin inserisce tracking → cliente riceve link funzionante | SHOP-015 |
| M6-T5 | Admin account dashboard overview | Card statistiche base (ordini oggi, ricavo mese, nuove company pending) | Dashboard mostra dati reali | ACCOUNT-001, ADMIN-001 |

---

## M7 — Advanced hardening (opzionale)

| ID | Task | Azione | Criterio accettazione | Ref finding |
|---|---|---|---|---|
| M7-T1 | BullMQ + Redis queue per email/webhook | Job queue persistente con retry exponential | Test: SMTP down → email in retry, eventualmente delivered | CQ-005, SHOP-019 |
| M7-T2 | 2FA TOTP per admin | `otplib` + enrollment; login admin richiede TOTP | Admin login senza TOTP → rifiutato | — |
| M7-T3 | Session blacklist (logout immediato) | Table `RevokedToken` + check in `injectUser` | Logout → token access usato dopo → 401 | CQ-016 |
| M7-T4 | Upgrade a `bcrypt` nativo (o argon2) | Eventuale se performance register/reset rilevante | Benchmark > 2x faster | SEC-014 |
| M7-T5 | Upgrade multer 1.x → 2.x o alternativa | Valutare `@fastify/multipart`/`busboy` puro | Nessuna CVE in lock | SEC-013 |
| M7-T6 | `sameSite='strict'` su cookie CSRF | Testare compatibilità flows; valutare impact UX su click da email | Cookie CSRF con Strict, login flow ok | SEC-018 |
| M7-T7 | WAF / CDN (Cloudflare) | DDoS + caching statici | — | — |
| M7-T8 | Load test k6 sul checkout | 50 concurrent, 5 min → 0 5xx, p95 < 500ms | Report k6 verde | — |
| M7-T9 | Reset password token one-time-use | Colonna `usedAt` + check | Token riusato → 400 | SEC-020 |

---

## Gantt indicativo (consigliato)

```
Week 1  : M0 (quick wins)  ────────────
Week 1-2: M1 (stability)       ──────────
Week 2-4: M2 (fiscal IT)          ────────────
Week 2-3: M3 (prod ready)         ──────────
Week 2-3: M4 (test/CI)            ──────────   (parallela)
Week 4  : STAGING test + load test   ───
Week 5  : Go-live + monitoring       ──
Post    : M5 → M6 → M7              ─ ─ ─
```

Minimo 4-5 settimane uomo con 1 dev full-time (più tempo calendario per attese SDI provider).

---

## Note operative

- **Ogni task → un branch** (`feat/M1-T4-stock-transaction`), una PR, CI verde prima del merge.
- **AuditLog su ogni task sensibile** (status change ordine, delete account, invio fattura).
- **Non inline JS** (CSP già nonce-aware, regola esplicita progetto).
- **Testi UI in italiano**, coerenti.
- **Secret rotation:** documentare in `docs/DEPLOYMENT.md` la procedura.
- **Hostinger:** verificare che supporti Node 20 LTS + PostgreSQL (o DB managed esterno).

## Come usare questo documento

- `docs/audit/2026-04-23/10-security.md` — dettaglio findings sicurezza (usato da M0-T6..T10, M1-T1, M7)
- `docs/audit/2026-04-23/11-eshop-fiscal.md` — dettaglio fiscal/business (usato da M2 quasi interamente)
- `docs/audit/2026-04-23/12-code-quality.md` — dettaglio stabilità (M1, M4)
- `docs/audit/2026-04-23/13-ui-ux-perf.md` — dettaglio UI/UX (M5)
- `docs/audit/2026-04-23/14-production-ready.md` — dettaglio SRE (M3)

Ogni task di questo master contiene il campo **Ref finding** che rimanda alla riga specifica dei report di area per il contesto completo.

## Open decisions pending (product owner)

1. **Provider SDI** (M2-T11)
2. **Aliquote IVA** supportate (M2-T2)
3. **Reverse charge UE / export esenzione** (M2-T3)
4. **Split payment PA** (se clienti PA)
5. **Multi-user company roles** (M6-T1)
6. **Shipping zones** tariffario (M2-T14)
7. **Archivio fatture** (filesystem VPS vs S3/B2 vs SaaS)
8. **Hostinger vs. alternative** (VPS, Node managed, DB managed)
9. **Monitoring budget** (Sentry free tier OK o paid?)
10. **RTO/RPO SLA** per il DR
