# M6 — Admin & Business Completeness (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development`. Un task → un commit. Branch: `feat/M6-admin-business` (già creato).

**Goal:** chiudere i gap admin/business: RBAC company, approval workflow ordini interno, tracking carrier completo, dashboard stats arricchita. CSV bulk export è già implementato (`/admin/orders/export.csv`) → escluso dal plan.

**Tech stack:** invariato (Express/Prisma/EJS). Nessuna nuova dipendenza.

**Strategia:** Wave 1 sequenziale (schema/migration/foundation) → Wave 2 due batch in parallelo (α approval, β tracking+dashboard) → Wave 3 regression test + merge. Ogni task è un commit. Audit log su ogni mutazione sensibile.

---

## Stato attuale (verificato 2026-04-29)

| Item M6 | Esiste | Da fare |
|---|---|---|
| `User.companyRole` | ❌ | sì |
| `Company.requiresOrderApproval` | ❌ | sì |
| stato `AWAITING_APPROVAL` in `ORDER_STATUSES`/`ORDER_STATUS_TRANSITIONS` | ❌ | sì |
| `requireCompanyRole()` middleware | ❌ | sì |
| `Order.trackingNumber` | ✅ | (riuso) |
| `Order.trackingCarrier`, `Order.trackingUrl` | ❌ | sì |
| `/admin/orders/export.csv` con filtri data | ✅ | (T3 chiuso) |
| Dashboard chart 30gg + ricavo mese + pending companies | ✅ | aggiungere card oggi/settimana + AWAITING_APPROVAL count |

---

## File structure

| File | Azione | Responsabilità |
|---|---|---|
| `shop/prisma/schema.prisma` | modify | `User.companyRole`, `Company.requiresOrderApproval`, `Order.trackingCarrier/trackingUrl` |
| `shop/prisma/migrations/<ts>_m6_rbac_approval_tracking/migration.sql` | create | migration generata |
| `shop/src/config/constants.js` | modify | `COMPANY_ROLES`, stato `AWAITING_APPROVAL`, transizioni, `CARRIERS`, `MAX_LEN.trackingCarrier`, `MAX_LEN.trackingUrl` |
| `shop/src/middleware/auth.js` | modify | export `requireCompanyRole(roles[])` |
| `shop/src/utils/tracking.js` | create | `buildTrackingUrl(carrier, number)` |
| `shop/src/controllers/orderController.js` | modify | branching `requiresOrderApproval` in `postCheckout` |
| `shop/src/controllers/adminController.js` | modify | `approveOrder`, dashboard stats extra, `updateOrderStatus` con tracking esteso |
| `shop/src/controllers/companyController.js` | create | endpoints company-admin (lista ordini company, approve, reject) |
| `shop/src/routes/admin.js` | modify | nuova route `POST /admin/orders/:id/approve` |
| `shop/src/routes/company.js` | create | mount su `/company` con `requireAuth + requireCompanyRole(['COMPANY_ADMIN'])` |
| `shop/src/app.js` | modify | mount router `/company` |
| `shop/src/utils/email.js` | modify | template `sendOrderShipped` con tracking link; `sendOrderAwaitingApproval` (notifica a company-admin) |
| `shop/views/admin/dashboard.ejs` | modify | card AWAITING_APPROVAL + ordini oggi/settimana |
| `shop/views/admin/orders.ejs` | modify | colonna stato include AWAITING_APPROVAL; filtro stato include nuovo enum |
| `shop/views/admin/order-detail.ejs` | modify | bottone "Approva ordine" se status=AWAITING_APPROVAL; campi tracking carrier+url+number |
| `shop/views/company/orders.ejs` | create | lista ordini company per COMPANY_ADMIN (filtro AWAITING_APPROVAL prominente) |
| `shop/views/company/order-detail.ejs` | create | dettaglio + bottone approva/rifiuta |
| `shop/views/account/orders.ejs` | modify | badge AWAITING_APPROVAL leggibile |
| `shop/views/account/order-detail.ejs` | modify | mostra status + tracking link cliccabile |
| `shop/views/partials/_navbar.ejs` (o equivalente) | modify | link "Ordini azienda" se `currentUser.companyRole === 'COMPANY_ADMIN'` |
| `shop/test/middleware.auth.test.js` | modify (o create) | test `requireCompanyRole` |
| `shop/test/order.approval.test.js` | create | test approval flow |
| `shop/test/utils.tracking.test.js` | create | test `buildTrackingUrl` |

