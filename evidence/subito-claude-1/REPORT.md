# Subito.it — ricerca reale «cameriere Bologna» (AGENTE 2 Claude)

Data osservazione: 2026-09-30 ~17:51–17:53 UTC. Playwright 1.63 del progetto, Chromium headless, JS abilitato, nessun account, nessun proxy/stealth, nessun click su Contatta/Mostra numero, nessuna candidatura. Cookie: nessun banner interattivo intercettato dai selettori di rifiuto (cookie_action=null), nessun consenso accettato. Richieste: 1 robots + 1 lista + 5 dettagli, sequenziali con pause 2–3 s. Nessuna modifica a sorgenti, servizi, public, DB o deploy.

## Esito

Il sito è accessibile con navigazione ordinaria: robots.txt HTTP 200 [1], pagina lista HTTP 200 con titolo «Subito.it Cameriere - Offerte di lavoro a Bologna e provincia» [2], 5 pagine annuncio HTTP 200 [3][4][5][6][7]. Nessun CAPTCHA, login o blocco incontrato (`document-log.json`).

Lista: 33 anchor verso annunci, 30 URL unici dopo deduplica in codice (`consolidate.cjs`, dedup_ok=true) [2]. 25 con «camerier*» nel titolo; per comune dichiarato nella card: 17 Bologna città, 8 provincia BO (Castel San Pietro Terme, Granarolo dell'Emilia, Castel Maggiore, Valsamoggia, San Giorgio di Piano) [2]. La lista copre città e provincia; il comune è quello dichiarato dall'inserzionista, non verificato.

Dettagli letti (primi 5 pertinenti in ordine lista, tutti comune dichiarato Bologna (BO), nessun avviso «non disponibile», CTA Contatta presente e non cliccata):

| # | Titolo | Data inserimento (testo pagina) | URL |
|---|--------|------------------|-----|
| 1 | Cameriere | Oggi alle 12:14 | [3] |
| 2 | Cameriere con esperienza | Oggi alle 11:24 | [4] |
| 3 | Cameriere banconista, Chef e cuoco | Ieri alle 21:11 | [5] |
| 4 | Cameriere/a di sala | Ieri alle 17:49 | [6] |
| 5 | Cameriere | 27 set alle 18:58 | [7] |

Stato: PARTIALLY_VERIFIED per tutti e 5 — pagina pubblica raggiungibile, ruolo camerier* in H1, località Bologna (BO), data di inserimento presente, nessuna indicazione di scadenza/rimozione.[3][4][5][6][7] Nome azienda: non pubblicato in campo strutturato in nessuno dei 5; publisher_type = UNKNOWN. Nel dettaglio 1 il blocco inserzionista ha classe `private-user-info` (account privato) [3]; ciò non dice nulla sul rapporto di lavoro, e «Azienda verificata» — ove presente — non proverebbe datore diretto. Nessun JSON-LD JobPosting su lista o dettaglio [2][3]. Le date di inserimento sono relative («Oggi», «Ieri»): la data assoluta va derivata dal timestamp di osservazione.

Le "prove testuali" negli evidence_snippet di `details.json` catturano per lo più i link «Ricerche simili» del footer, non la descrizione: usati solo per attestare role_hit; la descrizione non è stata conservata di proposito.

## Robots e condizioni

Direttive `User-agent: *`: `Allow: /`; Disallow su percorsi account/pagamento/profilo e sulla paginazione (`*/?o=*`, `*&o=*`) [1]. Verifica per-URL in codice: nessuna direttiva Disallow corrisponde ai 6 URL letti (`robots-check.cjs`) [1]. Il campo `matching_disallows` in `robots-eval.json` era un falso positivo dell'euristica iniziale, corretto in `results.json`.

Vincolo di policy: il commento in testa a robots.txt dichiara «It is expressively forbidden to use search robots or other automatic methods to access Subito.it. Only if Subito.it has given such permission can be accepted.» [1] Non è una direttiva macchina ma è un'istruzione di esclusione pertinente per qualsiasi accesso automatico ricorrente. Questa sessione è stata una lettura bounded a bassa frequenza per verifica; un adapter in produzione richiede una decisione esplicita di policy/termini da parte del parent (o permesso di Subito) prima dell'attivazione. Il 403 storico su curl del robots non si è ripresentato con browser ordinario: il precedente blocco riguardava la configurazione del nostro client, non la disponibilità del sito.

## Percorso DOM osservato (`dom-inspection.json`)

Lista [2]: `div[data-testid="listing-container"] > div.ItemListContainer-* > article.AdItem-*__adItemCard > a.index-module_link*[href$=".htm"]`; nella card: `h3.index-module_subject*` (titolo), `span.index-module_location*` (es. «Bologna (BO)»), span senza classe per settore/livello/orario. `#__NEXT_DATA__` presente sulla lista. Nessun `<time>`.
Dettaglio [3]: contenitore `.index-module__*__ad-info` con `h1.index-module__*__title`, `p.index-module__*__locationText`, `span.index-module_insertion-date*` («Oggi alle 12:14»), `span.*ad-info__id` («ID: 658333217»); caratteristiche in `[data-testid="ad-feature-list"]` (Tipo di contratto, Orario di Lavoro, Settore, Livello); blocco inserzionista `.index-module__*__private-user-info` / `.*seller-info-content`. Le classi sono CSS-module hashate: fragili, da usare con selettori a prefisso/attributo e fallback su `data-testid`, `h1`, pattern URL `/offerte-lavoro/<slug>-<id>.htm`.

## Proposta adapter (non attivato, per review)

1. Playwright con JS abilitato (SSR + hydration; l'adapter attuale in `src/jobs-subito.ts` ha JS disabilitato, UA custom, budget 3 richieste contando anche asset e route-abort: da correggere, non è prova di indisponibilità del sito). Locale it-IT, cookie solo di sessione, nessun accept del banner.
2. Lista: `annunci-<regione>/vendita/offerte-lavoro/<comune>/?q=<ruolo>`, sola prima pagina (paginazione `?o=` è Disallow). Estrarre da `article[class*="adItemCard"]`: href `.htm`, `h3` titolo, `span[class*="location"]` comune; dedup su URL; filtro comune==città vs provincia esplicito.
3. Dettaglio (max N, sequenziale, ≥2 s): `h1`, `[class*="locationText"]`, `[class*="insertion-date"]`, `[class*="ad-info__id"]`, `[data-testid="ad-feature-list"]`; rilevare avviso non disponibile/annuncio rimosso separato da scaduto; etichetta inserzionista solo come `publisher_hint` con publisher_type UNKNOWN salvo evidenza; nessuna descrizione integrale, foto, contatti.
4. Gate: verifica robots per-URL (matcher wildcard corretto), budget pagine/tempo, stato BLOCKED distinto da EXPIRED, timestamp osservazione, e flag di policy `subito_automated_access_permission` che deve essere esplicitamente configurato dopo la review del commento robots/termini.

## Limiti

Campione: 1 pagina lista e 5 dettagli — non è una misura del mercato. Datore di lavoro/azienda non verificati; località dichiarata non verificata; nessuna prova di autenticità delle offerte. Le date sono relative al 2026-09-30. Il consenso cookie non è stato gestito attivamente perché nessun selettore di rifiuto ha intercettato un banner visibile; da confermare nell'adapter.

## Sources

[1] https://www.subito.it/robots.txt — Subito robots.txt
[2] https://www.subito.it/annunci-emilia-romagna/vendita/offerte-lavoro/bologna/?q=cameriere — Subito.it Cameriere - Offerte di lavoro a Bologna e provincia
[3] https://www.subito.it/offerte-lavoro/cameriere-bologna-658333217.htm — Cameriere
[4] https://www.subito.it/offerte-lavoro/cameriere-con-esperienza-bologna-590242340.htm — Cameriere con esperienza
[5] https://www.subito.it/offerte-lavoro/cameriere-banconista-chef-e-cuoco-bologna-649074452.htm — Cameriere banconista, Chef e cuoco
[6] https://www.subito.it/offerte-lavoro/cameriere-a-di-sala-bologna-662640160.htm — Cameriere/a di sala
[7] https://www.subito.it/offerte-lavoro/cameriere-bologna-659128027.htm — Cameriere
