# Jobs generic 1 — implementazione candidata, non deployata

## Risultato

Percorso nativo `jobs_search` ora source-neutral e non limitato a 12 mestieri/comuni. Accetta termini occupazione validati e comuni fuori dizionario, chiede la città mancante, consente città assente solo per intento remoto esplicito. Default: **link originali di ricerca, non offerte inventate**. Record importati consentiti vengono presentati come osservazioni datate con disponibilità attuale non verificata; inserzionista UNKNOWN è ammesso, salvo richiesta corrente di soli datori diretti.

**Subito automatico resta disabilitato.** Il commento robots conservato in `evidence/subito-claude-1/robots.txt` vieta accesso automatico senza permesso. Il vecchio `NOVA_JOBS_SUBITO_POLICY_REFERENCE` non può più attivare il browser: la review non è autorizzazione. Nessuna raccolta Subito, API esterna, credenziale, deployment, restart, commit o dato utente di produzione utilizzato. Nessuno dei 25 annunci storici è stato seminato nel runtime.

## Diagnosi e correzioni

- `jobIntent` applicava un dizionario finito di ruoli/città; il grounding nativo aveva un secondo elenco di città e restituiva la query del modello. Rimosso il dizionario dei ruoli dal percorso; il vecchio elenco città rimane solo come compatibilità lessicale/URL legacy, non come filtro di ammissione.
- `jobs-input.ts`: normalizzazione Unicode/spazi, limiti e charset, blocco URL/operatori di query; estrazione lessicale conservativa. «Sono bravo a cucinare» è un indizio `cuoco`, mai una qualifica. `cameriere ai piani` distinto da `cameriere`/sala.
- Grounding usa solo turni user autenticati; città proposta dal modello è ammessa soltanto quando riscontrata nel testo utente (suffisso occupazione+città o risposta città intera a ruolo pendente). Correzioni positive, negazione, cambio richiesta, ritiro preferenza no-agenzie e remoto hanno regressioni. Input non interpretabile chiede chiarimento, non autorizza query inventate.
- `GenericJobsService` è il default reale del dispatcher: URL Subito nazionale `q=ruolo città`, esplicitamente chiamato ricerca nazionale per parole chiave, **non** filtro geografico né vacancy. Il link conserva ruolo/città richiesta, provincia null, fonte, publisher UNKNOWN, stato NOT_FETCHED e spiegazione della provenienza.
- `jobRecords` è una dipendenza applicativa non esposta allo schema modello. Accetta record `permitted_import`, URL HTTPS pubblico, comune esatto o remoto esplicito, data raccolta valida; deduplica e limita 12 risultati. Conserva provincia dichiarata, data raccolta, data pubblicazione separata, fonte, publisher UNKNOWN in assenza di prova, stato UNKNOWN e last_verified_at null. Nessuna scadenza inferita dalla sola età.
- Ricerca web opzionale: una sola query bounded per coppia ruolo/città/run. Ruoli non hospitality non sono ristretti alle quattro fonti turistiche. Citazioni restano suggerimenti di navigazione, anche quando URL sembra dettaglio. Le letture pagina richiedono **sia** origine/path nel registro fisso **sia** autorizzazione server `jobPageAccess.authorizedOrigins` (vuoto di default); nessun parametro modello può autorizzarle. Subito non è nel registro.
- Nel percorso generico una pagina vecchia non viene scartata solo per soglia 60 giorni. Epoch/futuro e avviso esplicito scadenza restano distinti. Match ruolo usa titolo, richiede località osservata invece del footer e non confonde sala/ai piani; stato al massimo PARTIALLY_VERIFIED. Comportamento storico del metodo senza `generic` preservato per compatibilità, non usato dal dispatcher.
- Fences owner/session/cancel prima e dopo provider; aggiunto controllo prima del successivo I/O pagina dopo ricerca web. Duplicate same run non ripetono ricerca.
- `staging/jobs-generic-1/app.js`: copia candidata del renderer nativo, usa receipt/eventi effettivamente persistiti. Presenta domande, link ricerca, opportunità importate, stato/località/provincia/publisher e date separatamente; testo via textContent e link sicuri. **public/app.js non modificato**.

## Verifiche eseguite