---

## Convenzioni

- **Default backfill:**
  - `User.companyRole` default `'BUYER'`. Migration: tutti gli utenti esistenti con `companyId != null` → `BUYER`. ADMIN globale (`role='ADMIN'`) non è toccato (resta utente di sistema, ortogonale a companyRole).
  - **Bootstrap COMPANY_ADMIN:** primo utente di ogni company esistente promosso a `COMPANY_ADMIN` via SQL nella stessa migration (`UPDATE User SET companyRole='COMPANY_ADMIN' WHERE id IN (SELECT MIN(id) FROM User WHERE companyId IS NOT NULL GROUP BY companyId)`).
  - `Company.requiresOrderApproval` default `false`. Solo ADMIN globale può cambiarlo (in `company-detail.ejs`, fuori scope di questo plan se complesso → minimo: campo in form già presente).
  - `Order.trackingCarrier` e `trackingUrl` nullable.
- **Audit log su:** approve order, reject order, status transition con tracking, set companyRole.
- **Constants nuovi:**
  ```js
  const COMPANY_ROLES = Object.freeze(['COMPANY_ADMIN', 'BUYER', 'VIEWER']);
  // AWAITING_APPROVAL aggiunto a ORDER_STATUSES.
  // Transizioni:
  //   AWAITING_APPROVAL: ['PENDING', 'CANCELLED']  // approve → PENDING (ripiglia flusso pagamento) | reject → CANCELLED
  //   PENDING: ['CONFIRMED', 'PAYMENT_FAILED', 'CANCELLED']  // invariato
  // CARRIERS: ['DHL', 'GLS', 'SDA', 'BRT', 'UPS', 'FEDEX', 'POSTE', 'ALTRO']
  ```
- **`buildTrackingUrl(carrier, number)`** — restituisce URL tracking pubblico per i carrier noti, `null` per `ALTRO` o se number vuoto. Pattern hardcoded:
  ```js
  const TEMPLATES = {
    DHL: n => `https://www.dhl.com/it-it/home/tracciamento.html?tracking-id=${encodeURIComponent(n)}`,
    GLS: n => `https://www.gls-italy.com/it/per-il-destinatario/segui-la-tua-spedizione?match=${encodeURIComponent(n)}`,
    SDA: n => `https://www.sda.it/wps/portal/Servizi_online/dettaglio-spedizione?locale=it&tracingNumber=${encodeURIComponent(n)}`,
    BRT: n => `https://vas.brt.it/vas/sped_det_show.hsm?referer=sped_numspe_par.htm&Nspediz=${encodeURIComponent(n)}`,
    UPS: n => `https://www.ups.com/track?tracknum=${encodeURIComponent(n)}`,
    FEDEX: n => `https://www.fedex.com/fedextrack/?trknbr=${encodeURIComponent(n)}`,
    POSTE: n => `https://www.poste.it/cerca/index.html#/risultati-spedizioni/${encodeURIComponent(n)}`,
  };
  ```
  Se l'admin imposta `trackingUrl` esplicito, vince sempre su quello derivato.

---

## Wave 1 — Foundation (1 subagent sequenziale)

### Task F-1: Schema + migration + constants

**Files:** `shop/prisma/schema.prisma`, `shop/src/config/constants.js`, nuova migration.

- [ ] **Step 1: editare `schema.prisma`**

In `model User`, dopo riga `role`:
```prisma
  companyRole          String?   @default("BUYER") // COMPANY_ADMIN, BUYER, VIEWER (null se non in company)
```

In `model Company`, dopo `notes`:
```prisma
  requiresOrderApproval Boolean   @default(false)
```

In `model Order`, dopo `trackingNumber`:
```prisma
  trackingCarrier String?
  trackingUrl     String?
