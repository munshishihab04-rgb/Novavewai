# Jobs Claude 1 — indagine indipendente «cameriere a Bologna» e adapter a registro fisso

Data: 2026-09-30 UTC (17:30–17:47). Agente: AGENT2 (Claude). Solo repository `/home/azureuser/nova-community-agent`; nessun deploy, restart, commit, scrittura in `public/`, risorsa cloud, credenziale, invio di form o contatto. Il trial privato (loopback 4187) e il database non sono stati toccati. I report storici sono immutati (12/12 hash `jobs-repair-2/historical-SHA256SUMS` verificati).

## Verdetto in una riga

**Con una ricerca diversificata (4 ricerche gestite, 17 letture pubbliche su 6 origini, sitemap complete di tre bacheche) non esiste oggi alcuna offerta «cameriere» con luogo di lavoro Bologna città che sia contemporaneamente attuale e verificabile sulla pagina originale.** Le tre offerte Bologna trovate sono tutte scadute. Il codice consegnato ora lo dimostra dalla pagina stessa (stato EXPIRED/STALE_DATE con motivo e data) invece di ripetere «non disponibile» o link generici — e accetta un annuncio reale quando esiste (test nativi e controllo live). Non è una conclusione dedotta dal test stretto Adecco/Lavoropiù precedente: quelle due origini sono state affiancate da LavoroTurismo, Restworld, Job in Tourism e dall'ATS ufficiale del datore HNH Hospitality.

## Cosa ho verificato realmente (pagine originali, non snippet)

Prove complete in `live/`. Ogni riga sotto è una pagina letta da questo host.

| # | URL canonico | Ruolo / luogo / azienda dichiarati | Stato osservato | Tipo |
|---|---|---|---|---|
| 1 | https://www.lavoroturismo.it/offerte-lavoro/offerta-cameriere-sala-bologna-smy-hotels | Cameriere/a di sala · «Luogo di lavoro Bologna, Italia» · SMY HOTELS · Full-time, 22.260–23.730 € | **SCADUTA**: corpo pagina «Questa offerta è scaduta / Le candidature … sono chiuse», «Pubblicato il 01/01/1970» (placeholder epoch); sitemap lastmod 2026-08-25 | bacheca (host: Soluzione Lavoro Turismo sas, agenzia autorizzata); inserzionista SMY Hotels = catena hotel, ma non certificata come datore diretto |
| 2 | https://job.hnh.it/jobs/Cameriere-di-sala-full-time-o-part-time-Sala-Italia-Bologna-558045909.htm | Cameriere di sala full/part time, Italia/Bologna, HNH Hospitality (la ricerca gestita indicava pubblicazione 26/03/2026) | **RITIRATA**: HTTP 404 «The vacancy you requested is not longer published on this site» (ATS Altamira) | datore diretto (ATS ufficiale «Lavora con noi») |
| 3 | https://job.hnh.it/default-cards?RunDefaultAction=true&StartupViewID=TableView | indice «Elenco posizioni aperte» HNH, 12 posizioni datate 07–30/09/2026 | nessuna Bologna, nessuna sala Bologna (Verona, Roma, Milano, Venezia, Bergamo, Trento) | datore diretto, indice |
| 4 | https://www.restworld.it/cerco-lavoro/cucina-bologna | «3 offerte attive · ultimo aggiornamento 29 settembre 2026», raggio ~50 km | aiuto cuoco Trebbo, lavapiatti Monte San Pietro, aiuto cuoco Bologna (CRASHIT) — **nessuna sala/cameriere**; non esiste rotta `/cerco-lavoro/sala-bologna` (esplora elenca sala solo per Milano/Roma/Torino) | bacheca con intermediazione |
| 5 | https://www.restworld.it/posizione/offerta-di-lavoro-aiuto-cuoco-bologna-krf | Aiuto cuoco/a per fast food, Bologna | pubblicata 31/07/2026 → adapter: STALE_DATE (>60 gg); ruolo diverso da cameriere | controllo positivo del parser, non un risultato |
| 6 | https://www.jobintourism.it/offerte-sitemap.xml (509 URL) + /search-offerte/?_sft_aree=ristorazione-sala | — | **zero** URL con «bologna»; Emilia-Romagna solo governante/sales/marketing/booking | bacheca |
| 7 | https://www.lavoroturismo.it/sitemap-offers.xml (409 URL, lastmod fino a 2026-09-30) | — | Bologna: solo #1 (scaduta) e «responsabile negozio Bologna – Adecco» (ruolo diverso, agenzia) | bacheca |
| 8 | https://www.restworld.it/sitemap.xml (3.411 URL) | — | 1 sola `/posizione/`, nessuna Bologna sala | bacheca |

