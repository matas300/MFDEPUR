# M3 — Production Readiness (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development`. Un task → un commit.

**Goal:** Rendere `shop/` deployable e operabile in produzione. Structured logging, health check, compression, migration history, Dockerfile, PM2, runbook.

**Scope in questa sessione:**
- Structured logging (pino) + HTTP logging (pino-http o morgan) + correlation-id
- Compression middleware (skip webhook raw path)
- Health check `/health` + `/healthz`
- Prisma migration baseline (resto come deploy pipeline, non Postgres migration — vedi nota)
- Prisma logging: `warn` in prod
- Dockerfile multi-stage + `.dockerignore`
- PM2 `ecosystem.config.js` per deploy Hostinger VPS
- `docs/DEPLOYMENT.md` runbook (deploy, rollback, backup, on-call)

**Fuori scope (deferred):**
- **M3-T1 Postgres migration reale** — differita a M3-bis quando Postgres è provisionato (infra cliente). Questo plan lascia `datasource sqlite` ma aggiunge migration baseline per consentire transizione senza schema rewrite.
- T8 CI/CD — **già fatto in M4-γ-1** (`.github/workflows/ci.yml`)
- T9 README → **già fatto in M4-γ-2** (aggiungiamo solo DEPLOYMENT.md runbook)
- T11 cookie Secure test → già enforcement via `IS_PROD` in `csrf.js`; aggiungere test è low value, skip
- Error tracking (Sentry) → **già fatto in M1-F-2/F-3** (opt-in via SENTRY_DSN)

**Tech stack:** pino ^9, pino-http ^10, pino-pretty ^11 (dev), compression ^1.7.

---

## File structure (M3)

| File | Azione | Responsabilità |
|---|---|---|
| `shop/src/utils/logger.js` | **create** | Istanza pino unica, dev pretty / prod JSON, level da env |
| `shop/src/app.js` | modify | wire pino-http, compression (escl. webhook), mount `/health`, Prisma log prod |
| `shop/src/config/database.js` | modify | `log: ['warn','error']` in prod |
| `shop/src/routes/health.js` | **create** | GET /health (check DB) + GET /healthz (liveness) |
| `shop/prisma/migrations/` | **create** (dir) | baseline migration (T2) |
| `shop/package.json` | modify | deps pino/pino-http/pino-pretty/compression |
| `shop/Dockerfile` | **create** | multi-stage node:20-alpine |
| `shop/.dockerignore` | **create** | esclude node_modules, .env, .git, uploads, dev.db |
| `shop/ecosystem.config.js` | **create** | PM2 config (cluster, restart, log rotation) |
| `docs/DEPLOYMENT.md` | **create** | runbook setup/deploy/rollback/backup/incident |

**Pre-flight:** branch `feat/M3-production-readiness` da `master`.

---

## Wave 1 — Foundation (1 subagent sequenziale)

### Task F-1: install dipendenze

- [ ] **Step 1:**
```bash
cd shop && npm install --save pino@^9 pino-http@^10 compression@^1.7 && npm install --save-dev pino-pretty@^11
```

- [ ] **Step 2 — Verifica:**
```bash
grep -E '"(pino|pino-http|compression|pino-pretty)"' shop/package.json
# Expected: 4 righe
```

- [ ] **Step 3 — Commit:**
```bash
git add shop/package.json shop/package-lock.json
git commit -m "chore(deps): pino + pino-http + compression + pino-pretty (dev)"
```

---

### Task F-2: `src/utils/logger.js`

- [ ] **Step 1:** creare `shop/src/utils/logger.js`:
```js
// src/utils/logger.js
// Logger pino centralizzato. JSON in prod (aggregabile da ELK/CloudWatch),
// pretty in dev (leggibile). Level da LOG_LEVEL env, default 'info'.

const pino = require('pino');

const isProd = process.env.NODE_ENV === 'production';
const level = process.env.LOG_LEVEL || (isProd ? 'info' : 'debug');

const logger = pino({
  level,
  base: { app: 'mfdepur-shop', env: process.env.NODE_ENV || 'development' },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.body.password',
      'req.body.currentPassword',
      'req.body.newPassword',
      '*.password',
      '*.token',
      '*.secret',
      '*.apiKey',
    ],
    censor: '[REDACTED]',
  },
  transport: isProd
    ? undefined
    : {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss',
          ignore: 'pid,hostname,app,env',
        },
      },
});

module.exports = logger;
```

- [ ] **Step 2 — Verifica:**
```bash
node -c shop/src/utils/logger.js
cd shop && node -e "const l = require('./src/utils/logger'); l.info({ test: 1 }, 'logger ok'); l.warn('warn ok'); l.error(new Error('err ok'))"
# Expected: 3 log line (dev: colorate; prod: JSON)
```