- TDD: log RED separati in `tests/red-*.txt` (alcuni primi tracer bullet mostrano modulo mancante; test intent mostra programmatore undefined, poi regressioni funzionali). Conservati fallimenti intermedi, compresa prima typecheck con unreachable-code narrowing, poi corretta senza cambiare comportamento deny.
- `npm test`: **191 pass, 0 fail, 0 skipped**, `tests/full-suite-final.txt`. Precedente checkpoint 186/186 in `full-suite-1.txt` conservato.
- `npm run typecheck`: exit 0, `tests/typecheck-final.txt`.
- Test native controllati: exit 0, **4/4**, `tests/native-controlled-final.txt`. Server Fastify + PostgreSQL temporaneo reali, provider modello controllato, HTTP conversazione/turni/eventi reali. Nessuna API modello esterna.
- Native multi-turn: programmatore senza città → domanda; Imola → ricerca; Jesi correzione; customer care remoto → città facoltativa; saldatore Faenza doppia chiamata → un link/una ricerca e retry_suppressed. Receipt letto da HTTP eventi e renderizzato in Chromium: `native-events.json`, `native-receipt.png` (fixture tecnica, non screenshot trial).
- Native record importato: publisher UNKNOWN, provincia AN, raccolta 2024-01-01, last_verified_at null persistiti e riletti dagli eventi.
- Native revoca sessione e cancellazione durante ricerca web: zero letture pagine successive, zero receipt scritti.
- Held-out unit: programmatore, saldatore, magazziniere, badante, customer care remoto; Imola/Jesi/Faenza/Cuneo/San Lazzaro di Savena/Sant'Agata de' Goti; città mancante, correzioni, negazione, ambiguità, preferenze ritirate, injection URL/query, IPv6/private URL, deduplica, dato importato vecchio e UNKNOWN.
- Test storici non indeboliti né modificati. Tutti inclusi nella suite completa. La vecchia prova native-registry non fa più fetch reale perché il dispatcher ora nega origini senza grant, ma conserva l'asserzione EXPIRED/UNAVAILABLE e mai vacancy.
- `before-SHA256SUMS` verificato: public/app.js e report jobs-claude-1/subito-claude-1 invariati. Hash candidati ed evidenza in `SHA256SUMS`.

## File implementati/modificati

Nuovi: `src/jobs-input.ts`, `src/jobs-generic.ts`; `tests/jobs-generic{,-service,-native,-pages,-ui,-fences}.test.ts`; `staging/jobs-generic-1/app.js`.
Modificati: `src/jobs.ts`, `src/jobs-live.ts`, `src/jobs-subito.ts` (solo deny gate), `src/agent.ts` (ramo jobs/opzioni/istruzioni), `src/agent-tools.ts` (descrizione contratto).
Prove e snapshot prima modifica: questa directory. Altri lavori dirty/untracked preesistenti preservati.

## Limiti / gate ancora aperti

1. **Non è consegna di vacancy live universali né MVP-1 completo.** Senza import consentito o fonte autorizzata, restituisce link ricerca. Nessuna offerta reale nuova è stata trovata o verificata in questa sessione.
2. Parser lessicale bounded, non comprensione semantica universale: non valida l'esistenza geografica dei comuni, non risolve omonimie geografiche, non copre ogni lingua/formulazione, non prova qualifiche. Per nomi ambigui o frasi complesse serve chiarimento; modello non può inventare città. Alias ruolo oltre quelli conservativi non sono una tassonomia completa.
3. Non implementati: import endpoint/ingestion pipeline, DB aziende, geocoding, provider generalista autorizzato per tutti i mestieri, fonte feed continuativa, raccolta/scheduling Subito, radar, candidature, verifica automatica aziende/Careers. `jobRecords` accetta injection applicativa consentita; non è configurato con dati di produzione.
4. Registry dettagli ancora limitato alle origini storiche; `authorizedOrigins` è configurazione server dopo review, non attestazione legale automatica. Tutte disabilitate di default nel dispatcher. Trasporto storico fisso, non browser arbitrario/SSRF discovery.
5. L'estrazione pagina rimane euristica; data/ruolo/comune dichiarati non garantiscono autenticità o disponibilità. Vecchio metodo non-generic mantiene cutoff storico per compatibilità; non usare come percorso generico nuovo.
6. UI è solo staging. Parent deve rivedere diff, integrare/publicare coordinatamente backend+asset e verificare trial reale. Nessun restart/deploy eseguito.
7. Il vecchio JobsService/cache/warm non è il default nativo; resta per compatibilità. Il suo adapter Subito è ora sempre negato. Nessun warming attivato.

## Workflow ripetibile

Prima congelare evidence e hash public, riprodurre un ruolo/comune held-out con unit RED, poi esercitare dispatcher via HTTP e DB temporaneo, leggere receipt/eventi, renderizzare quei receipt in Chromium e infine suite completa/typecheck. Tenere fonte autorizzata e accuratezza semantica come gate indipendenti. Non modificare public servito per testare il renderer. Non registrata skill fuori repository per rispettare il confine ONLY richiesto.
