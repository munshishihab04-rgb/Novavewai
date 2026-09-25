# Review indipendente 1 — FAIL

Ambito: intero `git diff --cached -- src scripts migrations tests package.json`, più `docs/API.md`. Working tree dei file applicativi uguale all'indice al momento della review. Nessuna modifica applicativa, commit, servizio cloud o invio esterno.

## Risultato

- `verdict.json`: verdetto strutturato, due problemi bloccanti di rivalidazione sessione.
- `adversarial.test.ts`: dieci test indipendenti su PostgreSQL reale del harness esistente; solo fixture sintetiche locali.
- `adversarial-final.log`: cinque pass, cinque fail. I fail sono attesi e dimostrano i due problemi, non cinque difetti distinti.
- `baseline-tests.log`: suite originale, 14 pass.
- `typecheck.log`: typecheck applicativo riuscito (non include necessariamente i test in evidence).
- `crash.log`: fault injection mirata, terminazione reale della connessione PostgreSQL dopo I/O sintetico; recovery unknown senza reinvio.
- `adversarial.log`: prima esecuzione conservata. Include un errore del test di crash dovuto all'evento `error` della connessione intenzionalmente interrotta non ancora intercettato dal harness del reviewer. Corretto esclusivamente il test in evidence aggiungendo listener alle connessioni acquisite; non è un difetto applicativo aggiuntivo. La riesecuzione isolata e quella finale passano.

## Riproduzione esatta

Dalla directory `/home/azureuser/nova-community-agent`:

```sh
# R1-AUTH-EXPIRY: now() congelato all'inizio transazione
node --import tsx --test --test-concurrency=1 --test-name-pattern='AUTH-EXPIRY mutation' evidence/review-1/adversarial.test.ts

# R1-PRIVACY-REAUTH: export/purge non rivalidano la sessione
node --import tsx --test --test-concurrency=1 --test-name-pattern='AUTH-(EXPIRY|REVOKE) (export|purge)' evidence/review-1/adversarial.test.ts

# Suite completa indipendente: attualmente exit 1 (5 fail attesi)
node --import tsx --test --test-concurrency=1 evidence/review-1/adversarial.test.ts

# Controlli indipendenti di recovery/isolation: exit 0
node --import tsx --test --test-concurrency=1 --test-name-pattern='CONTROL' evidence/review-1/adversarial.test.ts

npm test
npm run typecheck
```

I test non stampano token o password; creano e distruggono esclusivamente cluster PostgreSQL privati del harness. Il blocco esplicito della riga owner riproduce lo stesso punto di serializzazione usato dal worker. Le richieste entrano mentre la sessione è valida; la violazione osservata avviene dopo l'attesa, al momento della rivalidazione/autorizzazione dell'operazione. Non si sostiene che richieste iniziate con token già scaduto superino onRequest.

La revoca della sessione è simulata con DELETE operatore sul DB locale, non con un endpoint inesistente. Le varianti con scadenza sono autonome e dimostrano il problema senza introdurre funzionalità fuori ambito.