```

Aggiornare commento `status` in `Order` per includere `AWAITING_APPROVAL`.

- [ ] **Step 2: generare migration**

```bash
cd shop && npx prisma migrate dev --name m6_rbac_approval_tracking --create-only
```

- [ ] **Step 3: editare il file SQL appena creato** appendendo il bootstrap dei COMPANY_ADMIN:

```sql
-- Bootstrap: primo utente per company esistente diventa COMPANY_ADMIN
UPDATE "User" SET "companyRole" = 'COMPANY_ADMIN'
WHERE "id" IN (
  SELECT "id" FROM "User" u1
  WHERE "companyId" IS NOT NULL
    AND "id" = (SELECT MIN("id") FROM "User" u2 WHERE u2."companyId" = u1."companyId")
);
-- Tutti gli altri user con company restano 'BUYER' (default colonna)
```

- [ ] **Step 4: applicare migration + rigenerare client**

```bash
cd shop && npx prisma migrate dev && npx prisma generate
```

- [ ] **Step 5: editare `constants.js`** aggiungendo `COMPANY_ROLES`, `CARRIERS`, e modificando `ORDER_STATUSES` + `ORDER_STATUS_TRANSITIONS` (aggiungere `AWAITING_APPROVAL: ['PENDING', 'CANCELLED']` e modificare `PENDING` per includere `AWAITING_APPROVAL` come predecessore — *non* come successore: `PENDING` non torna ad `AWAITING_APPROVAL`). Aggiungere `MAX_LEN.trackingCarrier: 30`, `MAX_LEN.trackingUrl: 500`.

- [ ] **Step 6: build + test esistenti**

```bash
cd shop && npm run lint && npm test
```
Expected: tutti passano (le modifiche schema non rompono niente, solo aggiunte).

- [ ] **Step 7: commit**

```bash
git add shop/prisma shop/src/config/constants.js
git commit -m "feat(m6): schema rbac + approval + tracking carrier (T1/T2/T4)"
```

---

### Task F-2: middleware `requireCompanyRole`

**Files:** `shop/src/middleware/auth.js`, `shop/test/middleware.auth.test.js` (modify o create).

- [ ] **Step 1: aggiungere in `auth.js`** dopo `requireAdmin`:

```js
// Verifica companyRole. Bypass se ADMIN globale (super-user).
function requireCompanyRole(roles) {
  const allowed = Array.isArray(roles) ? roles : [roles];
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Non autenticato' });
    }
    if (req.user.role === 'ADMIN') return next(); // super-user bypass
    if (!req.user.companyId || !allowed.includes(req.user.companyRole)) {
      if (req.accepts('html')) {
        return res.status(403).render('error', { message: 'Accesso negato', code: 403 });
      }
      return res.status(403).json({ error: 'Accesso negato' });
    }
    next();
  };
}

module.exports = { requireAuth, requireAdmin, requireApprovedCompany, requireCompanyRole, injectUser };
```

- [ ] **Step 2: scrivere test fallente** in `shop/test/middleware.auth.test.js`:

```js
const { requireCompanyRole } = require('../src/middleware/auth');

