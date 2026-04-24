# MFDEPUR

E-commerce B2B per prodotti chimici di depurazione (MF Depur S.r.l.).

## Struttura repo

- `shop/` — applicazione Node.js/Express (codice principale)
- `docs/` — documentazione e audit
- `index.html`, `assets/` — sito statico legacy (servito da Hostinger)
- `New Sites/` — staging del sito statico legacy (non in uso)

## Quick start (sviluppo)

```bash
cd shop
cp .env.example .env    # e compilare i valori reali
npm install
npx prisma db push      # inizializza SQLite dev
npm run db:seed         # crea admin + company demo (richiede ADMIN_PASSWORD env)
npm run dev             # avvia su http://localhost:3000
```

## Test & quality

```bash
cd shop
npm test            # Vitest (unit + integration)
npm run test:cov    # Vitest + coverage
npm run lint        # ESLint
npm run lint:fix    # ESLint auto-fix
npm run format      # Prettier
```

I test integration usano `shop/prisma/test.db` (ricreato prima di ogni run).

## Audit & roadmap

La roadmap post-audit è in `docs/audit/2026-04-23/99-MASTER.md`.
Per dettagli per area:

- `docs/audit/2026-04-23/10-security.md`
- `docs/audit/2026-04-23/11-eshop-fiscal.md`
- `docs/audit/2026-04-23/12-code-quality.md`
- `docs/audit/2026-04-23/13-ui-ux-perf.md`
- `docs/audit/2026-04-23/14-production-ready.md`

## CI

GitHub Actions (`.github/workflows/ci.yml`) esegue lint + test su ogni PR verso `master`.

## Convenzioni

- Branch-only per le feature (`feat/<milestone>-<task>`).
- Testi UI in italiano.
- Niente inline JS nelle view (CSP con nonce).
- Niente segreti in repo.
- File sorgenti sotto 500 righe.
