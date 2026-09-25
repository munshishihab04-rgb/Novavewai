# Fix 1 — R1-AUTH-EXPIRY e R1-PRIVACY-REAUTH

## Esito e perimetro

Correzione implementata e verificata localmente sui due difetti richiesti. **Questo rapporto non costituisce una nuova approvazione indipendente.** `evidence/review-1/verdict.json` rimane immutato, con `passed: false`; occorre un nuovo riesame indipendente per cambiare il gate.

Unico progetto utilizzato: `/home/azureuser/nova-community-agent`. Nessun accesso a prodotti precedenti, servizio esterno, provider o invio reale. Nessuno staging o commit. Nessuna modifica a migrazioni, worker, dipendenze, API pubbliche o test originali.

## Riproduzione e causa

Prima di modificare `src`, sono stati eseguiti i due comandi di riproduzione esatti della review:

```sh
node --import tsx --test --test-concurrency=1 --test-name-pattern='AUTH-EXPIRY mutation' evidence/review-1/adversarial.test.ts
node --import tsx --test --test-concurrency=1 --test-name-pattern='AUTH-(EXPIRY|REVOKE) (export|purge)' evidence/review-1/adversarial.test.ts
```

- `red-auth-expiry.log`: 1 fallimento, HTTP 201 invece di 401; una conversazione scritta dopo scadenza. Exit 1.
- `red-privacy-reauth.log`: 4 fallimenti, HTTP 200 invece di 401; export di dati o purge dopo scadenza/revoca. Exit 1.
- Baseline completa dei quattro file `src/*.ts` conservata in `baseline-src/` prima di ogni modifica, insieme a stato Git, diff dell'indice e diff del working tree iniziale (vuoto).

Le ipotesi sono state isolate tramite attesa del lock verificata in `pg_stat_activity`, conferma della scadenza tramite SQL e revoca committata prima del rilascio:

1. `now()` congelato a BEGIN: spiega il POST autorizzato dopo scadenza durante l'attesa; confermato dalla riproduzione.
2. Recheck della sessione assente nelle transazioni privacy: spiega export/purge dopo scadenza e revoca; il POST con sessione cancellata è il controllo già funzionante.
3. Recheck non vincolato all'owner originale: un token cancellato e reinserito per un altro owner rimaneva accettato per il vecchio owner. Verificato come controllo della corretta associazione owner+token richiesta, non come nuova funzionalità di gestione sessioni.

## Modifiche minime

- `src/app.ts`: aggiunto `authenticatedOwner(c, r)`. Acquisisce prima il lock dell'owner attivo tramite `active`, poi esegue una query separata che richiede **owner originale + hash del token originale + expires_at > clock_timestamp()**. Usato da `mutate` prima di leggere la cache idempotente o eseguire operazioni protette.
- `src/privacy.ts`: export e purge chiamano lo stesso helper dentro le rispettive transazioni, prima di leggere contenuti o modificarli. Proiezioni export, tombstone, ordine delle cancellazioni e cascade invariati.
- `tests/auth-revalidation.test.ts`: 12 regressioni permanenti adattate dalla review, senza modificarla: scadenza, revoca e token riassegnato tramite intervento locale di test, ciascuna su nuova mutazione, replay idempotente, export e purge. Una seconda sessione valida dello stesso owner resta presente per verificare che non possa sostituire il token originale. Ogni caso verifica 401, body esatto `{error: 'unauthorized'}` e assenza di modifiche a owner, conversazioni, task, cache idempotente e outbox.

I nuovi test sono stati eseguiti **prima** della correzione:

```sh
node --import tsx --test --test-concurrency=1 tests/auth-revalidation.test.ts
```

`red-permanent-regressions.log`: 12 test, 10 fallimenti attesi, 2 controlli già verdi (revoca POST e replay); exit 1. Incluso il replay di una risposta già in cache con sessione scaduta mentre aspettava il lock.

## Verifica dopo la correzione

Tutti i comandi eseguiti dalla root del progetto:

| Comando | Esito | Evidenza |
|---|---|---|
| Primo comando esatto della review, riportato sopra | 1/1, HTTP 401, nessuna scrittura tardiva; exit 0 | `green-auth-expiry.log` |
| Secondo comando esatto della review, riportato sopra | 4/4, HTTP 401, owner ancora attivo; exit 0 | `green-privacy-reauth.log` |
| `npm test` | 26/26: 14 originali + 12 regressioni; nessun test saltato; exit 0 | `green-full-suite.log` |
| `node --import tsx --test --test-concurrency=1 evidence/review-1/adversarial.test.ts` | 10/10, nessun test saltato; exit 0 | `green-adversarial.log` |
| `npm run typecheck` | exit 0 | `typecheck.log` |
| `git diff --check` | exit 0 | `verification.json` |
| `sha256sum -c evidence/fix-1/review-original.sha256` | tutti gli originali review invariati | `verification.json` |
| Confronto byte-per-byte di `git diff --cached --binary` con `baseline-index.diff` | indice invariato | `verification.json` |

`verification.json` contiene conteggi estratti e verificati dai log, SHA-256 delle baseline confrontate con l'indice iniziale e controlli di perimetro. Le sole modifiche a file tracciati preesistenti sono `src/app.ts` e `src/privacy.ts`; il test permanente e la cartella `evidence/fix-1/` sono nuovi.

La suite avversaria originale comprende anche la terminazione reale della connessione PostgreSQL dopo I/O sintetico, recovery senza secondo invio, serializzazione durante lavoro in flight e non-resurrezione dopo timeout/purge: tutti eseguiti senza alterare le asserzioni.

## Limiti residui e note

- Il punto di autorizzazione è la verifica con orologio corrente **dopo l'acquisizione del lock owner**. Non si promette che una sessione rimanga valida fino alla consegna della risposta o per operazioni già iniziate; non sono stati introdotti nuovi lock di sessione o endpoint di revoca.
- Revoca e reinserimento del token nei test sono interventi locali controllati dell'operatore. L'aggiornamento diretto dell'owner della sessione resta proibito dai trigger; nessuna loro disabilitazione.
- I test usano PostgreSQL isolato e HTTP reali; la finestra di scadenza è temporale, ma l'attesa effettiva del lock e la scadenza vengono verificate esplicitamente. Nessun segreto viene stampato.
- Suggerimento non bloccante `R1-WORKER-BATCH-CLARITY` fuori dal fix: non occorre modificare worker o documentazione per correggere questi due difetti. Un batch concluso non dimostra che tutta la coda sia vuota quando vi sono candidati occupati/SKIP LOCKED; la precisazione resta disponibile al riesame successivo. Nessuna nuova semantica di dispatch introdotta.
- Restano tutti i limiti della foundation descritti in `docs/API.md`, incluso l'obbligo di review indipendente prima di avanzare release gate.
- Un primo tentativo di applicazione della patch è stato rifiutato per contesto non univoco; nessun file era stato modificato. Il secondo tentativo ha usato contesti distinti. Nessun altro blocco di esecuzione.
