# DEPLOYMENT — MFDEPUR Shop

Runbook operativo per il deploy, rollback, backup e incident response.

## Ambienti

| Ambiente | URL | Host | DB | Branch |
|---|---|---|---|---|
| **dev** | http://localhost:3000 | locale | SQLite `prisma/dev.db` | feature branch |
| **staging** | TBD | Hostinger VPS (staging) | Postgres managed | `master` |
| **prod** | https://shop.mfdepur.com | Hostinger VPS (prod) | Postgres managed | release tag `vX.Y.Z` |

> Popolare gli URL staging/prod quando provisionati.

## Prerequisiti

- Node.js **>=18.17.0** (pinato in `engines`/`.nvmrc`). Si consiglia **20 LTS**.
- PostgreSQL **15+** (managed consigliato: Aiven/Neon/Railway/Hostinger managed).
- Certificato HTTPS attivo + reverse proxy (Nginx/Caddy) che fa terminazione TLS.
- PM2 installato globalmente: `npm install -g pm2`.
- `.env` produzione con tutte le var richieste (vedi sezione "Variabili ENV produzione" più sotto).

## Setup inizial (nuovo ambiente)

```bash
# 1. Clone
git clone <repo> /opt/mfdepur && cd /opt/mfdepur/shop

# 2. Install deps (prod only)
npm ci --omit=dev

# 3. .env prod (editare con valori reali — vedi sezione ENV)
$EDITOR .env

# 4. Prisma
npx prisma generate
npx prisma migrate deploy  # applica tutte le migration

# 5. (opz.) seed SOLO se primo setup
ADMIN_PASSWORD=<strong> node prisma/seed.js

# 6. Crea directory log
mkdir -p logs

# 7. Avvio via PM2
pm2 start ecosystem.config.js --env production
pm2 save
pm2 startup  # script per autostart al reboot (eseguire comando suggerito)
```

## Deploy incrementale

```bash
cd /opt/mfdepur
git fetch --tags
git checkout vX.Y.Z         # o git pull origin master
cd shop
npm ci --omit=dev
npx prisma migrate deploy    # applica migration nuove SENZA interattività
pm2 reload mfdepur-shop --update-env
pm2 status
curl -sS https://<host>/health | jq .
```

Se `reload` rilancia i worker zero-downtime (PM2 cluster mode). Un `restart` è più drastico (worker fermato → ripartito).

## Verifica post-deploy

```bash
# 1. Processo vivo
pm2 status mfdepur-shop

# 2. Health check
curl -sS https://<host>/healthz   # 200 sempre se vivo
curl -sS https://<host>/health    # 200 se anche DB ok

# 3. Log (ultimi 100 mex)
pm2 logs mfdepur-shop --lines 100
tail -f logs/pm2-out.log

# 4. Sentry (se SENTRY_DSN set): controlla dashboard per nuovi errori
```

## Riconciliazione bonifici (operatività admin)

Workflow standard per ogni ordine in stato `PENDING_PAYMENT`:

1. Apri estratto conto online della banca beneficiaria.
2. Cerca bonifici in entrata con causale = `MFD-YYYY-NNNNN` (numero ordine).
3. Verifica:
   - Importo coincide con `order.total`
   - Beneficiario = ragione sociale MF Depur Srl
   - Ordinante = ragione sociale company del cliente (o sua banca tramite SEPA)
4. In `/admin/orders/<id>` clicca "Marca pagato":
   - Data pagamento (default = oggi)
   - CRO bonifico (opzionale, copia da estratto conto)
5. Conferma → ordine passa a `CONFIRMED`, stock decrementato, email cliente "ordine in preparazione".
6. Procedi con preparazione spedizione e invio tracking via "spedito".

**Non confermare** se l'importo non corrisponde: contatta il cliente prima.

**Audit log** registra ogni `PAYMENT_CONFIRMED` con `paymentReference`, `paidAt`, attore admin. Consultabile in `/admin/audit-log` o via DB.

## Cron settimanale al commercialista

Ogni lunedì 08:00 UTC il job `weeklyAccountantExport` (in `shop/src/jobs/weeklyAccountantExport.js`):

1. Query ordini con `status >= CONFIRMED` e `paidAt` nei 7 giorni precedenti.
2. Genera CSV con 16 colonne: orderNumber, createdAt, paidAt, ragioneSociale, P.IVA, codice SDI/PEC, indirizzo, totali, paymentReference, status.
3. Email automatica a `process.env.ACCOUNTANT_EMAIL` con CSV allegato.
4. Audit log `WEEKLY_INVOICE_EXPORT`.

ENV richieste in produzione: `ACCOUNTANT_EMAIL`, `ACCOUNTANT_NAME`, `EMAIL_FROM`, `EMAIL_REPLY_TO`.

In caso di failure: il cron logga l'errore via Pino + Sentry. NON ritenta automaticamente. Eseguibile manualmente:

```bash
cd /opt/mfdepur/shop
NODE_ENV=production node -e "require('./src/jobs/weeklyAccountantExport').runWeeklyAccountantExport().catch(e => { console.error(e); process.exit(1); })"
```

## Variabili ENV produzione

