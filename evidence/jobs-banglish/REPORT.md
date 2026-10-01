# Job finder: diagnosi e correzione (utenti Bangla/Banglish) · pubblicato 2026-10-01

## Cosa segnalava l'utente
«Il job finder non mostra più risultati precisi come prima con moltissime offerte recenti da Subito».

## Cosa ho verificato prima di toccare il codice
- Flag Subito ancora attivo nel servizio (`NOVA_JOBS_SUBITO_AUTOMATED_ACCESS=owner-accepted`), adapter funzionante: smoke in italiano «cameriere → Bologna» = **15 annunci, 20 card Subito lette** (nessuna regressione per l'italiano).
- Letti i **receipt reali** delle ultime 24 h di `jobs_search` sul DB di produzione (non il messaggio all'utente): le ricerche fallite erano tutte di utenti che scrivono in **Banglish**. Subito veniva interrogato con la frase grezza (`q=amr kaj lagbe`, `q=amake kaj khuje deo ekta`, `q=sii`, `q=part time`, `q=milano te`) → **0 card**. Il modello aveva proposto l'occupazione giusta (`lavoro`, `aiuto cuoco`, `barista`, `magazzino`), ma il grounding lessicale italiano (`resolveCurrentJobRequest`) sostituiva la proposta con l'ultimo turno utente, qualunque cosa fosse.
- Secondo difetto trovato nei transcript: 3 run in cui il modello **prometteva** («Certo — cerco barista a Bologna. Vuoi anche part-time…?») **senza chiamare lo strumento** → nessuna scheda.

## Correzioni (TDD, 5 test nuovi, suite 260/260, typecheck 0)
1. `src/jobs-live.ts` — grounding: le frasi in Bangla/Banglish e i turni di follow-up («Sii», «Part time», «Aro offer dekhaw», «Milano te») non diventano mai l'occupazione; se nessun turno utente contiene una parola di mestiere italiana, si accetta l'occupazione **proposta dal modello**, limitata (≤3 parole, termine valido, niente URL/qualifiche, niente «lavoro/kaj» generici). **La città continua a venire solo dall'utente** (il modello non può inventarla). Test: `tests/jobs-banglish-grounding.test.ts` (transcript reali).
2. `src/agent.ts` — recupero «promessa senza azione»: se la risposta annuncia una ricerca di lavoro, non chiama nessuno strumento e occupazione+città sono ricavabili **dai soli turni utente**, il server esegue la `jobs_search` promessa e registra l'evento `tool.recovered` (auditabile). Test: `tests/jobs-promise-recovery.test.ts` (provider controllato con lo stesso comportamento osservato dal vivo; nessun recupero senza città o senza promessa).
3. Prompt: chiamare `jobs_search` appena ci sono mestiere+città, **mai** chiedere prima orari/contratto/esperienza; con utenti Bangla/Banglish passare la parola italiana del mestiere; nella risposta dire quanti annunci e rimandare alle schede, senza ricopiare URL parziali.

## Prova dal vivo dopo il deploy (`live-trial-banglish.json`, origine pubblica, modello reale)
- «Amake kaj khuje deo, cameriere hisebe» → chiede la città ✔
- «Bologna» → **16 annunci** (20 card Subito lette) · risposta: «Ho trovato 12 opportunità… 6 Bologna città, 6 provincia… le schede qui sotto…» ✔
- «Barista» → **13 annunci** (20 card Subito) senza domande sulle preferenze ✔ (prima: promessa e zero schede)
- Regressione italiano «Cerco lavoro come cameriere → Bologna»: 15 annunci ✔

## Limiti dichiarati
- Il riconoscimento Banglish è una lista di parole funzione (≈45 termini), non comprensione linguistica: frasi Banglish insolite possono ancora passare come «occupazione» e dare 0 card; in quel caso ora almeno la proposta del modello viene usata.
- Il recupero copre solo la promessa di ricerca lavoro, non altri strumenti.
- Il numero «12» nel testo del modello vs 16/13 nelle schede: il modello conta a modo suo; le schede sono la fonte. Non ho forzato il conteggio nel testo.