- [ ] **Step 3 — Commit:**
```bash
git add shop/src/utils/logger.js
git commit -m "chore(utils): centralized pino logger (JSON prod, pretty dev, redact secrets)"
```

---

### Task F-3: migration baseline

- [ ] **Step 1:** generare baseline dallo schema corrente (senza modifiche dati):
```bash
cd shop && npx prisma migrate dev --name init --create-only
# --create-only: genera il file SQL ma non applica (il DB dev è già allineato via db push)
```

- [ ] **Step 2:** applicare la migration (mark applied senza rifare le modifiche già presenti):
```bash
cd shop && npx prisma migrate resolve --applied $(ls -1 prisma/migrations/ | grep init | head -1)
```

Se `migrate resolve` richiede path esatto e fallisce, alternativa più semplice:
```bash
cd shop && rm -f prisma/dev.db prisma/dev.db-journal
cd shop && npx prisma migrate dev --name init
# Ricrea DB da zero con la migration, poi re-run seed se vuoi dati demo
```

In ambiente CI (`.github/workflows/ci.yml` usa `db push` via globalSetup), la migration history è solo per deploy reale (run `prisma migrate deploy`).

- [ ] **Step 3 — Verifica:**
```bash
ls shop/prisma/migrations/
# Expected: almeno una cartella tipo 20260424120000_init/ con dentro migration.sql
cat shop/prisma/migrations/*/migration.sql | head -5
# Expected: statement SQL (CREATE TABLE Company, ecc.)
```

- [ ] **Step 4 — Commit:**
```bash
git add shop/prisma/migrations/
git commit -m "db(migrations): baseline \"init\" migration from current schema"
```

---

## Wave 2 — Parallel batches (2 subagent)

### Batch α — app.js wiring + health + Prisma log (1 subagent)

Tutti gli aggiornamenti a `app.js` + nuova `routes/health.js` + fix a `config/database.js`.

#### Task α-1: `src/routes/health.js`

**Files:** Create `shop/src/routes/health.js`

- [ ] **Step 1:** creare il file:
```js
// src/routes/health.js
// Due endpoint separati:
// - /healthz: LIVENESS. Ritorna 200 se il processo risponde. Usato da loadbalancer.
// - /health:  READINESS. Verifica dipendenze (DB) + ritorna 200 solo se tutto OK.
//             Usato da orchestratori (K8s) per smistare traffico.

const router = require('express').Router();
const prisma = require('../config/database');
const logger = require('../utils/logger');

router.get('/healthz', (req, res) => {
  res.status(200).json({ status: 'ok', uptime: process.uptime() });
});

router.get('/health', async (req, res) => {
  const checks = { db: 'unknown' };
  let ok = true;
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.db = 'ok';
  } catch (err) {
    checks.db = 'error';
    checks.dbError = err.message?.slice(0, 200);
    ok = false;
    logger.error({ err, where: 'health' }, 'DB health check failed');
  }

  const payload = {
    status: ok ? 'ok' : 'degraded',
    uptime: process.uptime(),
    memoryMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
    checks,
  };
  res.status(ok ? 200 : 503).json(payload);
});

module.exports = router;
```

- [ ] **Step 2 — Verifica:**
```bash
node -c shop/src/routes/health.js
```

- [ ] **Step 3 — Commit:**
```bash
git add shop/src/routes/health.js
git commit -m "feat(health): /healthz liveness + /health readiness endpoint"
```

---

#### Task α-2: wire logger, morgan-replacement, compression, health in `app.js`

**Files:** Modify `shop/src/app.js`

- [ ] **Step 1:** leggere `shop/src/app.js` attuale (già visto in M1/M0).

- [ ] **Step 2:** aggiungere in cima al file (dopo i require esistenti):
```js
const compression = require('compression');
const pinoHttp = require('pino-http');
const logger = require('./utils/logger');
```

- [ ] **Step 3:** **subito dopo** `const app = express();` + `const IS_PROD = ...`, aggiungere:
```js
// HTTP request logging strutturato (genera req.id automaticamente)
app.use(pinoHttp({
  logger,
  customProps: () => ({ env: process.env.NODE_ENV || 'development' }),
  serializers: {
    req: (req) => ({
      id: req.id,
      method: req.method,
      url: req.url,
      remoteAddress: req.remoteAddress,
    }),
    res: (res) => ({ statusCode: res.statusCode }),
  },
}));
```

**Importante:** questa riga deve stare **PRIMA** del mount `/stripe/webhook` così tutti i request (anche il webhook) vengono loggati. `pino-http` genera `req.id` (UUID) a ogni request, usabile come correlation-id.

