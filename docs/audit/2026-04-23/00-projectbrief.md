# Audit MFDEPUR — Project Brief

**Data:** 2026-04-23
**Branch:** `master`
**Commit di partenza:** `6fbd3f0` (post-housekeeping)
**Auditor:** Claude Opus 4.7 (Operator) + sub-agent Explore paralleli

## Contesto

MF Depur è un e-commerce **B2B** per prodotti chimici per depurazione (unità di default `kg`, ordine minimo, prezzo su richiesta). Due bounded context principali:

1. **Sito istituzionale statico** — `index.html` + `assets/` in root (legacy, servito da Hostinger in prod come `www.mfdepur.com`).
2. **Shop applicativo** — `shop/` (Node/Express, target del presente audit).

Il sito statico legacy e la cartella `New Sites/` (duplicato/staging del sito statico) **non sono oggetto primario di audit** ma verranno solo inventariati.

## Obiettivo audit

Portare lo `shop/` a uno **standard di produzione eccellente**, con roadmap di milestone tracciabili:

- **Sicurezza** (XSS su EJS, validazione input, checkout, JS vulns, secret management)
- **Logiche e-shop & fiscalità** (carrello, sessioni, IVA, ricevute/fatture)
- **Code quality & stabilità** (routing, gestione stato, dead code, try/catch, error handling)
- **UI/UX & performance** (usabilità, pulizia HTML/CSS, asset, reattività)
- **Production-readiness** (env, logging, monitoring, backup, CI/CD, test/lint assenti)

## Metodo

- **Rolling summarization** — main context mantenuto al 60–65% di saturazione.
- **Sub-agent Explore** in parallelo, isolati, ritornano solo JSON/summary.
- **Audit workspace** in `docs/audit/2026-04-23/` (committato in git).
- **Auto-memoria persistente** in `~/.claude/projects/.../memory/` aggiornata solo con top findings.
- `node_modules/` escluso da tutti i sub-agent.

## Fasi

| Fase | Titolo | Stato |
|---|---|---|
| 0 | Housekeeping (rm `1`, commit modifiche pendenti, slim CLAUDE.md) | ✅ completata |
| 1 | Recon leggero (mappa, stack, schema) | 🟡 in corso |
| 2 | Audit parallelo (5 sub-agent) | ⏳ pending |
| 3 | Consolidamento + Master Document | ⏳ pending |

## Deliverable finale

`docs/audit/2026-04-23/99-MASTER.md` — roadmap a Milestone → Task testabili, pronta per subagent-driven development.
