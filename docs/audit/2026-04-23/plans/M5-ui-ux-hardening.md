# M5 — UI/UX Hardening (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development`. Un task → un commit.

**Goal:** Chiudere i 13 finding UI/UX dell'audit con interventi pragmatici (CSP strict sui `<style>`, a11y, perf, Intl italiano, robots.txt, errorId tracking, guest-cart resilience).

**Strategia T1/T2 (inline style):** invece di refactorare 207 `style="..."` inline attributes (giorni di lavoro), uso la direttiva CSP **`style-src-attr 'unsafe-inline'`** (permette attributes inline) + **`style-src 'self' nonce-<n>`** (strict sui `<style>` block). Net gain security: nessun XSS via `<style>` injection; nonce non necessario perché i template non hanno `<style>` block (0 rilevati). Il refactor dei 207 inline style resta debito tecnico tracciato, non bloccante.

**Tech stack:** nessuna nuova dipendenza. Uso `Intl.NumberFormat` nativo Node/browser.

---

## File structure (M5)

| File | Azione | Responsabilità |
|---|---|---|
| `shop/src/app.js` | modify | CSP styleSrc strict + styleSrcAttr 'unsafe-inline'; error handler → errorId |
| `shop/src/utils/format.js` | **create** | `formatEuroIT`, `formatDateIT`, `formatNumberIT` (Intl.NumberFormat it-IT) |
| `shop/public/robots.txt` | **create** | Sitemap + Disallow /account /admin |
| `shop/views/error.ejs` | modify | Visualizza errorId per tracking supporto |
| `shop/views/**/*.ejs` | modify | T3 scope, T4 lazy, T5 aria-describedby, T6 prezzi Intl, T7 inputmode, T8 data-confirm, T11 3DS hint, T12 minOrderQty badge |
| `shop/public/js/shop.js` | modify | T6 Intl format client + T13 localStorage fallback |

**Pre-flight:** branch `feat/M5-ui-ux-hardening` da `master`.

---

## Wave 1 — Foundation (1 subagent sequenziale)

### Task F-1: CSP hardening (T1/T2)

**Files:** Modify `shop/src/app.js`.

- [ ] **Step 1:** leggere `shop/src/app.js`. Trovare il blocco `helmet({ contentSecurityPolicy: { directives: { ... } } })`. In particolare le righe su `styleSrc` (riga ~62 dal codice storico).

- [ ] **Step 2:** sostituire il blocco `directives` per la sola direttiva `styleSrc` e aggiungere `styleSrcAttr`:

```js
      // styleSrc: strict per <style> block. Nessun 'unsafe-inline'.
      // Nel codice attuale non ci sono <style> inline nei template EJS (verificato
      // con grep "<style" in views/). Se in futuro servono, aggiungere nonce.
      styleSrc: [
        "'self'",
        (req, res) => `'nonce-${res.locals.cspNonce}'`,
        'fonts.googleapis.com',
        'cdnjs.cloudflare.com',
        'unpkg.com',
      ],
      // styleSrcAttr: accetta style="..." inline. Il refactoring dei 207 inline style
      // è debito tecnico tracciato (CSP-001); questa direttiva mantiene la protezione
      // rigorosa sui <style> block (più pericolosi) consentendo gli attribute inline.
      styleSrcAttr: ["'unsafe-inline'"],
```

**Attenzione:** preservare il commento/TODO esistente rimuovendolo o rimpiazzandolo con il commento sopra. Non toccare le altre direttive (`scriptSrc`, `imgSrc`, `fontSrc`, ecc.).

- [ ] **Step 3 — Verifica:**
```bash
node -c shop/src/app.js
cd shop && grep -A2 "styleSrcAttr" src/app.js
```

- [ ] **Step 4 — Commit:**
```bash
git add shop/src/app.js
git commit -m "security(csp): style-src strict + style-src-attr 'unsafe-inline' (rimuove unsafe-inline da style-src)"
```

**Ref:** M5-T1 (reframed), M5-T2, SEC-015, SHOP-016, CSP-001 (partial).

