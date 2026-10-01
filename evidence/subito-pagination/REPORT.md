# Subito: paginazione bounded (decisione B del product owner) · pubblicato 2026-10-01

Decisione: `docs/decisions/2026-10-01-subito-pagination.md` (opzione **B** scelta dall'owner; raccomandazione Hermes era A+C).
Registrazione: `~/.local/share/nova-community-trial/subito-pagination-decision.json` (chi, quando, rischio, revoca) + flag `NOVA_JOBS_SUBITO_PAGINATION=owner-accepted` in `trial.env`.

## Cosa fa ora l'utente
- Prima ricerca: **pagina 1 intera** (30 card invece di 20: il cap interno buttava via annunci già scaricati).
- «Voglio altre offerte» / «ancora» / «Aro offer dekhaw» / «আরো» / «more»: Nova **agisce** (prima: faceva domande) → stessa ricerca estesa a **max 3 pagine Subito** (≥2 s di pausa fra pagine, dedup Vetrina, stop anticipato se una pagina non aggiunge nulla), ricevuta `moreOffers:true` + `subito.pagesRead`, scheda riepilogo «N annunci trovati · ricerca estesa · 3 pagine Subito lette».
- La paginazione **non** parte mai da sola alla prima ricerca; senza flag l'adapter resta a pagina 1 anche se richiesto (test).

## Prova dal vivo (origine pubblica, modello reale)
| Turno | Milano | Bologna |
|---|---|---|
| «Bologna/Milano» (prima ricerca) | 28 annunci · 30 card · 1 pagina | 26 · 30 · 1 |
| «Voglio altre offerte» | **82 annunci · 90 card · 3 pagine** | 29 · 31 · 3 (Bologna ha solo 31 risultati: stop anticipato) |
| «Aro offer dekhaw» | 80 · cache hit (nessuna richiesta in più a Subito) | — |
Risposta del modello (Milano): «Ho trovato altre 70 offerte… 68 da annunci Subito osservati… le schede sotto le coprono tutte».

## Difetto trovato e corretto durante la prova
Il primo deploy falliva su Milano con `context_budget`: 90 card × ~950 byte superavano il budget di contesto del run. Corretto riducendo la card Subito (claim condiviso una volta in `provenance.claim`, campi nulli omessi → ~780 byte) e concedendo un **headroom limitato (+48 KB) solo al risultato di una ricerca estesa esplicita** (`moreOffers:true`), sia al momento del tool result sia alla ripresa dal checkpoint. Test dedicato con budget stretto.

## Test (suite 266/266, typecheck 0)
`tests/jobs-subito-pagination.test.ts`: flag separato; adapter (pagina 1 sola alla prima ricerca, o=2/o=3 con pausa, dedup, cap 3 anche se chiesto 9, flag off → nessun `o=`); `wantsMoreOffers` IT/Banglish/Bangla/EN e negativi; dispatcher nativo (seconda ricerca reale con pages=3, non `jobs_retry_suppressed`); budget; renderer (riepilogo distinto, dedup card per URL). Il vecchio test «never paginates» resta verde con flag off.

## Rischi che restano (accettati dall'owner con B)
- Violazione delle direttive macchina `Disallow: */?o=*` / `*&o=*` di Subito su richiesta esplicita dell'utente; possibile blocco Akamai che colpirebbe anche la pagina 1 per tutti. Monitorare `blocked:'jobs_access_blocked'` nei receipt; revoca = togliere il flag e riavviare.
- Il conteggio nel testo del modello («70») può differire dalle schede (82): le schede sono la fonte.