describe('requireCompanyRole', () => {
  function mkRes() {
    return {
      statusCode: 200,
      jsonBody: null,
      status(c) { this.statusCode = c; return this; },
      json(b) { this.jsonBody = b; return this; },
      accepts: () => false,
    };
  }
  test('blocks user without companyId', () => {
    const mw = requireCompanyRole(['COMPANY_ADMIN']);
    const req = { user: { id: 'u1', role: 'CUSTOMER', companyRole: 'COMPANY_ADMIN' } };
    const res = mkRes();
    let nextCalled = false;
    mw(req, res, () => { nextCalled = true; });
    expect(res.statusCode).toBe(403);
    expect(nextCalled).toBe(false);
  });
  test('blocks BUYER from COMPANY_ADMIN-only route', () => {
    const mw = requireCompanyRole(['COMPANY_ADMIN']);
    const req = { user: { id: 'u1', role: 'CUSTOMER', companyId: 'c1', companyRole: 'BUYER' } };
    const res = mkRes();
    mw(req, res, () => {});
    expect(res.statusCode).toBe(403);
  });
  test('allows COMPANY_ADMIN', () => {
    const mw = requireCompanyRole(['COMPANY_ADMIN']);
    const req = { user: { id: 'u1', role: 'CUSTOMER', companyId: 'c1', companyRole: 'COMPANY_ADMIN' } };
    let nextCalled = false;
    mw(req, mkRes(), () => { nextCalled = true; });
    expect(nextCalled).toBe(true);
  });
  test('global ADMIN bypasses companyRole check', () => {
    const mw = requireCompanyRole(['COMPANY_ADMIN']);
    const req = { user: { id: 'u1', role: 'ADMIN' } };
    let nextCalled = false;
    mw(req, mkRes(), () => { nextCalled = true; });
    expect(nextCalled).toBe(true);
  });
});
```

- [ ] **Step 3: run**

```bash
cd shop && npm test -- middleware.auth
```
Expected: 4 PASS.

- [ ] **Step 4: commit**

```bash
git add shop/src/middleware/auth.js shop/test/middleware.auth.test.js
git commit -m "feat(m6): requireCompanyRole middleware + test (T1)"
```

---

### Task F-3: utility `buildTrackingUrl`

**Files:** `shop/src/utils/tracking.js` (create), `shop/test/utils.tracking.test.js` (create).

- [ ] **Step 1: scrivere test fallente** con i casi DHL, GLS, SDA, BRT, UPS, FEDEX, POSTE (URL atteso) + `ALTRO → null` + `number vuoto → null` + `carrier sconosciuto → null`. Usa i template del blocco "Convenzioni" sopra.

- [ ] **Step 2: implementare `tracking.js`** seguendo lo schema in Convenzioni. Esportare `buildTrackingUrl(carrier, number)` e `CARRIERS` (riusare quello da constants.js → import).

- [ ] **Step 3: run**

```bash
cd shop && npm test -- tracking
```
Expected: tutti PASS.

- [ ] **Step 4: commit**

```bash
git add shop/src/utils/tracking.js shop/test/utils.tracking.test.js
git commit -m "feat(m6): buildTrackingUrl helper + test (T4)"
```

---

## Wave 2 — Parallel (2 subagent indipendenti)

### Batch α — Approval workflow (1 subagent)

#### Task α-1: branching `postCheckout` su `requiresOrderApproval`

**Files:** `shop/src/controllers/orderController.js`, `shop/src/utils/email.js`, `shop/test/order.approval.test.js`.

- [ ] **Step 1:** in `postCheckout` (orderController.js:74), DOPO il calcolo `total` e il check stock preliminare ma PRIMA del `prisma.order.create`, leggere `req.user.company.requiresOrderApproval`. Se true E `req.user.companyRole !== 'COMPANY_ADMIN'`:
  - creare ordine con `status: 'AWAITING_APPROVAL'`
  - **non** chiamare Stripe né `_finalizeOrder`
  - inviare email `sendOrderAwaitingApproval` ai COMPANY_ADMIN della company
  - redirect a `/account/orders/<id>?awaitingApproval=1`

Il branch resta isolato — nessun cambiamento al flusso CONFIRMED.

- [ ] **Step 2:** aggiungere `sendOrderAwaitingApproval(order, companyAdmins)` in `email.js` (testo italiano, link a `/company/orders/:id`).

- [ ] **Step 3: scrivere test integrazione** `order.approval.test.js`:
  - given Company.requiresOrderApproval=true + user BUYER + cart valido → POST /shop/checkout → ordine in AWAITING_APPROVAL, no PaymentIntent creato, stock invariato
  - given Company.requiresOrderApproval=true + user COMPANY_ADMIN → flusso normale (PENDING/CONFIRMED)
  - given Company.requiresOrderApproval=false → flusso normale

(Stub Stripe + email come in altri test esistenti; usare `prisma` test-db pattern già stabilito).

- [ ] **Step 4: run + commit**

```bash
cd shop && npm test -- order.approval
git add shop/src/controllers/orderController.js shop/src/utils/email.js shop/test/order.approval.test.js
git commit -m "feat(m6): branch checkout su requiresOrderApproval (T2)"
```

#### Task α-2: endpoint approve/reject + UI company

**Files:** `shop/src/controllers/companyController.js` (create), `shop/src/routes/company.js` (create), `shop/src/app.js` (mount), `shop/views/company/orders.ejs` (create), `shop/views/company/order-detail.ejs` (create), `shop/src/controllers/adminController.js` (modify per admin override), `shop/src/routes/admin.js` (modify).

- [ ] **Step 1: `companyController.js`** export `getOrders`, `getOrderDetail`, `approveOrder`, `rejectOrder`. Tutti filtrati per `req.user.companyId`. `approveOrder`:
  - leggere ordine con `where: { id, companyId: req.user.companyId, status: 'AWAITING_APPROVAL' }`
  - update a `PENDING` (validare via `ORDER_STATUS_TRANSITIONS`)
  - `logAudit('ORDER_APPROVE', ...)`
  - inviare email al BUYER ("ordine approvato, completa il pagamento")
  - redirect a `/company/orders/:id`
  - `rejectOrder` analogo → `CANCELLED` + email "ordine rifiutato".

- [ ] **Step 2: `routes/company.js`**

```js
const router = require('express').Router();
const { requireAuth, requireCompanyRole } = require('../middleware/auth');
const ctrl = require('../controllers/companyController');
const asyncHandler = require('../utils/asyncHandler');

