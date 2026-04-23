# Audit E-shop & Fiscalità IT — MFDEPUR Shop

**Sub-agent:** Explore (business logic + fiscal) · **Cart verdict:** PARTIAL · **Fiscal verdict:** MISSING

> ⚠ **Caveat:** riferimenti `file:line` da report sub-agent; verificare prima di fix.

## Verdetto

Le logiche carrello/checkout sono funzionanti e la CSRF/Stripe sono solide, ma la **compliance fiscale italiana B2B è assente o parziale**: nessuna generazione FatturaPA/SDI, IVA hardcoded al 22% (nonostante lo schema preveda `Order.taxRate`), calcoli monetari con `Number` invece che `Decimal`, numerazione ordini ≠ numerazione progressiva fatture (obbligo ISO 11582:2007 / art. 21 DPR 633/72), campi `sdiCode`/`pec` raccolti ma mai usati. Bonifico confermato auto senza attesa ricezione. Spedizione sempre gratuita. Stock non atomico.

## Findings critici (fiscal / business)

| ID | Severity | Area | Titolo | Location |
|---|---|---|---|---|
| SHOP-001 | critical | invoice | **FatturaPA/SDI completamente assente** — obbligo B2B IT | nessun file |
| SHOP-002 | critical | tax | IVA hardcoded a 22% nei controller, `Order.taxRate` del DB mai letto | `cartController.js:19`, `orderController.js:28, 62, 170` |

**SHOP-001** richiede decisione strategica: integrare libreria XML PA (es. pacchetto opensource `@ffranch/fatturapa-node` o API SaaS tipo Aruba/FattureInCloud/Fiscozen) + invio SDI via PEC o canale SDI diretto.

## Findings high

| ID | Area | Titolo | Location |
|---|---|---|---|
| SHOP-003 | tax | Calcoli monetari con `Number` — arrotondamenti non garantiti (violazione 2-decimal IT) | `cartController.js:18`, `orderController.js:27,61,78`, `public/js/shop.js:326-347` |
| SHOP-004 | stock | Decremento stock NON atomico — race condition → overselling | `orderController.js:210-217` (`_finalizeOrder`) |
| SHOP-005 | checkout | No idempotency su creazione ordine — double-submit duplica | `orderController.js:41-121` |
| SHOP-006 | session | `requireApprovedCompany` non coperto su tutte le route (`/account/orders` path) | `routes/shop.js`, `middleware/auth.js:42-51` |
| SHOP-007 | business | Checkout con "Nuovo indirizzo": dati form ignorati, ordine creato senza `addressId` → impossibile spedire | `orderController.js:74`, schema `Order.addressId` nullable |

## Findings medium

| ID | Area | Titolo | Location |
|---|---|---|---|
| SHOP-008 | pricing | `priceOnRequest` bloccato server per auth ma guest-cart (localStorage) non validato | `cartController.js:47-48`, `public/js/shop.js:202-210` |
| SHOP-009 | checkout | Bonifico → `status=CONFIRMED` immediato senza attesa conferma ricezione + email falsa | `orderController.js:97-101` |
| SHOP-010 | tax | Totali in `POST /checkout` dal client non ricalcolati server-side — possibile frode totali | `orderController.js:41-120`, `public/js/shop.js:334-348` |
| SHOP-011 | invoice | `orderNumber` ≠ numerazione progressiva fatture (gap su ordini cancellati → invalido per SDI) | `orderController.js:5-11` |
| SHOP-012 | session | Merge guest→DB post-login fa fetch sequenziali, no rollback in caso di failure parziale | `public/js/shop.js:146-172` |
| SHOP-013 | invoice | `sdiCode` e `pec` raccolti su Company ma **mai usati** nel codice (campi orfani) | `schema.prisma:17-18`, `authController.js:111` |
| SHOP-014 | gdpr | GDPR delete anonimizza User ma non blocca hard-delete Ordini prima dei 10 anni (art. 2220 c.c.) | `routes/account.js:135-151` |
| SHOP-015 | shipping | `shippingCost=0` hardcoded, no zone/carrier | `orderController.js:63`, schema default 0 |

## Findings low/info

- **SHOP-016** CSP `styleSrc` `unsafe-inline` — duplicato con SEC-015
- **SHOP-017** No rate limit su `/shop/cart/add`
- **SHOP-018** Multi-user per company senza ruoli granulari (buyer/approver/viewer)
- **SHOP-019** Webhook Stripe senza retry/queue per failure
- **SHOP-020** `AuditLog` popolato ma nessuna UI admin per consultarlo

## Missing features (per produzione B2B IT)

1. Generazione **FatturaPA XML** + firma digitale + invio **SDI** (via canale diretto o PEC)
2. **Split payment PA** (scissione dei pagamenti, DL 50/2017) — se previsti clienti PA
3. Aliquote IVA differenziate per prodotto (4%, 5%, 10%, 22%) + reverse charge intra-UE + esenzione art. 8 DPR 633/72 (export)
4. Calcoli con `decimal.js` o `Prisma.Decimal` (server-side, single source of truth)
5. `prisma.$transaction` per stock + ordine atomico
6. Idempotency key (Stripe native) + nonce form checkout
7. Indirizzo nuovo: salvato prima della creazione ordine
8. Sequenza progressiva fatture per esercizio fiscale (DB `Sequence` model)
9. Shipping zones + tariffario per peso/provincia (o integrazione carrier DHL/GLS/SDA API)
10. Workflow admin per conferma bonifico ricevuto → `CONFIRMED`
11. Ruoli intra-company (admin company, buyer, viewer) + approval workflow ordini
12. Pagina admin `/audit-log` (filtri action/entity/date + export CSV)
13. Retry/queue per webhook Stripe (Bull / BullMQ + Redis)
14. Conservazione fatture 10 anni (lock hard-delete <10a)
15. Integrazione carrier tracking
16. Export bulk ordini + fatture

## Positive observations

- CSRF double-submit + JWT refresh lifecycle corretti
- Password + email verify + reset password ben implementati
- GDPR soft-delete + export JSON (commit `419b18d`)
- Admin company approval workflow (`PENDING→APPROVED`) con notifica email
- Stripe PaymentIntent + webhook signature fail-close
- Rate limit auth endpoints
- Helmet + CSP + HSTS prod
- `minOrderQty` enforced su cart add (DB + client)
- Stock verification su checkout (pre-ordine, anche se non atomica)
- Guest cart merge automatico post-login
- Multi-indirizzo per company con default
- CSV export ordini con escape RFC 4180 + BOM UTF-8

## Open questions (da product owner)

1. Supporto aliquote IVA multiple previsto in roadmap o solo 22%?
2. Clientela UE intra-EU → reverse charge necessario?
3. Consegna fatture PDF: email a pagamento o download da area account?
4. Chi approva manualmente bonifico in admin? Workflow interno esistente?
5. Clienti PA previsti → split payment art. 17-ter DPR 633/72?
6. Shipping zones/tariffario definito o da costruire?
7. Multi-utente company: workflow approvazione ordini interno?
8. Archivio fatture: filesystem, S3, servizio esterno (es. Aruba Fatturazione)?
