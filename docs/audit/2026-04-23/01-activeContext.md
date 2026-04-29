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
- **Fase 3 — Master Document:** ✅ completata (99-MASTER.md)
- **M0 — Quick wins & safety net:** ✅ **merged in master** (18 commit)
- **M1 — Stability & concurrency:** ✅ **merged in master** (17 commit)
- **M4 — Test & Code Quality:** ✅ **merged in master** (13 commit)
- **M3 — Production Readiness:** ✅ **merged in master** (10 commit)
- **M5 — UI/UX Hardening:** ✅ **merged in master** (16 commit). Include: CSP styleSrc strict + styleSrcAttr 'unsafe-inline' (protegge <style> block senza refactor 207 inline style), errorId tracking via req.id, src/utils/format.js Intl it-IT (€1.234,56), 69 scope="col", aria-describedby+aria-invalid, loading=lazy esteso, inputmode email/tel/CAP, hint 3DS, minOrderQty badge, robots.txt, guest cart localStorage fallback. Scoperto: handler [data-confirm] con modal custom accessibile già presente (più avanzato del piano). Debito tecnico tracciato: 207 inline style attributes (protetti, refactor post-go-live).
- **M6 — Admin & Business Completeness:** ✅ **merged in master 2026-04-29** (9 commit). Include: T1 RBAC `User.companyRole` + `requireCompanyRole` middleware con bypass ADMIN globale + bootstrap COMPANY_ADMIN via migration SQL (utente più vecchio per company); T2 `Company.requiresOrderApproval` + stato `AWAITING_APPROVAL` + transizione `[PENDING, CANCELLED]` + branching in `postCheckout` (BUYER → AWAITING_APPROVAL, no Stripe, no stock decrement) + endpoint `approve/reject` company-side (`/company/orders/:id/approve|reject`) e admin override (`/admin/orders/:id/approve|reject`) + UI `views/company/{orders,order-detail}.ejs` + link nav "Ordini azienda" + email `sendOrderAwaitingApproval/Approved/Rejected`; T3 CSV export già esistente (out of scope); T4 `Order.trackingCarrier/trackingUrl` + helper `buildTrackingUrl` (DHL/GLS/SDA/BRT/UPS/FEDEX/POSTE) + UI admin order-detail (select + url) + email `sendOrderShipped` con link cliccabile; T5 dashboard stats oggi/settimana/AWAITING_APPROVAL count. Fix critical post-review: race condition risolta con `updateMany` atomico + `requireApprovedCompany` aggiunto a `/company` routes. Test: 43/43 verdi (8 unit + 5 integration). Deferred a M6-bis: UI COMPANY_ADMIN per gestire utenti, API integration carrier, PDF fatture bulk, toggle `requiresOrderApproval` in form admin (se non già presente).

## Prossima sessione

Candidate: **M2** (fiscal IT) — sbloccare le risposte commercialista (`docs/audit/2026-04-23/M2-domande-commercialista.md`) prima di partire. Alternativa: **M3-bis** (Postgres reale) se DB managed disponibile, o **M7** (advanced hardening, BullMQ + 2FA admin + session blacklist + WAF).

Follow-up bug UX pre-esistente schedulabile in qualsiasi sessione: `views/auth/login.ejs` legge `errors[]` ma controller passa `error` string.

## Stato dopo 6 milestone merged

Master è a **107+ commit avanti rispetto a origin/master** (nessun push eseguito — decisione user).

Per il go-live restano:
- **M2** (fiscal IT) — BLOCKED su risposte commercialista (`docs/audit/2026-04-23/M2-domande-commercialista.md`)
- **M3-bis** (Postgres reale) — richiede DB managed provisionato
- **M7** (advanced hardening) — post go-live
- **Follow-up M1 da M7:** webhook Stripe duplicato può re-inviare email (dedupe con queue)
- **Follow-up M4 (bug UX pre-esistente):** `views/auth/login.ejs` legge `errors[]` ma controller passa `error` (string) → utenti non vedono messaggi errore login. Fix minimale da schedulare.
- **Prossimo:** M2 (fiscal IT — richiede decisione provider SDI) o M3 (Postgres/migrations/health/backup/Docker). M2+M3 parallelizzabili dopo decisione SDI.

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