router.use(requireAuth, requireCompanyRole(['COMPANY_ADMIN']));
router.get('/orders', asyncHandler(ctrl.getOrders));
router.get('/orders/:id', asyncHandler(ctrl.getOrderDetail));
router.post('/orders/:id/approve', asyncHandler(ctrl.approveOrder));
router.post('/orders/:id/reject', asyncHandler(ctrl.rejectOrder));

module.exports = router;
```

- [ ] **Step 3: in `app.js`** mount `app.use('/company', require('./routes/company'))`. Posizione: prima del catch-all 404, dopo `/admin`.

- [ ] **Step 4: views/company/orders.ejs** — riusare il pattern di `views/admin/orders.ejs` (tabella + filtri base) ma scope alla company. Highlight prominente AWAITING_APPROVAL in cima.

- [ ] **Step 5: views/company/order-detail.ejs** — dettaglio + form `POST /company/orders/:id/approve` e `POST /company/orders/:id/reject` con `data-confirm`. Bottoni visibili solo se `order.status === 'AWAITING_APPROVAL'`.

- [ ] **Step 6: admin override** — in `adminController.js` aggiungere `approveOrder` (admin globale può approvare in vece). Route `POST /admin/orders/:id/approve` in `routes/admin.js`. Visibile in `views/admin/order-detail.ejs` se status=AWAITING_APPROVAL.

- [ ] **Step 7: link nav** — in partial header (verificare nome esatto, probabilmente `_header.ejs` o `_navbar.ejs` in `views/partials/`): aggiungere link "Ordini azienda" condizionato a `currentUser?.companyRole === 'COMPANY_ADMIN'`.

- [ ] **Step 8: extend test approval** con scenario approve→PENDING e reject→CANCELLED, verificando audit log.

- [ ] **Step 9: lint + test + commit**

```bash
cd shop && npm run lint && npm test
git add shop/src/controllers/companyController.js shop/src/routes/company.js shop/src/app.js shop/views/company shop/src/controllers/adminController.js shop/src/routes/admin.js shop/views/admin/order-detail.ejs shop/views/partials shop/test/order.approval.test.js
git commit -m "feat(m6): approve/reject endpoints + company UI + admin override (T2)"
```

---

### Batch β — Tracking + Dashboard (1 subagent)

#### Task β-1: tracking carrier in updateOrderStatus + UI admin

**Files:** `shop/src/controllers/adminController.js`, `shop/views/admin/order-detail.ejs`, `shop/src/utils/email.js`.

- [ ] **Step 1: in `adminController.js::updateOrderStatus`** (riga ~227): leggere `trackingCarrier` e `trackingUrl` da `req.body`. Validare `trackingCarrier` contro `CARRIERS` (constants). Sanitizzare URL (deve iniziare con `https://`, max `MAX_LEN.trackingUrl`). Se `trackingNumber` cambia ma `trackingUrl` vuoto, derivare con `buildTrackingUrl(carrier, number)`. Aggiungere a `data` Prisma e a `metadata` audit log.

- [ ] **Step 2: in `views/admin/order-detail.ejs`** form status: aggiungere `<select name="trackingCarrier">` con i `CARRIERS` (passati via res.locals o controller), e `<input name="trackingUrl" type="url">`. Già presente `trackingNumber`. Mostrare il link risolto (sia esplicito che derivato) come anteprima cliccabile.

- [ ] **Step 3: in `email.js::sendOrderShipped`** (cercare/creare se assente — alternativamente integrare in `sendOrderStatusUpdate` se quello è il template attuale): includere `trackingCarrier` + link `trackingUrl` cliccabile. Italiano.

- [ ] **Step 4: in `views/account/order-detail.ejs`** mostrare carrier + link cliccabile se presente.

- [ ] **Step 5: lint + test + commit**

```bash
cd shop && npm run lint && npm test
git add shop/src/controllers/adminController.js shop/views/admin/order-detail.ejs shop/views/account/order-detail.ejs shop/src/utils/email.js
git commit -m "feat(m6): tracking carrier + url in order status + email (T4)"
```

#### Task β-2: dashboard stats arricchita

**Files:** `shop/src/controllers/adminController.js`, `shop/views/admin/dashboard.ejs`.