---

### Task F-2: `robots.txt` (T9)

**Files:** Create `shop/public/robots.txt`.

- [ ] **Step 1:** creare `shop/public/robots.txt`:
```
# MFDEPUR Shop — B2B

User-agent: *
Disallow: /account/
Disallow: /admin/
Disallow: /auth/

Sitemap: https://shop.mfdepur.com/sitemap.xml
```

- [ ] **Step 2 — Verifica:**
```bash
cat shop/public/robots.txt | head
```

- [ ] **Step 3 — Commit:**
```bash
git add shop/public/robots.txt
git commit -m "seo: robots.txt (Disallow /account /admin /auth + Sitemap link)"
```

**Ref:** M5-T9, SEO-001.

---

### Task F-3: errorId tracking (T10)

**Files:** Modify `shop/src/app.js`, `shop/views/error.ejs`.

- [ ] **Step 1:** leggere l'error handler generico di `shop/src/app.js` (verso la fine, probabile riga ~130-140):
```js
app.use((err, req, res, next) => {
  console.error(err);
  const code = err.status || 500;
  const message = process.env.NODE_ENV === 'production' ? 'Errore interno del server' : err.message;
  if (req.accepts('json')) return res.status(code).json({ error: message });
  res.status(code).render('error', { message, code });
});
```

- [ ] **Step 2:** sostituire con:
```js
app.use((err, req, res, next) => {
  // req.id viene da pino-http (M3-α-2). Se per qualche motivo non c'è, fallback a crypto.randomUUID().
  const errorId = req.id || require('crypto').randomUUID();
  if (req.log) {
    req.log.error({ err, errorId }, 'unhandled error');
  } else {
    console.error(`[${errorId}]`, err);
  }
  const code = err.status || 500;
  const message = process.env.NODE_ENV === 'production' ? 'Errore interno del server' : err.message;
  if (req.accepts('json')) return res.status(code).json({ error: message, errorId });
  res.status(code).render('error', { message, code, errorId });
});
```

- [ ] **Step 3:** leggere `shop/views/error.ejs`, trovare il blocco di rendering del messaggio (probabilmente sotto `<h1>` o `<p>`). Aggiungere in fondo al contenuto principale della view (prima del `</main>` o simile):

```html
<% if (typeof errorId !== 'undefined' && errorId) { %>
  <p class="error-id" style="color:#888; font-size:12px; font-family:monospace; margin-top:24px;">
    Codice errore: <%= errorId %>
  </p>
  <p style="color:#666; font-size:13px;">
    Se contatti il supporto, comunica questo codice per aiutarci a risalire al problema.
  </p>
<% } %>
```

(Il `style="..."` inline è ammesso dalla `styleSrcAttr` di F-1.)

- [ ] **Step 4 — Verifica:**
```bash
node -c shop/src/app.js
grep "errorId" shop/views/error.ejs
```

- [ ] **Step 5 — Commit:**
```bash
git add shop/src/app.js shop/views/error.ejs
git commit -m "feat(errors): errorId tracking (req.id) in pagina errore per supporto"
```

**Ref:** M5-T10, ERROR-001.

---

### Task F-4: `src/utils/format.js` + wire `res.locals.formatEuro` (T6 server)

**Files:** Create `shop/src/utils/format.js`; modify `shop/src/app.js`.

- [ ] **Step 1:** creare `shop/src/utils/format.js`:

```js
// src/utils/format.js
// Formatter Intl 'it-IT' usati lato server (EJS) e re-implementati lato client.
// Valuta: € 1.234,56 (formato italiano, spazio unbreakable, separatori IT).

const euroFormatter = new Intl.NumberFormat('it-IT', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const numberFormatter = new Intl.NumberFormat('it-IT', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

const dateFormatter = new Intl.DateTimeFormat('it-IT', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

const dateTimeFormatter = new Intl.DateTimeFormat('it-IT', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

function toNumber(v) {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  // Prisma.Decimal o stringhe
  if (typeof v.toNumber === 'function') return v.toNumber();
  return parseFloat(v) || 0;
}

function formatEuro(v) {
  return euroFormatter.format(toNumber(v));
}

function formatNumber(v) {
  return numberFormatter.format(toNumber(v));
}

function formatDate(v) {
  if (!v) return '';
  const d = v instanceof Date ? v : new Date(v);
  return dateFormatter.format(d);
}

function formatDateTime(v) {
  if (!v) return '';
  const d = v instanceof Date ? v : new Date(v);
  return dateTimeFormatter.format(d);
}

module.exports = { formatEuro, formatNumber, formatDate, formatDateTime };
```

