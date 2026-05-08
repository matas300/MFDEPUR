# Go-live MVP — Design

**Data:** 2026-05-08
**Stato:** in review
**Branch corrente:** feat/catalog-cleaning-industrial
**Riferimenti:** `docs/audit/2026-04-23/99-MASTER.md`, `docs/DEPLOYMENT.md`

## Obiettivo

Portare lo shop B2B `mfdepur.com` in produzione entro 1-2 settimane, con costi infrastruttura sotto 50€/mese e operatività sostenibile per single-admin + consulente esterno.

## Vincoli

- Tempo: go-live in 1-2 settimane.
- Budget infrastruttura: <50€/mese.
- Solo bonifico bancario come metodo di pagamento (rimosso Stripe).
- Fattura elettronica gestita inizialmente dal commercialista del cliente, in seguito da codice XML preesistente fornito dal cliente.
- Sito statico vetrina `www.mfdepur.com` su Hostinger resta immutato (logo e contenuti vetrina).
- Italian B2B HoReCa, niente clienti UE/PA per ora.

## Decisioni chiave

| Area | Scelta | Motivazione |
|---|---|---|
| Hosting Node | Hetzner CX22 (Ubuntu 24.04) | 4.51€/mese, EU, performance/€ ottimo. Single-VPS sufficiente per volume MVP |
| Database | Postgres 16 self-hosted sullo stesso VPS | 0€ extra, no scale-to-zero, latenza zero verso Node |
| Reverse proxy | Caddy | Auto-HTTPS Let's Encrypt zero-config |
| Process manager | PM2 cluster mode | Già documentato in DEPLOYMENT.md, zero-downtime reload |
| DNS + WAF + CDN | Cloudflare Free | DDoS, cache asset, gratis, nasconde IP origin |
| Pagamenti | Solo bonifico bancario (BANK_TRANSFER) | Standard B2B IT, zero fee, semplifica codebase eliminando Stripe |
| Fatturazione MVP | Export CSV settimanale al commercialista | Fast-path legale, niente integrazione SDI inline |
| Fatturazione fase 2 | Codice XML cliente integrato post go-live | Preesistente, da agganciare a `_finalizeOrder` quando consolidato |
| Email transazionale | Brevo Free + from `info@mfdepur.com` | 300/giorno gratis, EU-based, deliverability monitorabile |
| Storage uploads | Filesystem VPS (`/opt/mfdepur/shop/uploads`) | Multer già configurato, Cloudflare cache CDN, zero costo. Migrazione a object storage rinviata |
| Backup DB | `pg_dump` giornaliero cifrato GPG → Backblaze B2 | 0-1.50€/mese, retention 30gg |
| Backup uploads | Tar settimanale cifrato GPG → Backblaze B2 | retention 12 settimane |
| Snapshot VPS | Hetzner snapshot settimanale | +0.50€/mese, restore VPS completo in 5 min |
| Monitoring errori | Sentry Developer Free | 5k errori/mese, già in deps |
| Uptime monitoring | UptimeRobot Free | 50 monitor, check ogni 5 min, app mobile push |
| Log management | PM2 logrotate locale | 30 file/30 giorni, compresso. Aggregation post go-live se serve |
| Secrets management | File `.env` su VPS, permessi 600, backup GPG separato | Adeguato per single-admin. Vault solo se team multi-persona |
| CI/CD deploy | Manuale via SSH + procedura DEPLOYMENT.md | Single-VPS, deploy frequenza bassa. Auto-deploy GitHub Actions in M7 |
| URL produzione | `shop.mfdepur.com` | Sottodominio dedicato, statico vetrina invariato |
| GDPR/legal | Privacy/Termini/Cookie da template gratuiti, revisione cliente | No Iubenda. Footer con dati societari obbligatori |

**Costo totale infrastruttura: ~5-7€/mese.**

## Architettura

### Diagramma

