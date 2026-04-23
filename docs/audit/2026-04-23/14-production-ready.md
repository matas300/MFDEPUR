# Audit Production-Readiness — MFDEPUR Shop

**Sub-agent:** Explore (SRE/prod) · **Verdict:** NOT-READY

> ⚠ **Caveat:** riferimenti `file:line` da report sub-agent; verificare prima di fix.

## Verdetto

Stack e protezioni perimetrali ci sono, ma **4 gap critici impediscono il go-live**: (1) SQLite non scalabile, (2) nessuna migration history, (3) test suite assente, (4) graceful shutdown incompleto. In più: nessun CI/CD, nessun error tracking, nessun health check, logging console-only, nessun Dockerfile, nessun `engines.node`, `ADMIN_PASSWORD` con fallback hardcoded nel seed.

## Env vars usate (20)

`PORT`, `NODE_ENV`, `BASE_URL`, `DATABASE_URL`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `JWT_REFRESH_SECRET`, `JWT_REFRESH_EXPIRES_IN`, `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`, `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_USER`, `EMAIL_PASS`, `EMAIL_FROM`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `CSRF_SECRET`, `UPLOAD_MAX_SIZE_MB`.

> `.env.example` esiste ma non è stato letto dal sub-agent per permessi — va verificato che contenga tutte le 20 variabili con placeholder sicuri.

## Findings critici (go-live blockers)

| ID | Area | Titolo | Location |
|---|---|---|---|
| PROD-001 | db | SQLite non scalabile per B2B prod — no replica, no pool, file-locking | `prisma/schema.prisma:6` |
| PROD-002 | db | **Nessuna migration history** (`prisma/migrations/` assente) — rollback/staging impossibili | `prisma/` |
| PROD-003 | shutdown | `SIGTERM` non gestito; `server.close()` mancante → connessioni in-flight perse | `server.js:22-25` |
| PROD-004 | test | Test suite 100% assente (no jest/mocha/supertest); `npm test`/`npm run lint` inesistenti (CLAUDE.md promette) | `package.json` |

## Findings high

| ID | Area | Titolo | Location |
|---|---|---|---|
| PROD-005 | env | `ADMIN_PASSWORD` con fallback hardcoded `'CambiaSubito!123'` nel seed | `prisma/seed.js:11` |
| PROD-006 | logging | `console.log/error` unstructured — serve pino/winston + morgan | multipli |
| PROD-007 | env | `.env.example` non ispezionabile / da verificare esaustivo | `shop/.env.example` |
| PROD-008 | build | Nessuno script `build` (CLAUDE.md lo promette) + nessun bundler | `package.json` |
| PROD-009 | ci | CI/CD pipeline assente (`.github/workflows/`, `.gitlab-ci.yml`, ecc.) | root |
| PROD-010 | backup | Nessuna strategia di backup documentata | — |
| PROD-011 | perf | Middleware `compression` assente | `src/app.js` |
| PROD-012 | monitoring | Nessun endpoint `/health` / `/healthz` | `src/app.js` |

## Findings medium

| ID | Area | Titolo | Location |
|---|---|---|---|
| PROD-013 | env | `package.json` senza `"engines": { "node": ">=18..." }` | `package.json` |
| PROD-014 | monitoring | Nessun error tracking (Sentry/Rollbar) | — |
| PROD-015 | env | Fallback `NODE_ENV` a `development` se unset — rischio dev-mode in prod | `server.js:14`, `app.js:19,134` |
| PROD-016 | security | CSP `styleSrc` `unsafe-inline` (duplicato con SEC-015) | `app.js:62` |
| PROD-017 | security | `CSRF_SECRET` error message cryptic se mancante | `middleware/csrf.js:5-8` |
| PROD-018 | db | Prisma `$use` middleware custom per JSON (SQLite workaround) — va rimosso dopo migrazione a Postgres (native JSON) | `config/database.js:8-52` |
| PROD-019 | stability | `unhandledRejection`/`uncaughtException` loggano ma non terminano processo (zombie state) | `server.js:29-34` |

## Findings low/info

- **PROD-020** Prisma logging in prod solo `['error']` → perde warn (slow query, N+1)
- **PROD-021** README assente in `shop/` e root
- **PROD-022** `docs/DEPLOYMENT.md` (runbook) assente
- **PROD-023** `seed.js` contiene credenziali mock `Demo1234!` → aggiungere guard `if (NODE_ENV==='production') throw`
- **PROD-024** Nessun `Dockerfile` / `.dockerignore`
- **PROD-025** No cache busting / asset versioning (no hash filename)

## Positive observations

- Helmet + CSP + HSTS + Referrer-Policy
- CSRF double-submit + httpOnly cookie
- Rate limit su auth endpoints
- bcryptjs cost 12, JWT access+refresh pattern
- Prisma schema ben strutturato per B2B
- `trust proxy 1` in prod
- HTTPS redirect in prod
- `.gitignore` ben configurato (.env, uploads, dev.db)
- Middleware request injection centralizzato
- `.env.example` esiste (contenuto da verificare)

## Open questions (infra)

1. **Hostinger Node hosting:** versione Node pinata? Auto-upgrade?
2. **DB produzione:** SQLite su VPS o Postgres managed? (la memoria dice "Hostinger solo statico" → probabile VPS Node + Postgres managed su altro provider)
3. **Stripe webhook:** IP whitelisting richiesto / Hostinger IP dinamico?
4. **Email SMTP:** SendGrid, AWS SES, Aruba?
5. **Monitoring:** Sentry free tier è OK?
6. **Backup:** Hostinger managed vs. cron custom verso S3/B2?
7. **RTO/RPO:** ore accettabili di downtime / data loss?
8. **On-call:** chi è SRE primary/secondary?
9. **Deploy:** panel manuale vs. SSH+GitHub Actions?
10. **Load test target:** checkout concorrenti B2B attesi?