```env
# Core
NODE_ENV=production
PORT=3000
BASE_URL=https://shop.mfdepur.com
DATABASE_URL=postgresql://user:pass@host:5432/mfdepur

# Auth
JWT_SECRET=<32+ bytes random hex>
JWT_REFRESH_SECRET=<32+ bytes random hex>

# Admin
ADMIN_EMAIL=info@mfdepur.com

# Bonifico (mostrati in checkout, success page e email conferma ordine)
BANK_BENEFICIARY="MF Depur Srl"
BANK_IBAN="IT00 X000 0000 0000 0000 000"
BANK_NAME="Banca Esempio"
BANK_BIC=""

# Email transazionale (Brevo / Sendinblue SMTP relay)
EMAIL_HOST=smtp-relay.brevo.com
EMAIL_PORT=587
EMAIL_USER=<brevo smtp user>
EMAIL_PASS=<brevo smtp key>
EMAIL_FROM="MF Depur <info@mfdepur.com>"
EMAIL_REPLY_TO=info@mfdepur.com

# Cron commercialista (export settimanale ordini pagati)
ACCOUNTANT_EMAIL=commercialista@studio.it
ACCOUNTANT_NAME="Studio Rossi & Co."

# Osservabilità (opz.)
SENTRY_DSN=
```

> Le variabili `BANK_*` e `ACCOUNTANT_*` sono **fail-fast**: l'app rifiuta di partire se mancanti (vedi `shop/src/config/env.js`). `BANK_BIC` è opzionale.

## Rollback

```bash
# 1. Checkout tag precedente
cd /opt/mfdepur && git checkout vX.Y.(Z-1)

# 2. ATTENZIONE MIGRATION: se la deploy nuova ha applicato schema non retro-compatibile,
#    Prisma 'migrate deploy' precedente non rimuoverà le modifiche.
#    In quel caso: `npx prisma migrate resolve --rolled-back <nome-migration>`
#    + restore backup DB pre-deploy (vedi sezione Backup).

# 3. Reinstalla deps della vecchia versione
cd shop && npm ci --omit=dev

# 4. Reload
pm2 reload ecosystem.config.js --env production
```

**Red flag:** se rollback > 1 ora dopo deploy con schema breaking → restore DB da backup, non solo checkout del codice.

## Backup database

**Strategia consigliata** (Postgres):
- **Full dump giornaliero** `pg_dump` → upload S3/B2 con retention **30 giorni**.
- **WAL continuo** (pgBackRest o managed) se il provider lo offre nativamente.
- **Restore test** trimestrale su staging.

Script minimal cron (daily 03:00):
```bash
# /opt/mfdepur/scripts/backup.sh
set -euo pipefail
TS=$(date -u +%Y%m%dT%H%M%SZ)
DUMP=/tmp/mfdepur-$TS.sql.gz
pg_dump "$DATABASE_URL" | gzip > "$DUMP"
aws s3 cp "$DUMP" "s3://mfdepur-backups/db/$TS.sql.gz"
rm "$DUMP"
# retention: configurata lato S3 (lifecycle rule)
```

**Restore:**
```bash
aws s3 cp s3://mfdepur-backups/db/<TS>.sql.gz /tmp/restore.sql.gz
gunzip -c /tmp/restore.sql.gz | psql "$DATABASE_URL_TARGET"
```

## Rotazione segreti

- **Cadence minima:** JWT_SECRET e JWT_REFRESH_SECRET ogni **90 giorni**.
- **Generazione:** `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
- **Procedura rotazione senza downtime:**
  1. Genera nuovo `JWT_REFRESH_SECRET`.
  2. Deploy con NUOVO env var (vecchie session vengono invalidate al refresh → utenti rifanno login).
  3. (Opzionale) keep-alive: supportare 2 segreti in parallelo per 24h (modifica `middleware/auth.js`) — NOT implemented yet.

## Incident response

**Classificazione severità:**
- **SEV1** — sito down, checkout bloccato, perdita dati.
- **SEV2** — feature principale degradata (es. email non partono, cron commercialista fallisce).
- **SEV3** — bug non critici.

**Runbook SEV1:**
1. Verifica `pm2 status` + `curl /healthz`.
2. Log check: `pm2 logs --lines 200 --err` + Sentry.
3. Se DB giù: verifica managed DB dashboard, network connectivity.
4. Se app in crash loop: `pm2 describe mfdepur-shop` → leggi `uptime`, `restart count`.
5. Rollback se legato a deploy recente (vedi sezione Rollback).
6. Post-mortem entro 48h.

## Contatti

- **On-call primary:** TBD
- **On-call secondary:** TBD
- **Hostinger support:** TBD
- **Brevo (SMTP) support:** https://help.brevo.com
- **Provider DB managed:** TBD

## Verifiche periodiche

- **Settimanale:** Sentry error rate, PM2 restart count, disk usage `/opt/mfdepur/shop/logs` + `/uploads`. Verifica che il cron `weeklyAccountantExport` sia partito (audit log `WEEKLY_INVOICE_EXPORT`).
- **Mensile:** backup restore drill su staging. Rotazione log PM2 (`pm2 flush` se > 1GB).
- **Trimestrale:** rotazione segreti. Audit CVE (`npm audit`). Upgrade minor deps.
- **Annuale:** aggiornamento Node LTS + upgrade Prisma/Express major.

## Riferimenti

- Audit completo: `docs/audit/2026-04-23/99-MASTER.md`
- Security: `docs/audit/2026-04-23/10-security.md`
- Fiscalità IT: `docs/audit/2026-04-23/11-eshop-fiscal.md`