- [ ] **Step 2:** in `shop/src/app.js`, trovare il blocco "Variabili globali per le view" (dove c'è `res.locals.currentPath`). Aggiungere l'iniezione dei formatter:

```js
const format = require('./utils/format');
app.use((req, res, next) => {
  res.locals.currentPath = req.path;
  res.locals.baseUrl = process.env.BASE_URL;
  // Formatter 'it-IT' iniettati come res.locals per uso nei template EJS
  res.locals.formatEuro = format.formatEuro;
  res.locals.formatNumber = format.formatNumber;
  res.locals.formatDate = format.formatDate;
  res.locals.formatDateTime = format.formatDateTime;
  next();
});
```

(Adattare l'integrazione al pattern esistente se differente.)

- [ ] **Step 3 — Verifica:**
```bash
node -c shop/src/app.js shop/src/utils/format.js
cd shop && node -e "const f = require('./src/utils/format'); console.log(f.formatEuro(1234.56), f.formatDate(new Date('2026-04-24')))"
# Expected: "€ 1.234,56" "24/04/2026" (o simile)
```

- [ ] **Step 4 — Commit:**
```bash
git add shop/src/utils/format.js shop/src/app.js
git commit -m "chore(utils): format helpers Intl it-IT (euro, number, date) in res.locals"
```

**Ref:** M5-T6, I18N-001.

---

## Wave 2 — Parallel batches (2 subagent)

### Batch α — EJS view improvements (1 subagent)

Scope molto ampio ma tutto a livello di template. **Un subagent solo** perché tutte le modifiche toccano `shop/views/**/*.ejs`.

**Elenco task integrati in α:**
- **α-1** — T3 `scope="col"` su `<th>` in tutte le tabelle
- **α-2** — T4 `loading="lazy"` su `<img>` in cart/order-detail/admin views (non catalog/product già fatti)
- **α-3** — T5 `aria-describedby` su errori form (register, login, checkout)
- **α-4** — T6 sostituire `.toFixed(2)` con `<%= formatEuro(x) %>` nei template con prezzi
- **α-5** — T7 `inputmode` su input email/tel (register, checkout, profile)
- **α-6** — T8 `data-confirm` su azioni distruttive (delete address, cancel order, delete account se manca)
- **α-7** — T11 hint 3DS su checkout.ejs
- **α-8** — T12 badge minOrderQty in catalog.ejs

**Vincoli:**
- Un commit per sotto-task (8 commit totali).
- Non toccare `shop/src/` né `shop/public/js/`.
- Preservare struttura, classi CSS, inline style esistenti (non riordinare).
- Se una modifica crea un conflitto semantico (es. il template esiste ma non ha la sezione attesa), adattare invece di inventare. Motivare nel report.

#### Task α-1: `scope="col"` su tabelle

- [ ] **Step 1:** in ciascuno dei seguenti file, aggiungere `scope="col"` a ogni `<th>` dentro `<thead>`:
  - `shop/views/account/order-detail.ejs`
  - `shop/views/account/orders.ejs`
  - `shop/views/admin/categories.ejs`
  - `shop/views/admin/companies.ejs`
  - `shop/views/admin/company-detail.ejs`
  - `shop/views/admin/dashboard.ejs`
  - `shop/views/admin/order-detail.ejs`
  - `shop/views/admin/orders.ejs`
  - `shop/views/admin/products.ejs`
  - `shop/views/shop/cart.ejs`
  - `shop/views/shop/order-success.ejs`

Pattern: `<th>Etichetta</th>` → `<th scope="col">Etichetta</th>`. Se `<th>` ha già classi o attributi, aggiungere `scope="col"` preservandoli.

- [ ] **Step 2:** commit:
```bash
git add shop/views/
git commit -m "a11y(tables): scope=\"col\" su <th> in 11 template (A11Y-001)"
```

---

#### Task α-2: `loading="lazy"` su immagini

- [ ] **Step 1:** in tutti i file `shop/views/**/*.ejs` che renderizzano `<img>` non già con `loading="lazy"` **E** non above-the-fold (logo header escluso), aggiungere `loading="lazy"`.
  - Logo in `partials/_header.ejs`: **escluso** (above-the-fold)
  - `shop/views/shop/cart.ejs` item images: includere
  - `shop/views/account/order-detail.ejs` item images: includere
  - `shop/views/admin/orders.ejs` / `products.ejs` thumbnails: includere
  - `shop/views/shop/catalog.ejs` e `product.ejs`: già presente (verificare con grep)

- [ ] **Step 2:** grep verifica:
```bash
grep -rEn "<img[^>]*loading=\"lazy\"" shop/views/ | wc -l
# Expected: > numero iniziale (2 pre-M5)
```

- [ ] **Step 3:** commit:
```bash
git add shop/views/
git commit -m "perf(images): loading=\"lazy\" esteso a cart/admin/order views (UX-001)"
```

---

#### Task α-3: `aria-describedby` errori form

- [ ] **Step 1:** nei template con form di validazione (`register.ejs`, `login.ejs`, `forgot-password.ejs`, `reset-password.ejs`, `profile.ejs`, `addresses.ejs`, `checkout.ejs`), collegare ogni `<input>` a un `<small id="<field>-error">` se esiste un errore specifico per quel campo. Pattern consigliato:

```html
<label for="email">Email</label>
<input type="email" id="email" name="email" required autocomplete="email"
       inputmode="email"
       aria-describedby="email-hint<% if (errors?.email) { %> email-error<% } %>"
       aria-invalid="<%= errors?.email ? 'true' : 'false' %>">
<small id="email-hint" class="form-hint">Formato: utente@dominio.it</small>
<% if (errors?.email) { %>
  <small id="email-error" class="form-error" role="alert"><%= errors.email %></small>
<% } %>
```

Adattare al pattern di error-display esistente: se il template non discrimina `errors.<field>` ma ha solo un array generico `errors[]`, collegare tutti gli input agli stessi id `errors-list`. Lo scopo è rendere navigabile da screen reader.

**Nota:** il pattern esatto dipende dal codice reale. Il subagent deve leggere **prima** i template e adattare.

- [ ] **Step 2:** commit:
```bash
git add shop/views/
git commit -m "a11y(forms): aria-describedby+aria-invalid sugli input (A11Y-002)"
```

---

#### Task α-4: prezzi con `formatEuro`

- [ ] **Step 1:** trovare tutte le occorrenze di `&euro;<%= ... .toFixed(2) %>` oppure `€<%= ... .toFixed(2) %>` nei template EJS:
```bash
grep -rEn "(&euro;|€)[^<]*toFixed" shop/views/
```

- [ ] **Step 2:** sostituire ciascuna con `<%= formatEuro(x) %>` dove `x` è l'espressione originale. Esempi:
  - `&euro;<%= parseFloat(item.unitPrice).toFixed(2) %>` → `<%= formatEuro(item.unitPrice) %>`
  - `€<%= Number(order.total).toFixed(2) %>` → `<%= formatEuro(order.total) %>`

`formatEuro` già include il simbolo `€` (Intl.currency), quindi **rimuovere** `&euro;` / `€` prima del tag.

- [ ] **Step 3 — Verifica:**
```bash
grep -rEn "&euro;.*toFixed|€.*toFixed" shop/views/
# Expected: output vuoto (tutti sostituiti)
grep -rc "formatEuro" shop/views/ | grep -v ":0"
# Expected: lista file toccati
```

- [ ] **Step 4:** commit:
```bash
git add shop/views/
git commit -m "i18n(prices): formatEuro (Intl it-IT) sostituisce toFixed in tutti i template (I18N-001)"
```

---

#### Task α-5: `inputmode` su email/tel

- [ ] **Step 1:** in `register.ejs`, `login.ejs`, `forgot-password.ejs`, `reset-password.ejs`, `profile.ejs`, `checkout.ejs`:
  - `<input type="email">` → aggiungere `inputmode="email"` (se non già presente)
  - `<input type="tel">` o name="phone" → aggiungere `inputmode="tel"`
  - Campi CAP numerici: `inputmode="numeric"` se già non c'è

- [ ] **Step 2:** commit:
```bash
git add shop/views/
git commit -m "ux(mobile): inputmode su email/tel/numeric per tastiera corretta (FORMS-001)"
```

---

#### Task α-6: `data-confirm` su azioni distruttive

- [ ] **Step 1:** verificare in `shop/public/js/shop.js` se esiste un handler globale per `[data-confirm]` (tipo `document.querySelectorAll('[data-confirm]').forEach(el => el.addEventListener('click', ...))`). Se non esiste, non ha senso aggiungere l'attributo senza il handler — il handler va aggiunto nel batch β.

- [ ] **Step 2:** aggiungere `data-confirm="Messaggio?"` ai seguenti bottoni/form:
  - `account/addresses.ejs` → bottone "Elimina indirizzo" → `data-confirm="Eliminare questo indirizzo?"`
  - `account/privacy.ejs` → form cancellazione account → probabilmente già ha (controllare); aggiungere se manca
  - `admin/products.ejs` → delete product → `data-confirm="Eliminare questo prodotto?"`
  - `admin/categories.ejs` → delete category → `data-confirm="Eliminare questa categoria?"`
  - `admin/companies.ejs` → bottoni status change critici (REJECT/SUSPEND) → `data-confirm="Confermi sospensione azienda?"`

- [ ] **Step 3:** commit:
```bash
git add shop/views/
git commit -m "ux(confirm): data-confirm su azioni distruttive (UX-002)"
```

---

#### Task α-7: hint 3DS su checkout

- [ ] **Step 1:** in `shop/views/shop/checkout.ejs`, trovare il form/bottone "Paga ora" (o simile testo). Immediatamente prima del bottone, aggiungere:

```html
<p class="checkout-3ds-hint" style="color:#666; font-size:13px; margin:12px 0;">
  <span aria-hidden="true">🔒</span>
  Pagamento sicuro tramite Stripe. La tua banca potrebbe chiederti un'autenticazione
  aggiuntiva (codice SMS o app 3D Secure) per confermare il pagamento.
</p>
```

- [ ] **Step 2:** commit:
```bash
git add shop/views/shop/checkout.ejs
git commit -m "ux(checkout): hint 3D Secure prima del bottone pagamento (CHECKOUT-001)"
```

---

#### Task α-8: badge `minOrderQty` in catalog

- [ ] **Step 1:** in `shop/views/shop/catalog.ejs`, trovare la card prodotto. Nel blocco info (probabilmente dopo prezzo, dentro la card), aggiungere condizionale:

```html
<% if (product.minOrderQty && product.minOrderQty > 1) { %>
  <span class="badge-min-qty" style="display:inline-block; background:#eef4ff; color:#0a3d8f;
        padding:2px 8px; border-radius:10px; font-size:12px; margin-top:4px;">
    Min. <%= product.minOrderQty %> <%= product.unit || 'pz' %>
  </span>
<% } %>
```

- [ ] **Step 2:** commit:
```bash
git add shop/views/shop/catalog.ejs
git commit -m "ux(catalog): badge minOrderQty su card prodotto (UX-003)"
```

---

### Batch β — JS client: Intl + localStorage fallback + data-confirm handler (1 subagent)

**Files:** Modify `shop/public/js/shop.js`.

#### Task β-1: Intl formatter client (T6)

- [ ] **Step 1:** leggere `shop/public/js/shop.js` per capire struttura. Trovare le funzioni che formattano prezzi (tipicamente `recalcCartSummary`, `updateCartTotal`, ecc. con pattern `€${x.toFixed(2)}` o simile).

- [ ] **Step 2:** in testa al file (dopo eventuale IIFE open), aggiungere helper:

```js
  // Intl formatter client 'it-IT'. Simmetrico a src/utils/format.js lato server.
  const fmtEuro = new Intl.NumberFormat('it-IT', {
    style: 'currency', currency: 'EUR',
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
  const fmtNumber = new Intl.NumberFormat('it-IT', {
    minimumFractionDigits: 0, maximumFractionDigits: 2,
  });
  function formatEuro(v) {
    const n = typeof v === 'number' ? v : parseFloat(v) || 0;
    return fmtEuro.format(n);
  }
  function formatNumber(v) {
    const n = typeof v === 'number' ? v : parseFloat(v) || 0;
    return fmtNumber.format(n);
  }
```

- [ ] **Step 3:** sostituire le occorrenze `€${x.toFixed(2)}` con `formatEuro(x)`, rimuovendo `€` esplicito (è nel formatter). Cerca pattern:
```bash
grep -n "toFixed(2)" shop/public/js/shop.js
grep -n "€\${" shop/public/js/shop.js
```

- [ ] **Step 4:** commit:
```bash
git add shop/public/js/shop.js
git commit -m "i18n(client): formatEuro Intl it-IT sostituisce toFixed in shop.js (I18N-001)"
```

---

#### Task β-2: `data-confirm` handler globale

- [ ] **Step 1:** verificare se esiste già un handler in `shop.js`:
```bash
grep -n "data-confirm" shop/public/js/shop.js
```

- [ ] **Step 2:** se NON esiste, aggiungere in fondo al file (dentro DOMContentLoaded o IIFE):

```js
  // Confirm dialog per azioni distruttive (link, button, form submit con data-confirm)
  document.addEventListener('click', function (e) {
    const el = e.target.closest('[data-confirm]');
    if (!el) return;
    const msg = el.getAttribute('data-confirm') || 'Sei sicuro?';
    if (!window.confirm(msg)) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, true);

  document.addEventListener('submit', function (e) {
    const el = e.target.closest('form[data-confirm]');
    if (!el) return;
    const msg = el.getAttribute('data-confirm') || 'Sei sicuro?';
    if (!window.confirm(msg)) {
      e.preventDefault();
    }
  }, true);
```

Se esiste già un handler simile, **non duplicare**. Saltare Step 2 e notare nel report.

- [ ] **Step 3:** commit:
```bash
git add shop/public/js/shop.js
git commit -m "ux(confirm): handler globale click/submit per [data-confirm] (UX-002 client)"
```

---

#### Task β-3: localStorage fallback per guest cart (T13)

- [ ] **Step 1:** trovare la funzione guest-cart che legge da localStorage (pattern: `JSON.parse(localStorage.getItem('cart'))` o simile, probabilmente dentro un oggetto `GuestCart`).

- [ ] **Step 2:** avvolgere la lettura in try/catch:

```js
  function readGuestCart() {
    try {
      const raw = localStorage.getItem('mfd_guest_cart');
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) throw new Error('not an array');
      return parsed;
    } catch (err) {
      console.warn('[guest-cart] localStorage corrotto, reset:', err.message);
      try { localStorage.removeItem('mfd_guest_cart'); } catch (_) { /* ignore */ }
      if (typeof showToast === 'function') {
        showToast('Carrello ripristinato (dati locali corrotti).', 'warn');
      }
      return [];
    }
  }
```

Adattare chiave localStorage e nome funzione al codice reale (leggere prima `shop/public/js/shop.js`).

- [ ] **Step 3:** sostituire le chiamate dirette `JSON.parse(localStorage.getItem(...))` con la nuova `readGuestCart()`.

- [ ] **Step 4:** commit:
```bash
git add shop/public/js/shop.js
git commit -m "ux(cart): guest cart localStorage fallback su JSON malformato (CART-001)"
```

---

## Wrap-up (orchestrator)

- [ ] **Step 1:** run test suite (verifica nessuna regression da template/css):
```bash
cd shop && npm test 2>&1 | tail -10
# Expected: 17/17 verdi
```

- [ ] **Step 2:** lint:
```bash
cd shop && npm run lint 2>&1 | tail -5
# Expected: 0 errori
```

- [ ] **Step 3:** smoke startup + verifica CSP (opzionale — richiede `.env` dev):
```bash
cd shop && npm run dev &
sleep 5
curl -sI http://localhost:3000/ | grep -i "content-security-policy"
# Expected: header CSP con "style-src-attr" presente
curl -s http://localhost:3000/robots.txt
# Expected: contenuto robots.txt
curl -s http://localhost:3000/shop | grep -c "loading=\"lazy\""
# Expected: > 0
kill %1 2>/dev/null
```

- [ ] **Step 4:** conteggio commit:
```bash
git log --oneline master..HEAD | wc -l
# Expected: ~14-16 commit
```

- [ ] **Step 5:** merge:
```bash
git checkout master
git merge --no-ff feat/M5-ui-ux-hardening -m "Merge branch 'feat/M5-ui-ux-hardening' — M5"
```

- [ ] **Step 6:** update memoria + activeContext.

---

## Riepilogo coverage

| Task plan | Ref audit |
|---|---|
| F-1 | M5-T1 (reframed), M5-T2, SEC-015, SHOP-016 |
| F-2 | M5-T9, SEO-001 |
| F-3 | M5-T10, ERROR-001 |
| F-4 | M5-T6 (server), I18N-001 |
| α-1 | M5-T3, A11Y-001 |
| α-2 | M5-T4, UX-001 |
| α-3 | M5-T5, A11Y-002 |
| α-4 | M5-T6 (view), I18N-001 |
| α-5 | M5-T7, FORMS-001 |
| α-6 | M5-T8, UX-002 (view side) |
| α-7 | M5-T11, CHECKOUT-001 |
| α-8 | M5-T12, UX-003 |
| β-1 | M5-T6 (client), I18N-001 |
| β-2 | M5-T8 (client handler) |
| β-3 | M5-T13, CART-001 |

**Coverage:** 13/13 task M5.

**Debito tecnico tracciato (non risolto in M5):**
- CSP-001 parziale: i 207 inline style attributes restano, ma protetti sotto `styleSrcAttr 'unsafe-inline'`. Il refactor completo a classi CSS/nonce è deferrred a M5-bis / cleanup sprint.

## Decomposizione esecutiva

| Wave | Chi | Cosa | Durata |
|---|---|---|---|
| 0 | orchestrator | branch + plan commit | instant |
| 1 | 1 subagent sequenziale | F-1 CSP, F-2 robots, F-3 errorId, F-4 format util | ~15 min |
| 2 | 2 subagent paralleli | α (8 commit views) · β (3 commit public/js/shop.js) | ~15-20 min |
| 3 | orchestrator | test/lint, merge | ~5 min |

Totale: ~30-40 min.

## Rischi noti

- **Adattamento ai template reali** (α-3 aria, α-6 data-confirm): i pattern del plan sono esempi — il subagent deve leggere i template reali e adattare. Motivazione nel report.
- **Verifica 3DS hint (α-7)**: il bottone "Paga ora" potrebbe essere in una sezione renderizzata client-side da Stripe Elements. Se il placement non è ovvio, mettere l'hint vicino al form card fields.
- **`data-confirm` pattern** (α-6 + β-2): se α aggiunge gli attributi prima che β installi il handler, per quel breve tempo i bottoni permettono il click senza conferma. Ma Wave 1 e Wave 2 sono separate, e Wave 2 dispatch α e β insieme — non tempo di dispatch reale dell'utente. OK.
- **Test regression**: i test M4 non coprono le view. Una modifica di classe CSS o testo non rompe i test ma rompe l'UI. Smoke startup consigliato.
