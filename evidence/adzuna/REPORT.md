# Adzuna (API ufficiale) nel job finder · pubblicato 2026-10-01

Via legittima prevista dalla decisione `docs/decisions/2026-10-01-subito-pagination.md` (criterio di uscita C). App registrata dall'owner il 2026-10-01; credenziali **solo** in `~/.local/share/nova-community-trial/trial.env` (mode 600, `NOVA_ADZUNA_APP_ID`/`NOVA_ADZUNA_APP_KEY`), mai in codice, log, receipt o provenance (test).

## Cosa cambia per l'utente (dal vivo, origine pubblica, modello reale)
| Ricerca | Prima (Subito + JSON-LD) | Ora (con Adzuna) |
|---|---|---|
| cameriere · Bologna, prima ricerca | 25 | **60** (34 Adzuna · 23 Subito · 3 Restworld) |
| cameriere · Bologna, «altre offerte» | 29 | **64** |
| cameriere · Milano, prima ricerca | 28 | **49** |
| cameriere · Milano, «altre offerte» | 82 | **120** (66 Adzuna · 51 Subito · 3 Restworld; Adzuna segnala 146 totali) |
Le schede Adzuna mostrano **azienda** («Stay Over Srl», «Markas», «Doppio Malto»…), **data di pubblicazione**, contratto e retribuzione quando dichiarati — informazioni che le card Subito non hanno. Riepilogo: «Adzuna segnala N annunci in totale».

## Implementazione (TDD, 6 test nuovi, suite 272/272, typecheck 0)
- `src/jobs-adzuna.ts`: adapter bounded (50/pagina, 1 pagina alla prima ricerca, fino a 3 su «altre offerte», `max_days_old=60`, ordinati per data, cache 6 h), record compatti (niente descrizione/contatti), codici onesti `adzuna_auth|adzuna_rate_limited|adzuna_unavailable|adzuna_bad_response`, mai risultati inventati, stop anticipato su pagina vuota. Filtro pertinenza titolo (stem italiano) come per Subito; città vs provincia da `location.display_name`; agenzie riconosciute dal nome azienda (Adecco, Eurofirms, Manpower…); **mai `DIRECT_EMPLOYER`** senza evidenza; `source_type:'AGGREGATOR'`.
- `src/agent.ts`: Adzuna si unisce a JSON-LD/Subito nella stessa ricerca (dedup per URL); receipt `adzuna:{count,pagesRead,jobsReturned,blocked}`; risultato limitato a 60 (120 su «altre offerte») per il budget di contesto.
- `public/app.js` (+ copia staging identica, test): card «Adzuna» con azienda, Pubblicato, Contratto, Retribuzione (dichiarata dall'aggregatore), nota «API ufficiale… disponibilità non verificata».
- `src/identity.ts`: capability `jobs_search` cita Adzuna.

## Bug trovato dal vivo e corretto
Primo deploy: Adzuna restituiva 50 record ma ne arrivava **1**. Causa: lo scrubber anti-telefono trasformava gli id a 10 cifre (`5905190705`) in `[omesso]`, collassando tutto su una chiave. Il fixture usava id corti e non lo vedeva → fixture riscritto con id reali a 10 cifre, id esclusi dallo scrubber. Seconda prova: 34 opportunità Adzuna per cameriere/Bologna.

## Limiti dichiarati
- Adzuna è un aggregatore: azienda, data e località sono quelle che pubblica lui; il link porta alla pagina Adzuna che rimanda all'annuncio originale. Disponibilità non verificata.
- Quota API gratuita Adzuna: non misurata; in caso di 429 il receipt dice `adzuna_rate_limited` e le altre fonti continuano.
- Pre-esistente, fuori perimetro: le card «ricerca/suggerimento» e «pagina non disponibile» in fondo alla lista mostrano ancora timestamp ISO grezzi e la parola `UNAVAILABLE` in inglese.
- Subito con paginazione resta attivo in parallelo (decisione B, temporanea). Con Adzuna attivo la revisione del 2026-12-01 ha ora una base concreta per spegnerlo.