- [ ] **Step 4:** aggiungere `compression` **DOPO** il mount di `/stripe/webhook` (la raw body del webhook non deve essere compressa):
```js
// IMPORTANTE: compression DOPO il webhook Stripe (rawBody non va compresso in ingresso;
// in uscita il webhook risponde con piccolo JSON, non serve compressione).
app.use(compression({
  // Non comprimere risposte sotto 1KB (overhead > benefit)
  threshold: 1024,
  // Filter: skippa se il client lo richiede
  filter: (req, res) => {
    if (req.headers['x-no-compression']) return false;
    return compression.filter(req, res);
  },
}));
```

Posizionare questo `compression` immediatamente **prima** di `app.use(cspNonce);` (cioè prima del middleware Helmet).

- [ ] **Step 5:** mount della health route. **Prima** del middleware CSRF (così health non richiede token):
```js
// Health endpoints (nessun auth, nessun CSRF, montati prima del resto)
app.use('/', require('./routes/health'));
```
Aggiungere questa riga **dopo** `cookieParser()` e **prima** di `ensureCsrfSession`.

- [ ] **Step 6:** rimuovere eventuali `console.log/error` redondanti in `app.js` e sostituirli con `logger.info/error`. Se ce ne sono pochi/zero (probabile), skip.

- [ ] **Step 7 — Verifica:**
```bash
node -c shop/src/app.js
```

- [ ] **Step 8 — Commit:**
```bash
git add shop/src/app.js
git commit -m "feat(app): pino-http + compression (skip webhook) + mount /health"
```

---

#### Task α-3: Prisma logging warn in prod

**Files:** Modify `shop/src/config/database.js`

- [ ] **Step 1:** leggere `shop/src/config/database.js`. Trovare la `new PrismaClient({ log: [...] })`.

- [ ] **Step 2:** aggiornare array log per includere `warn` anche in prod:
```js
const isProd = process.env.NODE_ENV === 'production';
const prisma = new PrismaClient({
  log: isProd ? ['warn', 'error'] : ['query', 'warn', 'error'],
});
```

(Adattare la variabile se già esiste una diversa; preservare altri setting tipo middleware `$use`.)

- [ ] **Step 3 — Verifica:**
```bash
node -c shop/src/config/database.js
```

- [ ] **Step 4 — Commit:**
```bash
git add shop/src/config/database.js
git commit -m "chore(prisma): log warn in prod (slow query, N+1 detection)"
```

---

### Batch β — Docker + PM2 + DEPLOYMENT.md (1 subagent)

Pure ops/docs, nessun JS app.

#### Task β-1: `shop/Dockerfile`

- [ ] **Step 1:** creare `shop/Dockerfile`:
```dockerfile
# syntax=docker/dockerfile:1.6
# Multi-stage build per MFDEPUR Shop
# Stage 1: installa deps + genera Prisma client
# Stage 2: runtime minimale

ARG NODE_VERSION=20.17.0-alpine3.20

FROM node:${NODE_VERSION} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# Install completo (serve Prisma engine binary per generate)
RUN npm ci --omit=dev && npm cache clean --force

FROM node:${NODE_VERSION} AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci && npx prisma generate && npm prune --omit=dev && npm cache clean --force

FROM node:${NODE_VERSION} AS runtime
WORKDIR /app
ENV NODE_ENV=production
# Utente non-root
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --chown=app:app . .
USER app
EXPOSE 3000
# Health check (container scheduler)
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:3000/healthz', r => process.exit(r.statusCode===200?0:1)).on('error', () => process.exit(1))" || exit 1
CMD ["node", "server.js"]
```

- [ ] **Step 2:** creare `shop/.dockerignore`:
```
node_modules
npm-debug.log
.env
.env.*
!.env.example
.git
.gitignore
.github
.vscode
.idea
Dockerfile
.dockerignore
coverage
tests
uploads/*
!uploads/.gitkeep
prisma/dev.db
prisma/test.db
prisma/*.db-*
*.md
!package.json
```

- [ ] **Step 3 — Verifica (se Docker disponibile localmente):**
```bash
cd shop && docker build -t mfdepur-shop:test . 2>&1 | tail -20
# Expected: "Successfully tagged mfdepur-shop:test"
# Se Docker non è installato in questa sessione, skip e segnala nel report.
```

- [ ] **Step 4 — Commit:**
```bash
git add shop/Dockerfile shop/.dockerignore
git commit -m "build(docker): multi-stage Dockerfile + .dockerignore"
```

---

#### Task β-2: `shop/ecosystem.config.js` (PM2)

