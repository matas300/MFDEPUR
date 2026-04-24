# MFDEPUR — Domande per il commercialista (preparazione M2 · fiscalità IT)

**Contesto per il commercialista:**
Stiamo sviluppando un e-commerce B2B (azienda → azienda) per MF Depur, per la vendita online di prodotti chimici per depurazione. L'app è in Node.js, i clienti sono imprese italiane con P.IVA. Prima di scrivere il codice fiscale serve capire alcuni vincoli legali/operativi. Le tue risposte decideranno direttamente come programmiamo generazione fatture, calcolo IVA, flussi di pagamento e conservazione documenti.

> Rispondi nelle caselle dopo ogni domanda (o in qualsiasi formato ti è comodo — anche vocale/email).

---

## 1. Canale di invio fatture elettroniche (SDI)

Oggi abbiamo tre opzioni per inviare le fatture elettroniche al Sistema di Interscambio (SDI) dell'Agenzia delle Entrate:

- **A)** **Servizio SaaS** a pagamento (es. FattureInCloud, Aruba Fatturazione, Register.it, Fatture24, Acubed). Il servizio genera XML conforme, firma e invia a SDI per conto nostro. Costo ~10–30 €/mese.
- **B)** **Invio via PEC** alla casella istituzionale di SDI (`sdi01@pec.fatturapa.it`). Noi generiamo XML + firma digitale + invio dalla PEC aziendale.
- **C)** **Canale diretto SDI** (SDICoop Servizio web o SFTP accreditato). Richiede accreditamento Agenzia Entrate + certificati, setup più complesso.

**Domanda:** Quale canale preferisci? (Con quale provider eventualmente?)

➡ **Risposta:**



---

## 2. Firma digitale

Con l'opzione PEC (1-B) o canale diretto (1-C) serve firma digitale CAdES (file `.p7m`) sull'XML.

**Domande:**
a) MF Depur ha già un certificato di firma digitale intestato alla società? Se sì, formato (HSM, USB, remota)?
b) Chi firma concretamente le fatture (legale rappresentante, delegato)?

➡ **Risposta:**



---

## 3. Aliquote IVA

I prodotti di MF Depur sono prodotti chimici per trattamento acque. Vorremmo sapere quali aliquote IVA possono essere applicate.

**Domanda:** Per la gamma attuale dei prodotti MF Depur, l'aliquota è sempre **22% (ordinaria)** oppure esistono prodotti con:
- **10%** (es. prodotti per uso agricolo/zootecnico/sanitario, D.P.R. 633/72 Tab. A parte III)
- **5%** o **4%** (casi specifici)
- **Esenzione** art. 10 D.P.R. 633/72

Se ci sono aliquote diverse, fornisci se possibile l'elenco (o i criteri per dedurle dalla categoria prodotto).

➡ **Risposta:**



---

## 4. Clienti UE / extra-UE (reverse charge & esenzioni)

**Domande:**
a) MF Depur vende (o prevede di vendere online) a **aziende UE** (Francia, Germania, Spagna, ecc.)? Se sì, bisogna applicare il **reverse charge** (inversione contabile, art. 7-ter D.P.R. 633/72, causale **N6.x**) con azzeramento IVA in fattura.
b) MF Depur vende a **clienti extra-UE** (Svizzera, UK, USA…)? Se sì, si tratta di **esportazione** (art. 8 D.P.R. 633/72, causale **N3.x**), IVA esente.
c) In caso di vendite UE: VIES registrazione OK? Modalità raccolta P.IVA e controllo validità VIES?

➡ **Risposta:**



---

## 5. Clienti Pubblica Amministrazione (split payment)

**Domanda:** MF Depur ha (o prevede) clienti **PA** (Comuni, ASL, università, società partecipate)? Se sì serve supportare la **scissione dei pagamenti** (art. 17-ter D.P.R. 633/72, split payment): in fattura l'IVA è esposta ma l'importo pagato dal cliente è solo l'imponibile. Inoltre le fatture PA devono indicare **CUP** (Codice Unico di Progetto) e/o **CIG** (Codice Identificativo Gara) quando applicabili.

➡ **Risposta:**



---

## 6. Numerazione fatture

Per legge la numerazione progressiva deve essere **univoca per ciascun anno solare** e **senza interruzioni / salti** (art. 21 D.P.R. 633/72). In azienda oggi quale convenzione si usa?

**Domande:**
a) Format numerazione (es. `FE/2026/0001` oppure `2026-0001` oppure solo `1, 2, 3…`)?
b) La numerazione si azzera il 1° gennaio di ogni anno?
c) Esistono **sezionali** separati per B2B vs B2C vs nota credito? (Sì/No e quanti)
d) In caso di cancellazione di un ordine prima dell'emissione fattura, il numero si salta o si riutilizza?