- [ ] **Step 1: in `getDashboard`** aggiungere a `Promise.all` 3 query:

```js
prisma.order.count({ where: { createdAt: { gte: startOfDay }, status: { notIn: ['PENDING', 'PAYMENT_FAILED', 'CANCELLED', 'AWAITING_APPROVAL'] } } }), // ordersToday
prisma.order.count({ where: { createdAt: { gte: startOfWeek }, status: { notIn: ['PENDING', 'PAYMENT_FAILED', 'CANCELLED', 'AWAITING_APPROVAL'] } } }), // ordersWeek
prisma.order.count({ where: { status: 'AWAITING_APPROVAL' } }), // awaitingApproval
```

`startOfDay` = inizio oggi, `startOfWeek` = lunedì 00:00 della settimana corrente. Aggiornare `stats: {...}` con `ordersToday`, `ordersWeek`, `awaitingApproval`.

- [ ] **Step 2: in `dashboard.ejs`** aggiungere 3 stat-card (oggi, settimana, awaiting approval). La card AWAITING_APPROVAL con classe `stat-card--alert` se >0 e link `/admin/orders?stato=AWAITING_APPROVAL`.

- [ ] **Step 3: in `views/admin/orders.ejs`** assicurarsi che il filtro stato includa il nuovo enum (è già loop su `statuses` da constants → automatico, ma verificare l'i18n del label).

- [ ] **Step 4: lint + test + commit**

```bash
cd shop && npm run lint && npm test
git add shop/src/controllers/adminController.js shop/views/admin/dashboard.ejs shop/views/admin/orders.ejs
git commit -m "feat(m6): dashboard stats oggi/settimana/awaiting approval (T5)"
```

---

## Wave 3 — Regression + merge

### Task R-1: regression sweep

- [ ] **Step 1:** `cd shop && npm run build && npm run lint && npm test` — tutti verdi.
- [ ] **Step 2: smoke manuale 5 min** (locale, `npm run dev`):
  - login admin → dashboard mostra le 3 nuove card
  - crea company con `requiresOrderApproval=true` → user BUYER fa checkout → ordine AWAITING_APPROVAL, no charge
  - login COMPANY_ADMIN della stessa company → vede `/company/orders` → approva → ordine PENDING + email buyer ricevuta (controllo log)
  - admin imposta status=SHIPPED con carrier=GLS + numero → email contiene link cliccabile, account mostra link
- [ ] **Step 3:** se tutto ok, no commit (solo verifica). Se regressioni → fix in commit dedicato prima del merge.

### Task R-2: merge in master

- [ ] **Step 1:** aggiornare `docs/audit/2026-04-23/01-activeContext.md` (M6 → ✅ merged, deferred → M6-bis).
- [ ] **Step 2:** aggiornare memoria `audit_roadmap_2026-04-23.md` → M6 ✅ merged.
- [ ] **Step 3:** merge no-ff in master, eliminare branch.

```bash
git checkout master
git merge --no-ff feat/M6-admin-business -m "Merge branch 'feat/M6-admin-business'"
git branch -d feat/M6-admin-business
```

- [ ] **Step 4:** **NON** push (decisione utente: master locale resta avanti rispetto a origin).

---

## Self-review (pre-execute)

- ✅ Spec coverage: T1 (F-1, F-2), T2 (α-1, α-2), T3 già esistente (out of scope), T4 (F-3, β-1), T5 (β-2).
- ✅ Niente placeholder TBD/TODO; ogni step ha codice o comando concreto.
- ✅ Type consistency: `companyRole` ovunque `BUYER|COMPANY_ADMIN|VIEWER`; `AWAITING_APPROVAL` consistente in constants/views/controller; `buildTrackingUrl` firma uniforme.
- ⚠️ Possibile gap: form `Company.requiresOrderApproval` toggle in admin/company-detail.ejs non ha task dedicato. **Decisione:** se `views/admin/company-detail.ejs` ha già il pattern di field admin-edit, lo aggiungiamo in β-2 (1 riga); altrimenti deferred a M6-bis.

---

## Deferred → M6-bis

- UI COMPANY_ADMIN per gestire utenti della propria company (invite, change role, deactivate)
- API integration carrier (DHL/GLS/SDA real-time tracking)
- PDF fatture bulk export (dipende da M2)
- Toggle `requiresOrderApproval` in form admin se non già presente