```
                            Internet
                                │
                        Cloudflare DNS + Free CDN/WAF
                                │
                ┌───────────────┴───────────────┐
                │                               │
        www.mfdepur.com                  shop.mfdepur.com
        (A → Hostinger)                  (A → IP Hetzner, proxied)
                │                               │
        Hostinger statico                Hetzner CX22 (Ubuntu 24.04)
        (vetrina, immutato)              ┌─────────────────────┐
                                         │ Caddy               │ ← TLS Let's Encrypt
                                         │  └─→ PM2 cluster    │
                                         │       └─→ Node 20   │
                                         │             └─→ socket
                                         │                  ↓
                                         │ Postgres 16 (127.0.0.1:5432)
                                         │ /var/lib/postgresql
                                         │
                                         │ /opt/mfdepur/shop/uploads
                                         └─────────┬───────────┘
                                                   │ pg_dump + tar
                                                   │ daily/weekly
                                                   ▼
                                         Backblaze B2 (GPG-encrypted)
```

### Componenti & costi mensili

| Componente | Provider | € / mese |
|---|---|---|
| VPS (2vCPU, 4GB RAM, 40GB SSD) | Hetzner CX22 | 4.51 |
| Snapshot settimanale | Hetzner | ~0.50 |
| Backup storage | Backblaze B2 | 0-1.50 |
| DNS + WAF base + CDN | Cloudflare Free | 0 |
| Email transazionale | Brevo Free | 0 |
| Error tracking | Sentry Free | 0 |
| Uptime monitoring | UptimeRobot Free | 0 |
| Postgres | Self-hosted | 0 |
| SSL | Let's Encrypt via Caddy | 0 |
| **Totale** | | **~5-7** |

### Region scelta

Tutto su Europa centrale per latenza IT bassa e GDPR nativo:

