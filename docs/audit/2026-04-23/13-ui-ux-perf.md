# Audit UI/UX & Performance — MFDEPUR Shop

**Sub-agent:** Explore (UI/UX/perf) · **a11y:** GOOD · **perf:** GOOD

> ⚠ **Caveat:** riferimenti `file:line` da report sub-agent; alcuni contaminuti template indicativi.

## Verdetto

UI/UX solida e funzionale: semantica HTML corretta, skip-link, heading gerarchia, form con `<label for>`, breadcrumb con `aria-label`, responsive con `@media`, testi IT coerenti, toast con `role="alert"`, `loading=lazy` presente su catalog. Performance accettabile (CSS ~60KB, JS ~35KB). **Principale debito:** 207 `style="..."` inline bloccano la rimozione di `'unsafe-inline'` da CSP `styleSrc`.

## Metriche

- Inline `style="..."`: **~207** nei template
- CSS totale `shop/public/css/`: ~60 KB
- JS totale `shop/public/js/`: ~35 KB
- Immagini in `shop/public/img/`: 1 (favicon); le immagini prodotto vengono da CDN/DB
- `loading="lazy"`: presente in `catalog.ejs`, **assente** in `cart.ejs`, `order-detail.ejs`, admin

## Findings high

| ID | Area | Titolo | Location |
|---|---|---|---|
| CSP-001 | assets | 207 inline `style="..."` bloccano eliminazione `'unsafe-inline'` da `styleSrc` | multipli `views/**/*.ejs` |

## Findings medium

| ID | Area | Titolo | Location |
|---|---|---|---|
| A11Y-001 | semantics | Tabelle senza `scope="col"` / `scope="row"` su `<th>` | `views/shop/cart.ejs:62-68`, `views/admin/*.ejs` |
| UX-001 | perf/ux | `loading="lazy"` solo in catalog, assente in cart/admin/order-detail | `views/shop/cart.ejs:76` |
| A11Y-002 | a11y | Errori form non linkati con `aria-describedby` sui `<input>` | `views/auth/register.ejs` |
| UX-003 | ux | `minOrderQty` visibile ma non enfatizzato in catalog card | `views/shop/catalog.ejs:180`, `product.ejs:73` |

## Findings low/info

- **PERF-001** `font-display:swap` già in link Google; aggiungere anche in CSS `@font-face` locale se serve consistency (non bloccante).
- **SEO-001** `shop/public/robots.txt` assente (sitemap presente via route).
- **UX-002** Conferme azioni distruttive: `data-confirm` su cart/clear ma non su delete address, cancellazione ordine, ecc. — verificare.
- **RESPONSIVE-001** JS hamburger attivo anche desktop (solo CSS lo nasconde — overhead trascurabile).
- **SEMANTICS-001** Breadcrumb ha `aria-label` ma manca JSON-LD `BreadcrumbList` schema.org (SEO opzionale).
- **IMAGES-001** Nessun formato moderno (webp/avif) perché le immagini prodotto vengono da CDN terzo; favicon ICO OK.
- **ADMIN-001** `chart.js` caricato da `cdn.jsdelivr.net`; se CDN down, canvas vuoto senza fallback UX.
- **FORMS-001** Aggiungere `inputmode="email"`/`"tel"` su rispettivi input.
- **I18N-001** Prezzi renderizzati con `.toFixed(2)` → `€1234.56`; preferire `Intl.NumberFormat('it-IT', {...})` per formato italiano `1.234,56 €`.
- **CONTRAST-001** `--text-muted: #777` su bianco ≈ 4.4:1 (AAA marginale). Accettabile; se necessario elevare a `#666`.
- **ERROR-001** Pagina errore 500 senza ID di tracking per supporto → aggiungere `errorId`.
- **SEMANTICS-002** H1 unico per pagina: conforme.
- **CART-001** Guest cart: nessun fallback UI su `JSON.parse` fail di localStorage.
- **CHECKOUT-001** Mancano hint UX su 3DS/SCA per banche IT (evitare confusione post-submit).
- **ACCOUNT-001** Home account senza quick-card overview (ordini recenti, indirizzo default, profilo).

## Positive observations

- Semantica HTML robusta: `<header>`, `<main id="main-content">`, `<nav>`, `<section>`, `<footer>`
- Skip-link con `:focus-visible` + outline
- CSP con nonce su `scriptSrc`
- Responsive con `@media (max-width:640px/960px)` + hamburger `aria-expanded`/`aria-label`
- Form con `<label for>`, `required`, `autocomplete`
- E-commerce UX completo: carrello, checkout multi-step, conferme, indirizzi, metodi pagamento
- `<img alt="">` presente (catalog, product)
- Admin: chart.js su canvas con `aria-label`, tabelle `<thead>/<tbody>`, stat cards
- Error pages user-friendly in italiano
- Toast con `role="alert"` / `aria-live`

## Open questions (da testare in browser)

1. Contrasto `--text-muted` su dark mode OS / 100% zoom
2. Tabelle admin hanno `scope="col"` nel HTML renderizzato (il sub-agent non le ha ispezionate tutte)
3. Conferma lato client su delete address/item → senza JS gestito = race?
4. Coerenza messaggi validation server vs client su register/login
5. Open Graph `og:image` URL raggiungibile
6. FCP su mobile 3G con carrello pieno
7. Test screen reader end-to-end: product → cart → checkout → conferma
8. Test pagamento con carta 3DS obbligatorio
