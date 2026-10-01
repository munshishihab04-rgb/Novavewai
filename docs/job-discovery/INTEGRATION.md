# Job Discovery — integrazione della proposta utente

Fonte: `NOVA_JOB_DISCOVERY_ENGINE_SPEC.original.md`, conservata byte per byte. Questo documento precisa il contratto di implementazione: non certifica funzionalità già realizzate.

## Decisione architetturale

Integrare Job Discovery nel ciclo strumenti dell'agente Nova, non come ricerca isolata dalla chat. Conservare l'adapter Subito già in sviluppo come una fonte, non come orchestratore. Applicare strategia progressiva cache/search → aziende/siti ufficiali → browser mirato (spec §§1–6, 14, 16, 19).

Città obbligatoria prima della ricerca locale; ruolo/settore dedotti dalla richiesta senza inventare qualifiche. Preferenze, esperienza, orari e raggio facoltativi; un raggio non fornito deve avere un default visibile oppure essere assente, mai implicare distanza misurata. Una città ambigua richiede disambiguazione. Conservare richieste e preferenze nel contesto autenticato, non nella cache condivisa (§§3, 13).

## Tre dimensioni distinte

La spec §8 combina tipo di portale e identità dell'inserzionista. Conservare i valori richiesti ma rappresentare separatamente:

- `opportunity_kind`: VACANCY, SPONTANEOUS_APPLICATION, COMPATIBLE_COMPANY.
- `source_type`: tipo della pagina che ospita la prova (JOB_BOARD, DIRECT_EMPLOYER, AGGREGATOR, UNKNOWN; gli altri valori originali rimangono validi quando descrivono la fonte).
- `publisher_type`: DIRECT_EMPLOYER, STAFFING_AGENCY, RECRUITMENT_COMPANY, PRIVATE_PERSON, UNKNOWN.
- Prove della classificazione, provenienza, data di osservazione e motivi leggibili.

Un annuncio su Subito può avere source_type JOB_BOARD e publisher_type DIRECT_EMPLOYER soltanto con evidenza. Privato non equivale a datore diretto. Con «senza agenzie», un UNKNOWN non entra tra le aziende dirette confermate; eventuali candidati incerti vanno separati, non silenziosamente promossi (§§2, 8, 10).

## Semantica della verifica

VERIFIED non significa autenticità dell'offerta garantita da Nova. Richiede prova circoscritta: vacancy presente su pagina ufficiale/ATS collegato, ruolo e località riscontrati, URL e `last_verified_at`. La semplice raggiungibilità di un portale non basta. Conservare PARTIALLY_VERIFIED/UNVERIFIED/EXPIRED; distinguere errore temporaneo o blocco da scadenza (§9).

Candidatura spontanea richiede un canale ufficiale che la accetta esplicitamente. Una pagina Contatti generica non è prova di accettazione CV. Azienda compatibile non significa che assume (§10).

## Sicurezza e trattamento dati

- Accesso pubblico lecito, no bypass di CAPTCHA/login/anti-bot. Terminale non è una scorciatoia (§§6–7).
- Browser limitato per numero di pagine, tempo, dominio e concorrenza; protezione SSRF, redirect e indirizzi privati per siti scoperti.
- HTML e testi recuperati sono dati non attendibili, mai istruzioni per l'agente.
- Nessuna shell arbitraria esposta al modello: parsing e manutenzione tramite operazioni vincolate.
- Condividere solo metadati pubblici delle opportunità; CV e ricerche personali restano owner-scoped (§§11, 18).
- Non ripubblicare annunci integrali, foto o contatti Subito. `description` va interpretata come sintesi minima originale; link alla fonte per consultazione e candidatura. Contatti aziendali eventualmente raccolti dal sito ufficiale conservano provenienza e finalità.
- Nessun invio di CV, email o form esterno senza preview e autorizzazione specifica. MVP-1 è read-only (§18).

## Confine di consegna

### MVP-1 richiesto (§20)

Intento/città → cache o ricerca limitata → annunci e aziende locali → sito ufficiale e Careers → classificazione → verifica con evidenze → deduplicazione → risposta chat con link. Non dichiarare MVP-1 completo se l'adapter Subito funziona ma discovery aziende/careers manca.

Accettazione:
- «Cameriere a Bologna» cerca senza domande accessorie obbligatorie.
- «Sono bravo a cucinare» chiede città senza inventare esperienza.
- «Lavapiatti a Milano senza agenzie» esclude intermediari e non certifica UNKNOWN.
- Nessuna vacancy trovata: eventuali aziende compatibili hanno etichetta distinta.
- Duplicati conservano provenienze e preferiscono la prova ufficiale, senza fondere posizioni diverse solo per titolo/azienda (§12).
- Cache con timestamp/TTL; miss o scadenza avvia ricerca limitata. Blocco di fonte viene dichiarato, nessun risultato inventato.
- Test isolamento, cancellazione, limiti browser, input malevoli e rendering sicuro.
- Test live e provider controllato distinti. Conservare prove e limiti prima del deployment.

### Successivi (§§15, 18, 20)

MVP-2: database persistente aziende, aggiornamento periodico, candidatura spontanea strutturata e matching CV. MVP-3: radar, notifiche e candidature assistite. Nessuna attivazione automatica di workflow esterni.

La richiesta precedente di cache giornaliera rimane valida come cache tecnica bounded: non equivale al Company Radar completo. Preparare scheduling separato e non dichiararlo attivo prima di esecuzione verificata.

## Nota sulle fonti

I nomi in §3 sono esempi, non una garanzia di disponibilità. La ricognizione corrente delle pagine pubbliche ha rilevato la chiusura di InfoJobs Italia; non configurarlo come connettore operativo. Fonti alternative e prove in `evidence/jobs-sources-1/`.