- Hetzner Falkenstein (Germania)
- Backblaze B2 EU-Central-1 (Amsterdam) o equivalente
- Brevo Francia (server hosting)
- Cloudflare network globale
- Sentry EU (selezione esplicita all'account creation)

## Modifiche codebase

### Schema Prisma

```diff
 model Order {
-  status           String  @default("PENDING")
-  paymentMethod    String  @default("STRIPE")
-  paymentIntentId  String?
+  status           String  @default("PENDING_PAYMENT")
+  // PENDING_PAYMENT, AWAITING_APPROVAL, CONFIRMED, PROCESSING, SHIPPED, DELIVERED, CANCELLED, REFUNDED
+  paymentMethod    String  @default("BANK_TRANSFER")
+  paymentReference String?  // CRO bonifico, inserito da admin alla riconciliazione
   ...
 }
```

Status `PAYMENT_FAILED` rimosso (non applicabile senza Stripe). Default `PENDING_PAYMENT` per ordini nuovi.

### Dipendenze

```diff
- "stripe": "^14.17.0"
```

Mantenute tutte le altre.

### Codice da rimuovere

Stripe non è isolato in un service dedicato; è disseminato nei seguenti file:

| File | Cosa rimuovere |
|---|---|
| `shop/src/app.js` | Middleware rawBody capture (~righe 25-50), mount `app.post('/stripe/webhook', …)` (~righe 60-64), entry CSP `js.stripe.com` / `api.stripe.com` (scriptSrc, frameSrc, connectSrc) |
| `shop/src/controllers/orderController.js` | `require('stripe')` linea 2, `stripePublicKey` in render checkout, branch `if paymentMethod === 'STRIPE'` per `paymentIntents.create`, intera funzione `exports.stripeWebhook` |
| `shop/src/controllers/adminController.js` | Mapping `'STRIPE' ? 'Carta' : 'Bonifico'` in CSV export → diventa solo "Bonifico" |
| `shop/src/config/env.js` | Entries `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET` dal fail-fast check |
| `shop/src/config/constants.js` | Commento status enum riferimento Stripe |
| Test M4 | Test webhook Stripe in `shop/test/` (verificare path effettivo) |
| `package.json` | Dependency `stripe ^14.17.0` |

### Codice nuovo

| File / area | Cosa |
|---|---|
| `src/routes/checkout.js` (modifica) | Submit ordine → `PENDING_PAYMENT` + email IBAN cliente |
| `src/routes/admin.orders.js` (modifica) | Endpoint `POST /admin/orders/:id/mark-paid` con CRO + audit log `PAYMENT_CONFIRMED` |
| `src/views/admin/orders/_mark-paid.ejs` (nuovo) | Modal admin per riconciliazione bonifico |
| `src/services/email/templates/order-confirmation.ejs` (modifica) | Includere IBAN, beneficiario, causale |
| `src/services/email/templates/payment-received.ejs` (nuovo) | Email cliente "pagamento ricevuto" |
| `src/jobs/weeklyAccountantExport.js` (nuovo) | Cron settimanale CSV → email commercialista |
| `shop/src/utils/storage.js` (nuovo) | Centralizzare path uploads (oggi inline nel multer config) per future migration object storage. File NON esiste oggi, da creare |

### ENV produzione complete

```env
# App
NODE_ENV=production
PORT=3000
APP_URL=https://shop.mfdepur.com

# Database (self-hosted Postgres su localhost)
DATABASE_URL=postgresql://mfdepur:<password>@127.0.0.1:5432/mfdepur_prod

# JWT
JWT_SECRET=<32+ char hex>
JWT_REFRESH_SECRET=<32+ char hex, diverso>
CSRF_SECRET=<32+ char hex>

# Bonifico
BANK_BENEFICIARY="MF Depur Srl"
BANK_IBAN="IT60 X054 ..."
BANK_NAME="..."
BANK_BIC="..."

# Email transazionale (Brevo)
SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=587
SMTP_USER=<account-id>@smtp-brevo.com
SMTP_PASS=<smtp-key>
EMAIL_FROM="MF Depur <info@mfdepur.com>"
EMAIL_REPLY_TO=info@mfdepur.com
ADMIN_NOTIFY_EMAIL=info@mfdepur.com
ACCOUNTANT_EMAIL=<email commercialista>
ACCOUNTANT_NAME=<nome studio>

# Backup B2
B2_KEY_ID=<application-key-id>
B2_APP_KEY=<application-key>
B2_BUCKET=mfdepur-backups
GPG_RECIPIENT=backup@mfdepur.com

# Uploads
UPLOAD_PATH=/opt/mfdepur/shop/uploads

# Monitoring
SENTRY_DSN=https://xxx@xxx.ingest.sentry.io/xxx
SENTRY_ENVIRONMENT=production
SENTRY_RELEASE=<git-sha>
LOG_LEVEL=info

# Admin seed (one-time)
ADMIN_PASSWORD=<strong>
```

## Workflow funzionali

### Workflow ordine cliente

1. Cliente compila carrello, fa checkout, sceglie indirizzo, conferma.
2. Submit → ordine creato, status `PENDING_PAYMENT`.
3. Pagina conferma mostra: numero ordine `MFD-YYYY-NNNNN`, totale, IBAN, beneficiario, causale, tempi spedizione.
4. Email automatica al cliente con stesse info (template italiano).
5. Email notifica admin "nuovo ordine".
6. Cliente paga via home banking.

### Workflow riconciliazione admin

1. Admin verifica estratto conto (manuale per ora).
2. Su `/admin/orders` lista ordini `PENDING_PAYMENT`.
3. Click "Marca pagato" → modal con data, CRO opzionale, importo precompilato (warning se mismatch).
4. Submit → status `CONFIRMED`, `paidAt = now`, `paymentReference = CRO`. Audit log entry `PAYMENT_CONFIRMED`.
5. Email cliente "pagamento ricevuto, ordine in preparazione".
6. Admin spedisce → manual update `SHIPPED` con tracking (M6 T4 esistente).

### Workflow fattura — fase 1 (commercialista)

Cron lunedì 08:00 UTC:

1. Query ordini con `status >= CONFIRMED` nella settimana precedente.
2. Genera CSV: `orderNumber, createdAt, paidAt, ragioneSociale, vatNumber, sdiCode/pec, indirizzo, righe, subtotal, taxAmount, total, paymentReference`.
3. Email automatica al commercialista con CSV allegato.
4. Audit log `WEEKLY_INVOICE_EXPORT`.
5. Commercialista emette fatture a SDI dal proprio gestionale.

### Workflow fattura — fase 2 (XML inline, post go-live)

Quando il cliente fornisce il codice XML:

1. Aggiunto modello `Invoice` (numero progressivo, xmlContent, status, sdiResponse).
2. Generazione XML inline al `_finalizeOrder` async (non blocca la response).
3. Upload manuale dashboard AdE oppure canale diretto se disponibile.
4. Conservazione 10 anni (filesystem VPS + B2 backup, art. 2220 c.c.).
5. UI admin per scaricare XML/PDF fattura.

## DNS records

### Cloudflare DNS per `mfdepur.com`

| Type | Name | Value | Proxied | Note |
|---|---|---|---|---|
| A | shop | `<IP Hetzner>` | ✅ | Shop B2B |
| CNAME | www | (esistente Hostinger) | ❌ | DNS only, non proxied per non interferire con Hostinger |
| MX | @ | (esistente Hostinger) | ❌ | Mailbox info@ resta su Hostinger |
| TXT | @ | `v=spf1 include:spf.brevo.com -all` | — | SPF Brevo |
| TXT | mail._domainkey | `<DKIM key Brevo>` | — | DKIM |
| TXT | _dmarc | `v=DMARC1; p=quarantine; rua=mailto:dmarc@mfdepur.com; pct=100; adkim=s; aspf=s` | — | DMARC |

**Importante:** se Hostinger usa SPF proprio per email outbound da `info@mfdepur.com`, lo SPF Brevo va combinato (`v=spf1 include:spf.brevo.com include:_spf.hostinger.com -all`) per evitare di rompere mailbox esistente.

### Cloudflare SSL/TLS

- Mode: **Full (strict)**
- Always Use HTTPS: ON
- HSTS: max-age=31536000, includeSubDomains, preload
- Min TLS: 1.2
- Bot Fight Mode: ON
- Browser Integrity Check: ON

### Cloudflare cache rules

- `/uploads/*` → cache 30 giorni Edge
- `/css/*`, `/js/*`, `/images/*` → cache 7 giorni
- HTML dinamico → no cache (default)

### Rate limit Cloudflare (Free, 1 rule)

- `/auth/login`: max 100 req/10min per IP (in aggiunta al rate limit Express)

## Backup & restore

### Backup pipeline

| Cosa | Cadenza | Comando | Destinazione | Retention |
|---|---|---|---|---|
| DB Postgres | giornaliero 03:00 UTC | `pg_dump -Fc → gzip → gpg → b2 upload` | B2 `db/YYYYMMDD.sql.gz.gpg` | 30 giorni |
| Uploads | settimanale domenica 04:00 | `tar -czf - uploads → gpg → b2 upload` | B2 `uploads/YYYY-Www.tar.gz.gpg` | 12 settimane |
| Mensile DB snapshot | primo del mese | come daily, tag `monthly/` | B2 `db/monthly/YYYY-MM.sql.gz.gpg` | 12 mesi |
| `.env` | manuale post modifica | `gpg --encrypt .env` | repo privato GitHub o 1Password | indefinito |
| VPS snapshot | settimanale (Hetzner panel) | API Hetzner | Hetzner | 4 snapshot ruotanti |
| Codice | continuo | `git push origin master` | GitHub | indefinito |

### Cifratura

GPG key dedicata `backup@mfdepur.com`. Passphrase forte. Chiave privata salvata su 1Password + copia cartacea in cassaforte cliente. Senza chiave i backup sono inutili.

### Restore drill

| Cadenza | Cosa |
|---|---|
| Pre go-live (una tantum, bloccante) | Restore completo DB + uploads su VPS di prova, smoke test app |
| Mensile | Smoke: scarica ultimo backup, decifra, verifica integrità (no full restore) |
| Trimestrale | Restore completo end-to-end cronometrato. RTO target <4h |

## Sicurezza

### Già in codebase (M0/M1/M3/M4/M5/M6)

- Helmet CSP nonce-based, frame-ancestors self
- HTTPS redirect prod + HSTS 1y
- CSRF double-submit (csrf-csrf v4)
- JWT in httpOnly cookie, refresh DB-backed revocabile
- Bcrypt cost 12, password policy 10+ABC123
- Rate limit auth endpoints
- Multer memoryStorage + magic-byte check + UUID filename
- Audit log su azioni admin
- Stripe webhook fail-close (rimosso con Stripe)
- GDPR export/delete (Art. 15/17/20)
- Approval workflow company AWAITING_APPROVAL
- RBAC companyRole
- Sentry instrumentation
- Test suite Vitest + GitHub Actions CI

### Non bloccanti go-live (M7 / post)

- 2FA admin TOTP
- HIBP password check al register/reset
- CSP styleSrc senza unsafe-inline (refactor 207 inline `style=""`)
- OWASP ZAP baseline in CI
- BullMQ + Redis per email queue
- Auto-riconciliazione bonifici via API banca
- Session blacklist on logout

### Cloudflare contributo

- DDoS protection automatico
- Hide origin IP (attaccanti non vedono Hetzner)
- Bot Fight Mode
- WAF managed rules: solo Pro plan, valutare post go-live se vediamo attacchi

### Secrets rotation

| Segreto | Cadenza |
|---|---|
| `JWT_SECRET`, `JWT_REFRESH_SECRET`, `CSRF_SECRET` | 90 giorni |
| `SMTP_PASS` Brevo | 12 mesi |
| DB password Postgres | 6 mesi |
| B2 application key | 12 mesi |

## Monitoring

### Sentry

- Plan: Developer Free (5k errori/mese)
- Project: `mfdepur-shop-prod`
- Alert email a `info@mfdepur.com` su nuovi tipi errore + spike (>10/5min)
- DSN in ENV `SENTRY_DSN`

### UptimeRobot

- Plan: Free, 50 monitor, check 5 min
- Monitor:
  - `https://shop.mfdepur.com/healthz` (cheap, no DB)
  - `https://shop.mfdepur.com/health` (incluso DB, timeout 10s)
  - `https://www.mfdepur.com` (statico)
- Alert: email + push UptimeRobot mobile app
- (opz) status page pubblica `status.mfdepur.com`

### Log

PM2 logrotate:

```
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 30
pm2 set pm2-logrotate:compress true
pm2 set pm2-logrotate:rotateInterval '0 0 * * *'
```

Log aggregation aggregato (BetterStack Logtail o equivalente) post go-live se serve grep cross-day.

### Health check

`/healthz` (M3 esistente): 200 process alive.
`/health` (M3 esistente): 200 con DB ping ok, 503 se DB down. UptimeRobot pingerà entrambi.

### Alert / paging

| Severità | Trigger | Canale |
|---|---|---|
| SEV1 | UptimeRobot down >10 min, Sentry critical spike | Email + push UptimeRobot mobile |
| SEV2 | Sentry singolo errore nuovo, certificato in scadenza <7gg | Email |
| SEV3 | Trend warning, dependency CVE | Email weekly digest |

On-call primary: tu (consulente). Secondary: cliente per copia notifiche (no intervento tecnico). Definire telefono esplicito prima del go-live in `DEPLOYMENT.md`.

## CI/CD

### Stato attuale (M4)

GitHub Actions:
- `npm test` (Vitest 17 test verdi) su PR
- `npm run lint` su PR

### Go-live: deploy manuale

```bash
# Sul VPS, da deploy user
cd /opt/mfdepur/shop
git fetch --tags
git checkout vX.Y.Z
npm ci --omit=dev
npx prisma migrate deploy
pm2 reload mfdepur-shop --update-env
curl -sS https://shop.mfdepur.com/health | jq .
```

### Branch strategy

- `master` → produzione, ogni rilascio taggato `vX.Y.Z`
- `feat/*` → feature branch con CI verde prima del merge
- `hotfix/*` → fix urgenti su master, tag `vX.Y.Z+1`

### Auto-deploy (post go-live)

Workflow GitHub Actions che SSH-runna lo script su tag push. ~1 giornata di lavoro in M7.

## Shopping list

Cose da registrare/comprare prima del go-live:

| # | Cosa | Dove | Costo iniziale | /mese | Setup |
|---|---|---|---|---|---|
| 1 | VPS Hetzner CX22 | https://console.hetzner.cloud | 0€ | 4.51€ | 10 min |
| 2 | Cloudflare account + dominio | https://dash.cloudflare.com | 0€ | 0€ | 30 min + propagazione |
| 3 | Brevo account + verifica dominio | https://app.brevo.com | 0€ | 0€ | 30 min |
| 4 | Sentry account + project | https://sentry.io | 0€ | 0€ | 10 min |
| 5 | UptimeRobot account + monitor | https://uptimerobot.com | 0€ | 0€ | 10 min |
| 6 | Backblaze B2 account + bucket | https://www.backblaze.com/b2 | 0€ | 0-1.50€ | 15 min |
| 7 | Snapshot Hetzner settimanali | console Hetzner | 0€ | ~0.50€ | 5 min |
| 8 | GPG key per backup | locale | 0€ | 0€ | 15 min |
| 9 | Verifica registrar dominio + 2FA + lock | (probabile Hostinger) | rinnovo annuale | — | 5 min |
| 10 | IBAN bonifico produzione | banca cliente MF Depur | — | — | info dal cliente |
| 11 | Email commercialista | richiesta cliente | — | — | info dal cliente |

**Totale costi infrastruttura: ~5-7€/mese.** Una tantum: 0€.

## Roadmap esecuzione (1-2 settimane)

### Settimana 1 — sviluppo + provisioning

- **Giorno 1-2:** code changes
  - Rimuovi Stripe (codice + dep + ENV)
  - Schema migration: `paymentMethod = BANK_TRANSFER`, `status = PENDING_PAYMENT`
  - Workflow checkout bonifico (UI + email IBAN)
  - Workflow admin "marca pagato" + audit log
- **Giorno 3:** code changes
  - Cron CSV settimanale al commercialista
  - Audit Sentry init + health check DB
- **Giorno 4:** infrastructure
  - Provisioning Hetzner CX22 (Ubuntu 24.04)
  - Setup base: deploy user, ssh-key only, ufw, fail2ban
  - Install Node 20 + Postgres 16 + Caddy + PM2
  - Cloudflare account + DNS migration
- **Giorno 5:** infrastructure
  - Brevo account + DNS records (SPF/DKIM/DMARC)
  - Backblaze B2 + GPG keys + script backup
  - Sentry + UptimeRobot setup
  - `.env` produzione popolata + backup cifrato

### Settimana 2 — deploy + smoke + cutover

- **Giorno 6-7:** deploy + smoke test
  - First deploy via DEPLOYMENT.md
  - Smoke end-to-end: register → checkout → admin pay → spedizione → email
  - mail-tester.com ≥9/10
  - Test restore DB da backup B2
- **Giorno 8:** content + legal
  - Privacy/Termini/Cookie da template gratuiti, revisione cliente
  - IBAN reale e dati societari in footer
  - Email commercialista in ENV
  - Catalogo prodotti reali caricati da admin
- **Giorno 9:** pre go-live
  - 2 ordini di test reali (cliente reale, account staging)
  - Verifica deliverability su 5 provider (Gmail, Outlook, libero, tiscali, pec)
  - Lighthouse / performance smoke
  - Update DEPLOYMENT.md contatti on-call reali
- **Giorno 10:** go-live
  - DNS `shop.mfdepur.com` → IP Hetzner (cutover finale)
  - Monitoring 24/48h post-launch attento
  - Backup test post primo ordine reale

**Cuscinetto:** 2-3 giorni di buffer per imprevisti (DNS lento, deliverability, bug emersi, risposte commercialista).

## Carico operativo a regime

### Persona A — admin MF Depur (cliente, business)

| Cadenza | Task | Tempo |
|---|---|---|
| Daily | Email, riconciliazione bonifici, spedizioni, customer care | ~30 min/giorno |
| Weekly | Approvazione aziende (P.IVA via VIES), review CSV commercialista, tracking corrieri, low-stock | ~1.5h/sett |
| Monthly | Aggiornamento catalogo, insoluti review, export CSV mese | ~3h/mese |
| Quarterly | Aggiornamento contenuti vetrina, audit prezzi | 2h/trim |

**Totale: ~19h/mese.** Cresce lineare con volume ordini. Soglia "risorsa dedicata part-time": >5 ordini/giorno.

### Persona B — sysadmin/dev (consulente)

| Cadenza | Task | Tempo |
|---|---|---|
| Daily | Sentry/UptimeRobot glance | ~5 min/giorno |
| Weekly | Log review, disk/RAM check, backup verify, npm audit, minor deps | ~45 min/sett |
| Monthly | Restore drill smoke, Sentry triage, security log review, 1 deploy minor | ~4h/mese |
| Quarterly | Restore drill completo cronometrato, secret rotation, CVE audit | ~5h/trim |
| Annual | Upgrade Node LTS, Postgres major, deps major, GPG renew | ~12h/anno |

**Totale: ~11-12h/mese.** Tradotto in fee tipo: ~720-1200€/mese canone manutenzione.

### Carico extra primi 60 giorni post go-live

Atteso più alto del regime: 2-3h/giorno tu (Persona B) prime 2 settimane per monitoraggio attento + bug fix edge case. Buffer una tantum: +20-40h primi 2 mesi.

### TCO mensile a regime stimato

```
Infrastruttura:           5-7 €
Lavoro admin cliente:    19h (interno)
Lavoro consulente:       12h × tariffa
─────────────────────────────────────
Totale:                  ~700-1100 €/mese
```

Solo ~5-7€ è infrastruttura. Il resto è tempo persone. Dimensionamento risorse interne va proporzionato al volume ordini effettivo.

### Investimenti riducono il carico nel tempo

| Investimento | Riduzione carico mensile |
|---|---|
| API banca per auto-riconciliazione bonifici | -3-5h/mese (Persona A) |
| Integrazione XML SDI inline (M2 con codice cliente) | -2h/mese (Persona A) |
| Verifica P.IVA automatica via VIES | -1-2h/mese (Persona A) |
| GitHub Actions deploy automatico | -1h/mese (Persona B) |
| Dependabot auto-PR security patches | -30 min/mese (Persona B) |
| Sentry alert tuning | -3h/mese (Persona B) |

Cumulativamente ~10-12h/mese risparmiate dopo 6 mesi di sviluppo incrementale = dimezza il TCO operativo.

## Rischi e mitigazioni

| Rischio | Probabilità | Impatto | Mitigazione |
|---|---|---|---|
| DNS Cloudflare propagazione lenta al cutover | media | medio | Cutover preparato a Giorno 9, real switch Giorno 10 con TTL ridotto a 300s 24h prima |
| Deliverability email scarsa al primo invio | media | alto | Verifica mail-tester.com pre go-live, warmup naturale via test interni |
| Cliente non fornisce IBAN/dati commercialista in tempo | media | alto | Richiesta esplicita Giorno 1, blocker tracciato |
| Postgres self-hosted SPOF | bassa | alto | Backup giornaliero + restore drill pre go-live + Hetzner snapshot settimanale |
| VPS compromesso (SSH attack) | bassa | critico | ssh-key only, fail2ban, ufw, no password root, IP origin nascosto da Cloudflare |
| Spike traffico improvviso supera CX22 | bassa | medio | Cloudflare cache assorbe statici. Upgrade CX22 → CX32 in 5 min via panel se serve |
| Bug critico post go-live | media | alto | Snapshot Hetzner pre-deploy + procedura rollback in DEPLOYMENT.md |
| Perdita chiave GPG backup | bassa | critico | Doppia copia: 1Password + cartacea in cassaforte cliente |
| Dimenticanza rinnovo dominio | bassa | critico | Auto-renew + 2FA registrar + verifica annuale calendarizzata |

## Out of scope (esplicito)

Non inclusi nel go-live MVP, da pianificare post:

- Integrazione SDI inline automatica (M2 con codice cliente)
- 2FA admin TOTP (M7)
- API banca auto-riconciliazione bonifici (M7)
- BullMQ + Redis per email queue (M7)
- Staging environment dedicato (post go-live se serve)
- Auto-deploy GitHub Actions (post go-live)
- Image optimization sharp + multiple sizes (post go-live)
- Object storage migration (quando uploads >10GB)
- WAF managed rules Cloudflare Pro (post go-live se attacchi)
- BetterStack Logtail aggregation (post go-live se serve)
- Status page pubblica (post go-live se serve)
- Multi-region failover, HA Postgres (volume non lo giustifica)
- Newsletter e marketing automation (fuori scope tecnico iniziale)
- Multilingua (solo italiano per MVP)
- Multivaluta (solo EUR)

## Open items (da chiudere prima del go-live)

- [ ] IBAN definitivo MF Depur per ENV produzione
- [ ] Email commercialista per cron CSV
- [ ] Conferma registrar dominio (probabile Hostinger) + accesso credenziali
- [ ] Verifica MX/SPF Hostinger esistenti per evitare conflitto Brevo SPF
- [ ] Contatti on-call reali (telefono primario + secondario) per DEPLOYMENT.md
- [ ] Privacy/Termini/Cookie revisionati dal cliente / commercialista
- [ ] Footer dati societari (ragione sociale, sede, P.IVA, REA, capitale sociale)
- [ ] Logo MF Depur in alta risoluzione per email template e meta tag
