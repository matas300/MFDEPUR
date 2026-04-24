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
- `.env` produzione con tutte le var richieste (vedi `shop/.env.example`).

## Setup inizial (nuovo ambiente)

```bash
# 1. Clone
git clone <repo> /opt/mfdepur && cd /opt/mfdepur/shop

# 2. Install deps (prod only)
npm ci --omit=dev

# 3. .env prod (editare con valori reali)
cp .env.example .env
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
- **SEV2** — feature principale degradata (es. email non partono).
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
- **Stripe support dashboard:** https://dashboard.stripe.com
- **Provider DB managed:** TBD

## Verifiche periodiche

- **Settimanale:** Sentry error rate, PM2 restart count, disk usage `/opt/mfdepur/shop/logs` + `/uploads`.
- **Mensile:** backup restore drill su staging. Rotazione log PM2 (`pm2 flush` se > 1GB).
- **Trimestrale:** rotazione segreti. Audit CVE (`npm audit`). Upgrade minor deps.
- **Annuale:** aggiornamento Node LTS + upgrade Prisma/Express major.

## Riferimenti

- Audit completo: `docs/audit/2026-04-23/99-MASTER.md`
- Security: `docs/audit/2026-04-23/10-security.md`
- Fiscalità IT: `docs/audit/2026-04-23/11-eshop-fiscal.md`