- [ ] **Step 1:** creare `shop/ecosystem.config.js`:
```js
// PM2 ecosystem per deploy su VPS (Hostinger).
// Cluster mode: usa tutti i core disponibili. Log rotation nativa PM2.

module.exports = {
  apps: [
    {
      name: 'mfdepur-shop',
      script: 'server.js',
      instances: process.env.PM2_INSTANCES || 'max',
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'development',
        PORT: 3000,
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: process.env.PORT || 3000,
      },
      // Restart policy
      max_restarts: 10,
      min_uptime: '30s',
      restart_delay: 3000,
      exp_backoff_restart_delay: 100,
      // Log rotation
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss.SSS',
      max_memory_restart: '800M',
      // Kill timeout: lascia 30s a shutdown handler
      kill_timeout: 30000,
      // Graceful: PM2 manda SIGINT poi SIGKILL se non termina
      shutdown_with_message: false,
    },
  ],
};
```

- [ ] **Step 2 — Verifica:**
```bash
node -c shop/ecosystem.config.js
```

- [ ] **Step 3 — Commit:**
```bash
git add shop/ecosystem.config.js
git commit -m "ops(pm2): ecosystem.config.js cluster mode + log rotation + 30s shutdown"
```

---

#### Task β-3: `docs/DEPLOYMENT.md` runbook

- [ ] **Step 1:** creare `docs/DEPLOYMENT.md`:

````markdown
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
````

- [ ] **Step 2 — Commit:**
```bash
git add docs/DEPLOYMENT.md
git commit -m "docs: DEPLOYMENT.md runbook (setup/deploy/rollback/backup/incident)"
```

---

## Wrap-up (orchestrator)

- [ ] **Step 1 — Run test suite (verifica regression):**
```bash
cd shop && npm test 2>&1 | tail -10
# Expected: 17/17 verdi (nessun impatto da compression/pino su test)
```

- [ ] **Step 2 — Lint:**
```bash
cd shop && npm run lint 2>&1 | tail -5
# Expected: 0 errori
```

- [ ] **Step 3 — Smoke startup (opzionale):**
```bash
cd shop && npm run dev &
sleep 5
curl -s http://localhost:3000/healthz | tee
curl -s http://localhost:3000/health | tee
# Expected: {status:"ok"} in entrambi
kill %1
```

- [ ] **Step 4 — Conteggio commit:**
```bash
git log --oneline master..HEAD | wc -l
# Expected: ~11-13 commit
```

- [ ] **Step 5 — Merge:**
```bash
git checkout master
git merge --no-ff feat/M3-production-readiness -m "Merge branch 'feat/M3-production-readiness' — M3"
```

- [ ] **Step 6 — Update memoria + activeContext.**

---

## Riepilogo coverage

| Task plan | Ref audit | Note |
|---|---|---|
| F-1 | — | install deps |
| F-2 | M3-T3 | pino logger |
| F-3 | M3-T2 | migration baseline |
| α-1 | M3-T4 | /health + /healthz |
| α-2 | M3-T3, M3-T5, M3-T13 | pino-http + compression (skip webhook) + mount health |
| α-3 | M3-T12 | Prisma log warn prod |
| β-1 | M3-T7 | Dockerfile + .dockerignore |
| β-2 | M3-T10 | PM2 ecosystem |
| β-3 | M3-T6, M3-T9 | DEPLOYMENT.md runbook |

**Già chiusi precedentemente:**
- M3-T8 CI/CD → M4-γ-1
- M3-T9 README → M4-γ-2 (qui solo DEPLOYMENT.md)
- M3-T11 cookie Secure → già via `IS_PROD` in `csrf.js`
- Error tracking → M1-F-2/3

**Deferred a M3-bis (richiede infra cliente):**
- M3-T1 Postgres migration (provisioning DB managed, schema provider swap)

## Decomposizione esecutiva

| Wave | Chi | Cosa | Durata |
|---|---|---|---|
| 0 | orchestrator | branch + plan commit | instant |
| 1 | 1 subagent sequenziale | F-1..F-3 (deps, logger, migration baseline) | ~10 min |
| 2 | 2 subagent paralleli | α (app wiring + health + Prisma) · β (Docker + PM2 + runbook) | ~15 min |
| 3 | orchestrator | test/lint, merge | ~5 min |

Totale: ~30 min.

## Rischi noti

- **F-3 migration baseline** su SQLite: se il DB corrente ha stato inaspettato (es. `EmailFailureLog` già applicato via `db push` in M1), la generazione può richiedere drop+recreate. Il subagent ha istruzioni per `rm dev.db` + fresh migrate se `--create-only + resolve` fallisce.
- **Docker build** — se Docker non è disponibile localmente, skip Step 3 β-1 e segnalalo.
- Il refactor `console.log → logger` (α-2 Step 6) è discreto: mantenere i log utente-facing (`🚀 MF Depur Shop in esecuzione`) come `logger.info` e i signal (SIGTERM/SIGINT) come `logger.info` per consistenza con pino in prod.