robots.txt letti (`recon-1-robots-index.json`, `hnh-robots.txt`): Restworld `Allow: /` salvo `/api/ /_next/ /admin/ /showcase /lp/` e pagine legali; Job in Tourism `Allow: /` salvo wp-admin/uploads; LavoroTurismo `Disallow: /*?*` (le pagine dettaglio senza query string e le sitemap sono consentite — l'adapter rifiuta ogni URL con query); HNH `User-agent: * Allow: *`. Nessun CAPTCHA, login o blocco incontrato su queste origini; Indeed/Bakeca/Subito non sono stati tentati (blocchi già documentati, nessun bypass).

Ricerche gestite (`searchWeb`, identità gestita, 4/4, nessun token stampato): search-1 → #1 + indice Restworld stagionale; search-2 (career ufficiali hotel/ristoranti Bologna) → #2 + indice HNH; search-3 (catene ristorazione: Eataly, Roadhouse, Miscusi, Autogrill…) → solo pagine careers generiche, il modello stesso dichiara di non trovare posizioni Bologna cameriere; search-4 (replay della query di produzione con operatori `site:`) → `search_without_sources`, quindi la query di produzione è stata riformulata in linguaggio naturale (vedi sotto). Miscusi: la pagina `/lavora-con-noi` non elenca Bologna; nessuna apertura Bologna inventata.

## Diagnosi della strategia precedente (perché falliva)

1. **Origini troppo strette**: l'allowlist conteneva solo `www.adecco.com` e `www.lavoropiu.it` (due agenzie), quindi anche una citazione corretta su LavoroTurismo/Restworld/Job in Tourism/ATS datore veniva scartata prima dell'I/O.
2. **Query generica**: `cameriere Bologna offerte lavoro` restituiva quasi solo indici; l'orchestratore non chiedeva pagine singole né indicava le fonti riviste.
3. **Nessuna semantica di data**: una pagina «Pubblicato il 01/01/1970» con corpo ancora leggibile sarebbe passata come VERIFIED se non avesse il banner di scadenza; un annuncio di luglio sarebbe stato «attuale».
4. **Località non osservata**: la verifica era `\bBologna\b` in qualunque punto del testo (footer, menu città); nessuna estrazione di «Luogo di lavoro».
5. **Redirect**: `redirect:'error'` faceva collassare un redirect in un generico UNAVAILABLE, mascherando il motivo.
6. **Publisher**: il footer «Agenzia per il lavoro» dell'host veniva letto come identità dell'inserzionista (su LavoroTurismo avrebbe marcato SMY Hotels come agenzia).
7. **Motivo nascosto**: `unavailable` aveva uno status ma nessun `reason`, quindi l'utente vedeva «non disponibile» ripetuto.

## Cosa è cambiato nel codice (candidato, non deployato)

`src/jobs-live.ts` (riscritto, stessa firma pubblica + nuove export):
- `JOB_SOURCE_REGISTRY`: 6 origini fisse riviste con `sourceType` (JOB_BOARD / DIRECT_EMPLOYER), regex del **path di dettaglio** osservato dalle sitemap reali, nota robots, `reviewedAt`. Il modello non sceglie URL: ogni lead passa da `resolveSource` (solo https, niente credenziali/porta/query/frammento, origin esatto, path di dettaglio). Le origini Adecco/Lavoropiù sono conservate per compatibilità.
- Trasporto: `redirect:'manual'` (3xx → `REDIRECTED`, mai seguito), timeout 10 s/pagina, max 6 lead, corpo ≤ 2,5 MB (LavoroTurismo SSR pesa 1,57 MB: il limite di 1 MB precedente rendeva la pagina «UNAVAILABLE» — osservato in `adapter-live-replay.json`, corretto in `-2.json`).
- Classificazione con motivo: `EXPIRED` (banner o 404 «no longer published»), `STALE_DATE` (data 1970 o >60 giorni, oppure futura), `MISMATCH` con `observedLocation` (ruolo assente, o «Luogo di lavoro/Sede» diverso dalla città richiesta: Monte San Pietro ≠ Bologna), `REDIRECTED`, `UNAVAILABLE` con messaggio.
- Opportunità solo se: ruolo nel corpo, città richiesta = località osservata, data assente o plausibile → `VERIFIED` con `publishedAt`, `PARTIALLY_VERIFIED` senza data; `company`, `sourceName`, evidenza con citazione del testo.
- Publisher: pagine ATS di datori nel registro → `DIRECT_EMPLOYER`; su bacheche si guarda solo la testa dell'annuncio (non il footer dell'host) → `STAFFING_AGENCY` o `UNKNOWN`. Con «senza agenzie» sopravvive solo il datore confermato e `excludedNonDirect` è contato.
- `discoveryQuery(occupation, city)`: ruolo + città + fonti riviste, nessun testo utente/CV.

