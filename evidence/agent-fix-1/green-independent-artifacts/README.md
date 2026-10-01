# Review indipendente J1 — esito NON APPROVATO

Base: `43e981937cfeadfef5e38c9d40d856bffc6b7c23` nella sola repository `/home/azureuser/nova-community-agent`.

## Riproduzione

Dalla root della repository:

```sh
node --import tsx --test --test-concurrency=1 evidence/agent-review-1/adversarial.test.ts evidence/agent-review-1/lease-loss.test.ts
node --import tsx --test --test-concurrency=1 tests/agent.test.ts tests/agent-restart.test.ts tests/agent-config.test.ts
npm run typecheck
```

I due harness creano PG privati tramite `tests/helpers.ts`, provider HTTP controllati solo su `127.0.0.1`, applicazioni HTTP reali e file temporanei. La perdita lease usa il child esistente `tests/agent-child.ts` con ambiente minimo e configurazione PG effimera. Nessun provider reale né credential lookup. Le assertion dei quattro finding esprimono il comportamento corretto: falliscono sulla versione esaminata, non sono assertion che rendono verde il bug.

## Risultati verificati

- `adversarial-corrected-harness.log`: 9 test, 5 pass, 4 failure; nessun test cancellato.
- `existing-agent-suite.log`: 38 test, tutti pass, inclusi SIGKILL/restart, purge/cancel/revoke e modifiche di contesto dopo provider await, limiti, scope e ruoli.
- `typecheck.log`: exit 0.
- `verdict.json`: motivazione, severità, file:line, comportamento osservato e atteso per ogni finding.
- Nove snapshot JSON contengono lo stato riletto dal DB e/o le risposte HTTP effettive. Non sono output sintetici.

## Finding

1. `writer-session-expiry.json`: revisione 2 e receipt persistite dopo scadenza naturale della sessione, poi run failed/session_revoked. Attesa riprodotta con un lock PG sul writer; non è una simulazione del risultato del writer.
2. `assistant-source-provenance.json`: testo realmente persistito come role=assistant accettato da `/sources` come trust=user_supplied. Non diventa verified, ma perde l'origine generata.
3. `startup-pending-upload.json`: il secondo runtime, pur rifiutato dal singleton, cancella l'upload pending del primo, liberando la chiave per una turn diversa; upload originale 409 e turn 201/completed.
4. `lease-loss.json`: terminazione del solo backend singleton produce errore Client non gestito, exit 1 e run running/inference_in_flight. Nessuna doppia inferenza dimostrata: il comportamento osservato è fail-stop non controllato.

## Controlli indipendenti riusciti

- `pending-idempotency-control.json`: nel percorso normale, una chiave di upload pending blocca la turn; upload originale conclude 201 e zero inferenze.
- `generation-fence.json`: cancel, nuovo run, risposta vecchia tardiva e replay originale; soltanto il nuovo assistant persiste, senza artifact tardivi né ridispatch.
- `exact-session-fence.json`: una seconda sessione valida dello stesso owner non autorizza il vecchio run con sessione iniziante revocata.
- `batch-allowlist.json`: tool valido seguito da `constructor` è rifiutato prima della prima mutazione.
- `receipt-atomicity-redaction.json`: errore DB durante receipt annulla artifact/revisione/outbox, non ripete inferenza sul replay e non espone il dettaglio privato DB né checkpoint/session_hash nell'export.

## Limiti e incidenti del harness

`adversarial.log` è il primo giro (7 test); `adversarial-final.log` è un tentativo intermedio interrotto dal timeout. Quest'ultimo non è la prova finale: il probe sessione provava a cambiare la riga mentre un trigger aspettava l'owner lock. L'harness è stato corretto impostando la scadenza prima del rilascio del provider, lasciandola poi scadere naturalmente durante il lock del writer. Il giro successivo completo è `adversarial-corrected-harness.log`.

La review non usa come prova il report TDD originale. Non è stata rieseguita tutta la suite foundation da questo reviewer. Non si afferma sicurezza semantica del prompt o qualità del ragionamento: il protocollo controllato verifica solamente orchestrazione e confini applicativi. Inferenza reale **NON VERIFICATA**, senza porre UI, ricerca o credenziali come requisiti bloccanti della review.

Nessuna implementazione o test originale modificato; nessun commit. Tutti i deliverable della review sono in questa directory.
