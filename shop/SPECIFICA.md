# MF Depur — Specifica Tecnica B2B Shop

> Documento generato il 28 febbraio 2026
> Ultimo aggiornamento: 2 marzo 2026
> Versione: 1.1

---

## 1. Panoramica del progetto

Lo shop B2B di MF Depur è un'applicazione web integrata nel sito istituzionale di MF Depur (mfdepur.com). Permette alle aziende clienti di sfogliare il catalogo prodotti chimici per il trattamento delle acque, registrarsi come clienti B2B e — una volta approvate dall'amministratore — effettuare ordini online.

Il progetto unifica in un unico server Express:
- Il **sito istituzionale statico** (già esistente), servito alla root `/`
- Il **B2B Shop** dinamico, servito sotto `/shop`

---

## 2. Stack tecnologico

| Livello | Tecnologia |
|---------|-----------|
| Runtime | Node.js (v24) |
| Framework | Express 4 |
| Template engine | EJS (partials, nessun layout package) |
| ORM | Prisma 5 |
| Database | PostgreSQL (locale: `mfdepur_shop`) |
| Autenticazione | JWT (access token 15min, refresh token 7gg, httpOnly cookies) |
| Pagamenti | Stripe PaymentIntents + Elements |
| Email | Nodemailer (SMTP configurabile) |
| Upload file | Multer (immagini prodotti) |
| Sicurezza | Helmet (CSP), express-rate-limit, bcryptjs |
| CSS | Custom design system (`public/css/shop.css`) |
| Font | Mulish + Outfit (Google Fonts) — identici al sito di vetrina |
| Icone | FontAwesome 6.5 (cdnjs.cloudflare.com) |
| Dev | Nodemon |

---

## 3. Struttura del progetto

```
shop/
├── server.js                    # Entry point — avvio Express
├── package.json
├── .env                         # Variabili d'ambiente (non in git)
├── .env.example                 # Template variabili
│
├── prisma/
│   ├── schema.prisma            # Schema database
│   └── seed.js                  # Seed: admin + categorie + prodotto demo
│
├── src/
│   ├── app.js                   # Configurazione Express (middleware, routes)
│   ├── config/
│   │   └── database.js          # Istanza PrismaClient singleton
│   ├── middleware/
│   │   └── auth.js              # requireAuth, requireAdmin, requireApprovedCompany, injectUser
│   ├── controllers/
│   │   ├── authController.js    # Login, register, verify, logout, forgot/reset password
│   │   ├── productController.js # Catalogo pubblico + CRUD admin prodotti/categorie
│   │   ├── cartController.js    # Carrello (add, update, remove, clear)
│   │   ├── orderController.js   # Checkout, Stripe webhook, storico ordini
│   │   └── adminController.js   # Dashboard, gestione ordini/aziende, upload Multer
│   ├── routes/
│   │   ├── auth.js              # /auth/*
│   │   ├── shop.js              # /shop/*
│   │   ├── account.js           # /account/*
│   │   └── admin.js             # /admin/*
│   └── utils/
│       └── email.js             # Helper Nodemailer (verifica, reset password, notifiche)
│
├── views/
│   ├── partials/
│   │   ├── _header.ejs          # Navbar shop (glass bianca, responsive)
│   │   ├── _footer.ejs          # Footer shop
│   │   ├── _admin-header.ejs    # Layout admin con sidebar
│   │   └── _admin-footer.ejs    # Chiusura layout admin
│   ├── auth/
│   │   ├── login.ejs
│   │   ├── register.ejs
│   │   ├── register-success.ejs
│   │   ├── verify-success.ejs / verify-error.ejs
│   │   ├── pending.ejs          # Azienda non ancora approvata
│   │   ├── forgot-password.ejs
│   │   └── reset-password.ejs
│   ├── shop/
│   │   ├── catalog.ejs          # Catalogo con filtri e paginazione
│   │   ├── product.ejs          # Dettaglio prodotto
│   │   ├── cart.ejs             # Carrello
│   │   ├── checkout.ejs         # Checkout (Stripe + bonifico)
│   │   └── order-success.ejs    # Conferma ordine
│   ├── account/
│   │   ├── dashboard.ejs
│   │   ├── orders.ejs
│   │   ├── order-detail.ejs
│   │   ├── profile.ejs
│   │   └── addresses.ejs
│   ├── admin/
│   │   ├── dashboard.ejs        # KPI + ordini recenti + prodotti sotto soglia
│   │   ├── orders.ejs / order-detail.ejs
│   │   ├── companies.ejs / company-detail.ejs
│   │   ├── products.ejs / product-form.ejs (create + edit)
│   │   └── categories.ejs
│   └── error.ejs
│
├── public/
│   ├── index.html               # Sito istituzionale statico (copiato da MFDEPUR/)
│   ├── assets/                  # CSS e JS del sito statico
│   ├── css/
│   │   └── shop.css             # Design system dello shop
│   ├── js/
│   │   ├── shop.js              # JS frontend: carrello AJAX, toast, qty control
│   │   └── checkout.js          # Stripe Elements: mount, confirm, redirect
│   └── img/
│
└── uploads/                     # Immagini prodotti caricate (Multer)
```

