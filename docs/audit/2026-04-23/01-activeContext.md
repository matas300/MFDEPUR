# Active Context — Audit MFDEPUR 2026-04-23

**Ultimo aggiornamento:** 2026-04-23 (fine Fase 2)

## Stato corrente

- **Fase 0 — Housekeeping:** ✅ completata
  - `1` (0-byte) rimosso
  - Commit `bcba9ec` → fix nonce CSP difensivo su 7 EJS
  - Commit `6fbd3f0` → slim CLAUDE.md + rm file spurio
- **Fase 1 — Recon leggero:** ✅ completata
  - Mappa directory, stack, schema Prisma → `00-projectbrief.md`, `02-systemPatterns.md`, `03-techContext.md`
- **Fase 2 — Audit parallelo (5 sub-agent):** ✅ completata
  - `10-security.md` (40 findings · risk HIGH)
  - `11-eshop-fiscal.md` (20 findings · fiscal MISSING)
  - `12-code-quality.md` (20 findings · grade B)
  - `13-ui-ux-perf.md` (20 findings · a11y/perf GOOD)
  - `14-production-ready.md` (25 findings · NOT-READY)
- **Fase 3 — Master Document:** 🟡 in corso

## Conteggio findings per severity

| Severity | Count |
|---|---|
| Critical | 9 |
| High | 28 |
| Medium | 42 |
| Low/Info | ~46 |
| **Totale** | **~125** |

## Top blocker (go-live)

1. **Fiscal** — FatturaPA/SDI completamente assente; IVA hardcoded 22%; decimali con `Number` (SHOP-001/002/003)
2. **DB** — SQLite + no migrations (PROD-001/002)
3. **Test/CI** — suite assente, no pipeline (PROD-004/009)
4. **Concurrency** — stock+ordine non atomici, Stripe webhook race (SHOP-004, SEC-007, CQ-001)
5. **Shutdown** — SIGTERM mancante, unhandled rejection non terminante (CQ-003, PROD-003/019)
6. **Validation** — input utente/admin senza `express-validator` in metà delle route (SEC-001..003, 021..031)
7. **Rate limit** — mancante su checkout, delete account, cart (SEC-004/005)
8. **Business** — indirizzo nuovo al checkout perso, bonifico auto-confirm (SHOP-007/009)
9. **Ops** — no health endpoint, no structured log, no error tracking, no backup, no Docker (PROD-010..015, 024)

## Memoria persistente aggiornata

- Nuova memoria: `audit_findings_2026-04-23.md` (top blocker)
- Nuova memoria: `audit_roadmap_2026-04-23.md` (milestone)
- Aggiornata: `project_milestone1_status.md` (hardening parziale confermato dai findings)
