# MF Depur — Istruzioni di progetto

## Regole comportamentali

- Fai ciò che viene chiesto; niente di più, niente di meno.
- NON creare file se non strettamente necessario all'obiettivo.
- Preferisci sempre modificare un file esistente piuttosto che crearne uno nuovo.
- Non creare file di documentazione (*.md, README) senza richiesta esplicita.
- Non salvare file di lavoro, note o test nella root del progetto.
- Leggi sempre un file prima di modificarlo.
- Non committare mai segreti, credenziali o file `.env`.
- Testi UI in italiano.

## Organizzazione file

- `shop/` — applicazione Node/Express del negozio (codice principale del progetto)
- `docs/` — documentazione e markdown
- `scripts/` — script di utilità
- Non usare la root per file temporanei

## Architettura

- Domain-Driven Design, bounded context chiari
- File sotto 500 righe
- Interfacce tipate per le API pubbliche
- Validazione input ai confini del sistema
- Niente inline JS nelle viste (CSP con nonce già attivo)

## Build & Test

```bash
npm run build
npm test
npm run lint
```

- Eseguire i test dopo ogni modifica al codice
- Verificare che il build passi prima di committare

## Sicurezza

- Non hardcodare API keys, segreti o credenziali nel codice sorgente
- Non committare `.env` o qualsiasi file con segreti
- Validare sempre l'input utente ai confini del sistema
- Sanificare i path per evitare directory traversal
- Stripe: webhook fail-close su secret/rawBody/firma mancanti
- HTTPS redirect + HSTS in produzione, CSP con nonce senza `unsafe-inline`