---

## 4. Database — Modello dati

### Enum

| Enum | Valori |
|------|--------|
| `Role` | `CUSTOMER`, `ADMIN` |
| `CompanyStatus` | `PENDING`, `APPROVED`, `REJECTED`, `SUSPENDED` |
| `OrderStatus` | `PENDING`, `PAYMENT_FAILED`, `CONFIRMED`, `PROCESSING`, `SHIPPED`, `DELIVERED`, `CANCELLED`, `REFUNDED` |
| `PaymentMethod` | `STRIPE`, `BANK_TRANSFER` |

### Modelli principali

**Company** — Azienda cliente
`id`, `name`, `vatNumber` (unique), `fiscalCode`, `sdiCode`, `pec`, `phone`, `website`, `status`, `notes`
→ ha molti `User`, `Order`, `Address`

**User** — Utente
`id`, `email` (unique), `password` (hash bcrypt), `firstName`, `lastName`, `phone`, `role`, `isEmailVerified`, `emailVerifyToken`, `resetPasswordToken/Expires`, `lastLoginAt`
→ appartiene a una `Company`, ha un `Cart`, molti `Order`, molti `Session`

**Session** — Refresh token
`id`, `userId`, `refreshToken` (unique), `expiresAt`

**Category** — Categoria prodotto
`id`, `name`, `slug` (unique), `description`, `imageUrl`, `sortOrder`

**Product** — Prodotto
`id`, `name`, `slug` (unique), `description`, `shortDesc`, `price` (Decimal 10,2), `comparePrice`, `sku` (unique), `stock`, `lowStockAlert`, `unit`, `minOrderQty`, `isActive`, `isFeatured`, `priceOnRequest` (Boolean, default false), `imageUrl`, `images[]`, `features[]`, `technicalSheet`
→ se `priceOnRequest = true`: nel catalogo e nel dettaglio viene mostrato "Contattaci per un preventivo" con link mailto, il prodotto non può essere aggiunto al carrello

**Cart / CartItem** — Carrello persistente per utente
`Cart`: 1:1 con User | `CartItem`: prodotto + quantità, unique su (cartId, productId)

**Address** — Indirizzo di spedizione dell'azienda
`label`, `street`, `city`, `province`, `postalCode`, `country`, `isDefault`

**Order** — Ordine
`orderNumber` (es. `MFD-2024-0001`), `status`, `paymentMethod`, `paymentIntentId` (Stripe), `subtotal`, `taxRate` (22%), `taxAmount`, `shippingCost`, `total`, `notes`, `adminNotes`, `trackingNumber`, `paidAt`, `shippedAt`, `deliveredAt`

