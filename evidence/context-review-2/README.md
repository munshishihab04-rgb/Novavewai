# Re-review indipendente circoscritta — R1

## Esito

**PASS: R1 chiuso.** La slice **context/messages/provenance/files** di NEW Nova è chiusa per questo gate; è consentito proseguire con lo sviluppo **agent core**. Non è un'approvazione completa J0 né un'autorizzazione alla produzione.

Nessun blocker di sicurezza o logica rilevato nella correzione e nelle integrazioni esaminate.

## Verifiche indipendenti

- Suite permanente `tests/idempotency-files.test.ts`: **9/9**.
- Riproduzione originale adattata alle aspettative corrette: **1/1**. Operazione concorrente `409 idempotency_conflict`, upload originale `201 ready`, un solo blob/evento/cache, download reale corretto e replay identico dopo riavvio reale PostgreSQL/app.
- Sei controlli precedenti non interessati: **6/6**, incluso R2 come osservazione già documentata, non come nuovo gate.
- Suite preesistente di rivalidazione autenticazione: **12/12**, scadenza/revoca/rebind dopo attesa lock, anche prima del replay.
- Stesse nuove asserzioni contro lo snapshot pre-fix: **fallimento atteso**, precisamente `201` invece di `409`; confermata la sensibilità della riproduzione al difetto originale.
- Typecheck e `git diff --check 75e1600`: exit 0.

I risultati della suite completa 48/48 riferiti dall'implementatore non sono attribuiti a questa esecuzione indipendente.

## Revisione del codice

`fix-vs-baseline.diff` e `baseline-comparison.json` mostrano che soltanto `src/app.ts` e `src/files.ts` differiscono dallo snapshot della correzione. Migrazioni, lifecycle, privacy, azioni, contesto e provenienza dello snapshot sono invariati.

- `src/app.ts:60–69,86–96`: lookup comune di risultati completati **e** prenotazioni `files.request_key`, dopo lock owner autenticato e prima di ciascuna callback mutante. I wiring `153–157`, `src/context.ts:8`, `src/provenance.ts:8,29` e tutte le mutazioni di `src/actions.ts` usano quel wrapper.
- `src/files.ts:35–44`: stesso lookup prima della prenotazione. Stesso owner/key in conflitto non arriva a callback DB, lettura file della source, prenotazione o scrittura blob. Owner diversi restano indipendenti.
- `src/files.ts:48–56`: finalizzazione invariata, con nuovo lock e controllo dello **specifico UUID prenotato** prima dell'I/O, rivalidazione sessione dopo l'I/O, commit atomico ready/event/cache. Non richiama il helper che respingerebbe la sua stessa prenotazione: la protezione del namespace è già stabilita alla prenotazione e applicata a ogni concorrente. Se recovery rimuove quella prenotazione, la richiesta vecchia viene cancellata prima del put e non può finalizzare la sostitutiva.
- `src/file-lifecycle.ts:13–20`: recovery rilascia solo righe pending dell'owner e cleanup per UUID; non elimina cache completate per key. Controllati guasti DB/FS reali, retry dopo recovery, sostituzioni e collisione legacy.
- `src/privacy.ts:30–45`: purge circoscritto all'owner, senza cancellare cache omonime dell'altro owner.
- Auth, clock DB e controlli prima/dopo I/O non modificati. Nessuna nuova semantica auth introdotta.

## Comandi esatti

Working directory per tutti i comandi: `/home/azureuser/nova-community-agent`.

```sh
pwd && git status --short && git diff --stat
git diff --no-index evidence/context-fix-1/baseline/src/app.ts src/app.ts
git diff --no-index evidence/context-fix-1/baseline/src/files.ts src/files.ts
git diff --check
node --version
python3 evidence/context-review-2/review_runner.py prepare
python3 evidence/context-review-2/review_runner.py tests
python3 evidence/context-review-2/review_runner.py verify
# Prima verifica: rilevate solo cache Node/tsx; risultato iniziale preservato.
python3 evidence/context-review-2/review_runner.py cleanup-caches
python3 evidence/context-review-2/review_runner.py verify
python3 evidence/context-review-2/finalize.py
```

`commands.jsonl` registra ogni sottocomando realmente eseguito dal runner, cwd, TMPDIR e codice di uscita atteso; `results.jsonl` conserva i primi risultati. `verified-results.json` riporta i conteggi ricalcolati e validati direttamente dai log.

Problema del solo harness: il parser iniziale attendeva output TAP `#`, mentre Node v26.8.2 ha emesso il reporter `ℹ`. Log preservati; parser corretto esclusivamente in questa directory e conteggi verificati da `finalize.py`. Nessun fallimento applicativo sul candidato.

## Preservazione e limiti

`protected-before.json`, `protected-after.json`, `cleanup-and-preservation.json` attestano integrità di sorgenti/test/documentazione/evidenze originali e assenza di residui propri PG/FS. Tutte le scritture del reviewer, inclusi dati temporanei dei test, sono confinate a `evidence/context-review-2/`; i dati temporanei sono poi rimossi dai fixture. Nessun commit, installazione, accesso legacy o chiamata esterna.

Resta invariato il contratto single-active-instance dell'adapter locale cifrato. Non vengono riaperti multi-instance, cloud/KMS o altri gate di produzione. La vecchia asserzione che richiedeva il bug è preservata e non viene conteggiata come acceptance.