`src/agent.ts` (solo il ramo `jobs_search` fallback): usa `discoveryQuery`; il receipt persiste `unavailablePages` (con motivi), `excludedNonDirect`, `verifiedScope.allowedOrigins`, `sourceUnavailable`, un `notice` di provenienza; `constraintStatus` diventa `met` solo se tutte le opportunità sono datori diretti. `src/jobs.ts`: solo il tipo `constraintStatus` include `'met'`.

Non toccati: adapter Subito, cache, scheduler, UI in `public/`, `jobs-discovery.ts`. Nessun dataset seminato.

## Test (TDD) e verifica

- RED: `tests/red-registry.txt` (export mancanti) → GREEN. Poi il vecchio test `jobs-live.test.ts` è fallito per il path Adecco fittizio `/id` non conforme al path reale; adattato all'URL osservato (diff in `tests/jobs-live.test.adaptation.diff`, originale in `before/`).
- Nuovi: `tests/jobs-live-registry.test.ts` (5 test: registro/SSRF-shape, scaduta/redirect/epoch/fuori città, vacancy vera con classificazione publisher + strict, limiti/1 richiesta per lead/errore fetch, query di discovery) e `tests/jobs-agent-live-registry.test.ts` (dispatch nativo con PostgreSQL temporaneo: 1 sola query, un lead loopback non-registro **mai richiesto**, pagina reale SMY finisce in `unavailablePages` con stato EXPIRED/UNAVAILABLE e mai in `opportunities`, receipt con provenienza).
- Adattato `tests/jobs-agent-search-links.test.ts`: asserzione sulla query da uguaglianza esatta a match (ruolo/città/fonte).
- `tests/jobs-*.test.ts`: **34 passati, 0 falliti** (`tests/targeted-tests-final.txt`); `npm run typecheck` ok. Non è l'intera suite del repository.
- Falsi negativi cercati nei test precedenti: nessun fixture vuoto trovato; il test agente precedente asseriva però la query letterale (rigidità, non falso negativo). Il test nativo nuovo dipende dalla rete per la pagina SMY e accetta EXPIRED/UNAVAILABLE/STALE_DATE per non diventare fragile; non accetta mai VERIFIED per quella pagina.
- Live con codice di produzione: `live/adapter-live-replay-2.json` (4 lead reali → 0 opportunità, 2 EXPIRED, 2 MISMATCH con motivi), `live/adapter-live-control-cuoco.json` (controllo positivo: parser legge titolo/data reali → STALE_DATE 2026-07-31).

## Limiti e onestà

- Il risultato per l'utente resta: nessuna offerta cameriere Bologna attuale da mostrare oggi. L'agente ora può dirlo con prova (link + «scaduta il…/pubblicata il…») e mostrare i link di navigazione come suggerimenti, non come vacancy.
- La ricerca gestita è non deterministica: search-4 con `site:` ha dato zero fonti; la query naturale è quella dei test, ma non è stata rieseguita live (budget 4/4 esaurito). Il parent deve validare una ricerca reale con la query finale.
- Letture pubbliche: 17 richieste (15 URL distinti + 2 riletture) più 6 letture dell'adapter nei replay; oltre le 15 indicative, dichiarato qui.
- `MAX_AGE_DAYS=60` è una soglia di plausibilità, non una regola delle fonti. Registro rivisto a mano il 2026-09-30: non è una licenza di riuso né un via per crawling programmato.
- Restano aperti dalla review indipendente: S1/S2 (browser Playwright, non usato qui), I1 parziale, I3, P1–P4, trasporto con DNS pinning per domini scoperti (il registro fisso lo rende non necessario oggi), renderer `public/app.js` che legge solo `result.jobs` (le `opportunities` non hanno card: serve intervento del parent sull'UI).

## Cosa serve dal parent per il rilascio

1. Rivedere il registro (6 origini) e la soglia 60 giorni; decidere se tenere Adecco/Lavoropiù.
2. Eseguire una ricerca live con `discoveryQuery('cameriere','Bologna')` e conservare l'esito.
3. Aggiornare il renderer per `opportunities` (titolo, azienda, `publishedAt`, `sourceName`, link originale) e per `unavailablePages` con motivo, poi restart del trial.
4. Ripetere questa replay in un giorno con offerte Bologna presenti prima di descrivere la funzione come «offerte a Bologna funzionanti».

File: `REPORT.md`, `progress.json`, `source-hashes.json`, `SHA256SUMS`, `before/`, `tests/`, `live/` (HTML grezzi, sitemap, JSON ricerche senza token).