**OrderItem** — Riga ordine (snapshot dati al momento dell'ordine)
`productName`, `productSku`, `unit`, `quantity`, `unitPrice`, `total`

---

## 5. Routing completo

### `/auth` — Autenticazione (nessun middleware)

| Metodo | Path | Descrizione |
|--------|------|-------------|
| GET | `/auth/login` | Form di login |
| POST | `/auth/login` | Login (rate limit: 10 req/15min) |
| GET | `/auth/register` | Form registrazione azienda |
| POST | `/auth/register` | Crea azienda + utente, invia email di verifica (rate limit: 5 req/h) |
| GET | `/auth/verify-email?token=...` | Verifica email |
| POST | `/auth/logout` | Cancella cookie + sessione DB |
| POST | `/auth/refresh` | Rinnova access token con refresh token |
| GET/POST | `/auth/forgot-password` | Richiesta reset password (rate limit: 5 req/h) |
| GET/POST | `/auth/reset-password?token=...` | Reset password con token |

### `/shop` — Shop (catalogo: pubblico; carrello/checkout: requireAuth + requireApprovedCompany)

| Metodo | Path | Auth | Descrizione |
|--------|------|------|-------------|
| GET | `/shop` | No | Catalogo con filtri categoria/ricerca e paginazione |
| GET | `/shop/product/:slug` | No | Dettaglio prodotto |
| GET | `/shop/cart` | Sì | Visualizza carrello |
| POST | `/shop/cart/add` | Sì | Aggiunge prodotto al carrello (AJAX) |
| POST | `/shop/cart/item/:id` | Sì | Aggiorna quantità (AJAX, ritorna JSON) |
| POST | `/shop/cart/item/:id/remove` | Sì | Rimuove item (AJAX, ritorna JSON) |
| POST | `/shop/cart/update` | Sì | Aggiorna quantità (form POST) |
| POST | `/shop/cart/remove` | Sì | Rimuove item (form POST) |
| POST | `/shop/cart/clear` | Sì | Svuota carrello |
| GET | `/shop/checkout` | Sì | Pagina checkout |
| POST | `/shop/checkout` | Sì | Crea ordine + PaymentIntent Stripe (ritorna JSON `{clientSecret, orderId}`) |
| GET | `/shop/checkout/success` | Sì | Conferma ordine |
| GET | `/shop/checkout/cancel` | Sì | Annullamento checkout |

### `/account` — Area clienti (requireAuth)

| Metodo | Path | Descrizione |
|--------|------|-------------|
| GET | `/account` | Dashboard account |
| GET | `/account/orders` | Lista ordini (requireApprovedCompany) |
| GET | `/account/orders/:id` | Dettaglio ordine (requireApprovedCompany) |
| GET | `/account/profile` | Profilo utente |
| POST | `/account/profile` | Aggiorna nome/cognome/telefono |
| GET | `/account/addresses` | Lista indirizzi azienda |
| POST | `/account/addresses` | Crea nuovo indirizzo |
| POST | `/account/addresses/:id/delete` | Elimina indirizzo |

### `/admin` — Pannello amministrazione (requireAuth + requireAdmin)

| Metodo | Path | Descrizione |
|--------|------|-------------|
| GET | `/admin` | Dashboard: KPI, ordini recenti, prodotti sotto scorta |
| GET | `/admin/orders` | Lista ordini con filtri |
| GET | `/admin/orders/:id` | Dettaglio ordine |
| POST | `/admin/orders/:id/status` | Aggiorna stato ordine (+ trackingNumber, adminNotes) |
| GET | `/admin/companies` | Lista aziende con filtri |
| GET | `/admin/companies/:id` | Dettaglio azienda |
| POST | `/admin/companies/:id/status` | Approva/rifiuta/sospendi azienda |
| GET | `/admin/products` | Lista prodotti |
| GET | `/admin/products/new` | Form nuovo prodotto |
| POST | `/admin/products` | Crea prodotto (con upload immagine) |
| GET | `/admin/products/:id/edit` | Form modifica prodotto |
| POST | `/admin/products/:id` | Aggiorna prodotto |
| POST | `/admin/products/:id/delete` | Disattiva prodotto (soft delete) |
| POST | `/admin/products/:id/toggle` | Toggle isActive (AJAX) |
| GET | `/admin/categories` | Lista categorie |
| POST | `/admin/categories` | Crea categoria |
| POST | `/admin/categories/:id` | Aggiorna categoria |

### Pagine statiche

| Metodo | Path | Descrizione |
|--------|------|-------------|
| GET | `/privacy` | Pagina Privacy Policy (GDPR) |
| GET | `/sitemap.xml` | Sitemap dinamico (prodotti attivi + pagine statiche) |

### Carrello guest (non autenticato)

Il carrello è accessibile senza account. Gli articoli vengono salvati in `localStorage` (chiave `mfdepur_cart`) tramite il modulo `GuestCart` in `public/js/shop.js`.

**Flusso:**
1. Ospite clicca "Aggiungi al carrello" → item salvato in localStorage, badge aggiornato
2. `/shop/cart` è pubblico: il server renderizza uno scheletro vuoto, il JS lo popola da localStorage
3. Al checkout: pulsante "Accedi per completare l'ordine" → redirect a `/auth/login?redirect=/shop/cart`
4. Dopo il login: auto-merge automatico (`autoMergeGuestCart`) — ogni item localStorage viene POSTato su `/shop/cart/add` (richiede azienda approvata), poi localStorage viene svuotato
5. Utenti con company PENDING: localStorage conservato, merge avviene solo dopo approvazione

**Visibilità bottone carrello:**
- Ospite → "Aggiungi al carrello" (localStorage)
- Loggato + approvato → "Aggiungi al carrello" (DB)
- Loggato + non approvato → "Account in attesa" (nessuna azione)
- Prodotto esaurito → badge "Esaurito"
- Prodotto su richiesta → "Contattaci" (mailto)

### `/stripe/webhook` — Webhook Stripe (raw body, nessun auth)

Gestisce gli eventi `payment_intent.succeeded` e `payment_intent.payment_failed` per aggiornare automaticamente lo stato degli ordini.

---

## 6. Autenticazione e autorizzazione

### Flusso JWT

1. Login → genera **access token** (JWT, 15min) e **refresh token** (JWT, 7gg)
2. Entrambi salvati come httpOnly cookie (`accessToken`, `refreshToken`)
3. Il refresh token viene anche salvato in DB (`Session`) per poter essere revocato
4. `POST /auth/refresh` → verifica refresh token in DB, emette nuovi token
5. Logout → cancella cookie + elimina la riga `Session` dal DB

### Middleware

- **`injectUser`** (globale): legge il token dal cookie, popola `res.locals.currentUser` e `res.locals.cartCount` senza bloccare la richiesta
- **`requireAuth`**: richiede token valido, redirige a `/auth/login` se assente
- **`requireApprovedCompany`**: richiede che `company.status === 'APPROVED'` (o `role === 'ADMIN'`), altrimenti mostra `/auth/pending`
- **`requireAdmin`**: richiede `role === 'ADMIN'`, altrimenti 403

### Registrazione azienda

Il flusso di onboarding è:
1. Utente compila il form con dati azienda (ragione sociale, P.IVA, SDI, PEC) + dati personali
2. Sistema crea `Company` (status: `PENDING`) + `User` + invia email di verifica
3. Utente clicca il link → `isEmailVerified = true`
4. **L'admin approva manualmente** la company dal pannello admin
5. Solo dopo l'approvazione l'utente può accedere al carrello e al checkout

---

## 7. Flusso di pagamento (Stripe)

```
1. GET  /shop/checkout         → render pagina con Stripe public key
2. checkout.js (browser)       → monta Stripe Elements (card)
3. Utente seleziona metodo:
   ├─ Carta di credito:
   │   POST /shop/checkout      → crea Order (PENDING) + PaymentIntent Stripe
   │                             → risponde JSON { clientSecret, orderId }
   │   stripe.confirmCardPayment(clientSecret) → Stripe gestisce 3DS
   │   redirect → /shop/checkout/success?orderId=...
   └─ Bonifico bancario:
       POST /shop/checkout      → crea Order (CONFIRMED, paymentMethod: BANK_TRANSFER)
       redirect → /shop/checkout/success
4. Stripe webhook → payment_intent.succeeded → Order.status = CONFIRMED, paidAt = now
5. Stripe webhook → payment_intent.payment_failed → Order.status = PAYMENT_FAILED
```

**Calcolo totale ordine:**
- Subtotale: somma (unitPrice × quantity) per ogni item
- IVA: 22% sul subtotale
- Spedizione: calcolata dal controller (attualmente 0 per ordini sopra soglia)
- Totale: subtotale + IVA + spedizione

---

## 8. Catalogo prodotti — Visibilità

| Funzionalità | Guest | Utente non approvato | Utente approvato |
|---|---|---|---|
| Visualizza catalogo | ✅ | ✅ | ✅ |
| Visualizza dettaglio prodotto | ✅ | ✅ | ✅ |
| Vede il prezzo | ✅ | ✅ | ✅ |
| Aggiunge al carrello | ❌ (→ login) | ❌ (→ pending) | ✅ |
| Accede al checkout | ❌ | ❌ | ✅ |

---

## 9. Design system

Lo shop utilizza lo stesso design system del sito istituzionale per garantire continuità visiva.

### Font
- **Mulish** (testi, peso 300–800) — Google Fonts
- **Outfit** (titoli/display, peso 300–700) — Google Fonts

### Palette colori
```css
--blue-50:  #e3f2fd   /* sfondi chiari */
--blue-100: #bbdefb   /* bordi, separatori */
--blue-500: #2196f3   /* accent */
--blue-700: #1976d2   /* primary (pulsanti, link) */
--blue-800: #1565c0   /* primary-dark */
--blue-900: #0d47a1   /* navbar admin, footer, hero */
```

### Navbar shop
Identica allo stato "scrolled" della navbar del sito istituzionale:
- Background: `rgba(255,255,255,0.92)` con `backdrop-filter: blur(16px)`
- Logo + link navigazione + hamburger mobile
- Sticky in cima alla pagina

### Hero banner
Le pagine del catalogo mostrano un banner blu con gradiente (`--blue-900 → --blue-500`) come intestazione di sezione, coerente con il design del sito di vetrina.

### Componenti principali
- `.product-card` — card prodotto con hover lift e immagine con zoom
- `.btn`, `.btn-primary`, `.btn-outline`, `.btn-sm`, `.btn-lg` — sistema bottoni pill
- `.alert-*` — notifiche colorate
- `.badge-*` — chip/pill per stati
- `.toast` — notifiche toast (bottom-right)
- `.cart-summary`, `.checkout-summary` — sidebar sticky per totali
- `.admin-layout` — grid sidebar+main per il pannello admin

---

## 10. Sicurezza

| Misura | Dettaglio |
|--------|-----------|
| Helmet CSP | imgSrc: self + mfdepur.com + www.mfdepur.com; scriptSrc: self + Stripe + jsdelivr + unpkg + cdnjs; fontSrc: gstatic + cdnjs |
| Rate limiting | Login: 10 req/15min; Register + forgot-password: 5 req/h |
| Password | bcryptjs con salt rounds 12 |
| JWT | httpOnly cookie, non accessibili da JS |
| Refresh token | Salvato in DB — revocabile dal server |
| CSRF | Mitigato da SameSite cookie + no GET mutanti |
| Upload | Multer: solo immagini (mimetype check), max 5MB, salvate in `/uploads/` |
| SQL injection | Impossibile — Prisma usa query parametrizzate |
| Stripe webhook | Verificato con `stripe.webhooks.constructEvent` + `STRIPE_WEBHOOK_SECRET` |
| GDPR | Privacy Policy a `/privacy`; consenso obbligatorio nel form di registrazione; cookie tecnici httpOnly (no cookie di profilazione, no banner richiesto) |

---

## 11. Variabili d'ambiente

File: `.env` (basato su `.env.example`)

```env
DATABASE_URL="postgresql://user:password@localhost:5432/mfdepur_shop"
PORT=3000
NODE_ENV=development
BASE_URL=http://localhost:3000

JWT_SECRET=<stringa casuale lunga>
JWT_EXPIRES_IN=15m
JWT_REFRESH_SECRET=<stringa casuale lunga>
JWT_REFRESH_EXPIRES_IN=7d

STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PUBLISHABLE_KEY=pk_test_...

EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=tua@email.com
EMAIL_PASS=app_password
EMAIL_FROM="MF Depur <noreply@mfdepur.com>"

ADMIN_EMAIL=admin@mfdepur.com
ADMIN_PASSWORD=CambiaSubito!123

UPLOAD_MAX_SIZE_MB=5
```

---

## 12. Comandi utili

```bash
# Avvio in sviluppo (auto-reload)
npm run dev

# Avvio in produzione
npm start

# Migrazioni database
npm run db:migrate

# Push schema senza migration (sviluppo rapido)
npm run db:push

# Seed (admin + categorie + prodotto demo)
npm run db:seed

# Prisma Studio (GUI database)
npm run db:studio
```

---

## 13. Credenziali di accesso

> ⚠️ Da cambiare prima del deploy in produzione

### Admin

| Campo | Valore |
|-------|--------|
| Email | `admin@mfdepur.com` |
| Password | `CambiaSubito!123` |
| URL admin | `http://localhost:3000/admin` |

### Aziende mock (per test)

| Email | Password | Azienda | Stato |
|-------|----------|---------|-------|
| `mario.rossi@acquatech.it` | `Demo1234!` | Acquatech S.r.l. | APPROVED — può ordinare |
| `giulia.bianchi@depnord.it` | `Demo1234!` | Industrie Depurazione Nord S.p.A. | PENDING — in attesa di approvazione |

---

## 14. Integrazione con il sito istituzionale

Il sito statico di MF Depur (`public/index.html` e `public/assets/`) è servito dallo stesso processo Express tramite `express.static`. Le modifiche apportate al sito statico:

- Aggiunto pulsante **"🛒 Shop B2B"** nella navbar desktop e nel menu mobile
- Stile del pulsante coerente con la navbar del sito (`nav-shop-btn`, `mobile-shop-link`)

La navigazione tra i due contesti:
- Sito → Shop: clic su "Shop B2B" → `/shop`
- Shop → Sito: clic su "← Sito" nella navbar dello shop → `/`

---

## 15. Note mobile (responsive)

- Navbar: hamburger a 960px, menu mobile overlay
- Catalogo: sidebar categorie impilata sopra griglia prodotti su mobile
- Carrello: tabella con `overflow-x: auto` e `min-width: 520px` per scorrimento orizzontale
- Admin: sidebar nascosta a 960px; pulsante "Menu" nella topbar apre un drawer mobile con overlay
- Toast: full-width su schermi < 640px (non più ancorato a destra)
- Prodotti grid: 2 colonne a 640px, 1 colonna a 400px

---

## 16. To-do per il deploy in produzione

- [ ] Sostituire le chiavi Stripe test con quelle live
- [ ] Configurare SMTP reale (es. SES, Brevo, SMTP aziendale)
- [ ] Impostare `NODE_ENV=production` e `BASE_URL` con il dominio reale
- [ ] Generare `JWT_SECRET` e `JWT_REFRESH_SECRET` casuali (min 64 caratteri)
- [ ] Configurare Stripe webhook con l'URL pubblico (`https://dominio.com/stripe/webhook`)
- [ ] Puntare `DATABASE_URL` al database PostgreSQL di produzione
- [ ] Cambiare la password admin di default
- [ ] Abilitare HTTPS (reverse proxy Nginx/Caddy raccomandato)
- [ ] Montare `/uploads/` su storage persistente (es. volume Docker o S3)