➡ **Risposta:**



---

## 7. Metodi di pagamento ammessi

Al momento pensiamo di offrire **carta di credito (via Stripe)** e **bonifico bancario**.

**Domande:**
a) Il **bonifico** viene ammesso in B2B? Il cliente riceve la fattura prima o dopo il pagamento?
b) Servono altre modalità (RID/SDD, cambiale, riba, contrassegno)?
c) Per il bonifico: esiste già un **IBAN** specifico MF Depur da inserire in email di istruzioni?
d) **Termini di pagamento standard** (30/60/90 gg fine mese / riba a vista)? Serve indicarli in fattura (campo `DatiPagamento.DataScadenza`)?

➡ **Risposta:**



---

## 8. Conservazione sostitutiva a norma

Le fatture elettroniche vanno **conservate a norma** per almeno **10 anni** (art. 2220 c.c. + Provv. AdE 2014).

**Domanda:** MF Depur ha già un **servizio di conservazione sostitutiva** (es. Aruba Conservazione, Legalinvoice, InfoCamere)? Oppure va attivato? Il prezzo è solitamente incluso col SaaS scelto al punto 1, o è separato?

➡ **Risposta:**



---

## 9. Invio fattura al cliente

**Domande:**
a) Al cliente B2B serve recapito fattura via **SDI → codice SDI o PEC** (obbligatorio). Il nostro form di registrazione richiede `codice SDI` e `PEC` — va bene chiederli entrambi opzionali (uno solo è obbligatorio per SDI)?
b) In **aggiunta** al canale SDI, inviamo una **copia di cortesia via email** (PDF) al cliente? Se sì, va indicato esplicitamente "copia non fiscale" sul PDF?

➡ **Risposta:**



---

## 10. Spedizione e costi accessori

I prodotti sono fustini/taniche di chimico — pesi variabili, destinazioni Italia (forse UE in futuro).

**Domande:**
a) Il **costo di spedizione** va esposto in fattura come **riga separata** o incluso nell'imponibile?
b) Aliquota IVA della spedizione: segue quella dei prodotti principali o è sempre 22%?
c) Esiste un **tariffario corriere** (DHL/GLS/SDA/Bartolini…) con cui calcolare il costo per provincia/peso? Oppure costo spedizione forfait?
d) **Porto franco** vs **porto assegnato**: il cliente può scegliere?

➡ **Risposta:**



---

## 11. Rimborsi e note di credito

**Domande:**
a) Quali causali prevedete (reso merce non conforme, annullamento ordine, sconto post-fattura)?
b) La nota di credito usa numerazione **stessa sequenza** delle fatture o sezionale dedicato?
c) In caso di pagamento Stripe già incassato: refund totale o parziale? Entro quanti giorni?

➡ **Risposta:**



---

## 12. Controllo P.IVA / VIES / anagrafica cliente

**Domande:**
a) Vogliamo validare la **P.IVA** al momento della registrazione (chiamata a servizio Agenzia Entrate o VIES per clienti UE)? Rallentare la registrazione è accettabile?
b) La registrazione va approvata manualmente dall'admin MF Depur (oggi è così nel sistema) — va bene continuare?

➡ **Risposta:**



---

## 13. Varie

**Domande:**
a) Esistono **vincoli di importo minimo fattura** (es. niente fatture < 50 €)?
b) Esistono **sconti commerciali** (per volume, per cliente affezionato) da modellare? Come si applicano in fattura (riga sconto vs prezzo unitario ridotto)?
c) **Anagrafica prodotti**: servono codici particolari (es. **conto corrispettivi**, **natura merce** per dogana se extra-UE)?
d) Esistono **certificazioni di prodotto** (schede di sicurezza, reg. REACH) da allegare a fattura o ordine?
e) **Privacy/GDPR**: va bene la cancellazione account con anonimizzazione utente ma conservazione ordini/fatture per 10 anni?

➡ **Risposta:**



---

## Output atteso

Una volta raccolte le risposte, possiamo procedere a scrivere il codice per:
- generazione XML FatturaPA v1.2.2 conforme
- integrazione canale SDI scelto
- calcolo IVA multi-aliquota se serve
- reverse charge / split payment
- numerazione progressiva corretta
- salvataggio fatture in conservazione a norma
- email / download cliente

**Riferimento tecnico:** tutti i dettagli tecnici sono in `docs/audit/2026-04-23/11-eshop-fiscal.md` + `99-MASTER.md` (sezione M2).
