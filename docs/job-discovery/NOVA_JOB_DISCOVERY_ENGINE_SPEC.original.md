# NOVA — Job Discovery Engine
## Specifica da integrare nell'architettura di Nova

### 1. Obiettivo

Nova non deve essere un semplice aggregatore di annunci di lavoro.

Deve diventare un **Job Discovery Engine agentico** capace di cercare opportunità di lavoro per l'utente combinando:

- portali di lavoro;
- ricerca web;
- ricerca di aziende locali;
- siti ufficiali delle aziende;
- pagine "Lavora con noi / Careers / Posizioni aperte";
- candidature spontanee quando non esiste una vacancy pubblica;
- browser automation tramite Playwright quando necessario;
- terminale per elaborazione, parsing, deduplicazione e automazioni consentite.

Esempio:

Utente:
> "Cerco lavapiatti a Milano, senza agenzie."

Nova non deve limitarsi a cercare la parola "lavapiatti" sui portali.

Deve anche individuare ristoranti, hotel, catering, mense e altre attività compatibili nella zona, trovare i loro siti ufficiali, verificare eventuali pagine Careers/Lavora con noi e restituire opportunità concrete.

---

# 2. Principio fondamentale

Il sistema deve distinguere:

1. **Job Search**
   - esiste un annuncio pubblico per una posizione;

2. **Company Discovery**
   - esiste un'azienda compatibile che potrebbe avere opportunità;

3. **Spontaneous Application**
   - non è stata trovata una vacancy specifica, ma l'azienda dispone di un canale ufficiale per candidature spontanee;

4. **Agency Detection**
   - l'annuncio è pubblicato da un'agenzia/intermediario e deve essere identificato come tale.

Nova deve mostrare chiaramente quale dei quattro casi si applica.

---

# 3. Esempio di flusso

Richiesta:

> "Cerco lavapiatti a Milano, niente agenzie."

Nova deve interpretare:

- ruolo: lavapiatti;
- località: Milano;
- eventuale raggio geografico;
- esclusione: agenzie;
- altri requisiti eventualmente indicati dall'utente.

Poi:

```text
USER
  ↓
NOVA AGENT
  ↓
Intent / Query Understanding
  ↓
┌───────────────────────────────┐
│ JOB SOURCES                   │
│ Indeed / LinkedIn / Subito    │
│ InfoJobs / altri              │
└───────────────┬───────────────┘
                │
                ▼
┌───────────────────────────────┐
│ COMPANY DISCOVERY             │
│ aziende locali compatibili    │
│ ristoranti / hotel / catering │
│ ecc.                          │
└───────────────┬───────────────┘
                │
                ▼
        WEBSITE DISCOVERY
                │
                ▼
       PLAYWRIGHT BROWSER
                │
                ▼
┌───────────────────────────────┐
│ CAREERS / LAVORA CON NOI      │
│ POSIZIONI APERTE              │
│ CANDIDATURA SPONTANEA         │
└───────────────┬───────────────┘
                │
                ▼
        VERIFICATION LAYER
                │
                ▼
       DEDUPLICATION
                │
                ▼
        CLASSIFICATION
                │
                ▼
       MATCHING USER ↔ JOB
                │
                ▼
             NOVA UI
```

---

# 4. Ricerca aziende locali

Quando l'utente cerca un lavoro locale, Nova deve poter cercare anche aziende che potrebbero assumere quella figura.

Esempio:

"lavapiatti Milano"

Categorie da considerare:

- ristoranti;
- pizzerie;
- hotel;
- catering;
- mense;
- strutture ricettive;
- aziende di ristorazione;
- altri business pertinenti.

La ricerca deve produrre una lista di aziende candidate.

Per ogni azienda:

```text
company_id
name
category
city
address (quando disponibile)
website
source
official_website_confidence
careers_url
contact_url
email (se pubblicamente disponibile)
phone (se pubblicamente disponibile)
```

---

# 5. Website Discovery

Una volta individuata un'azienda, Nova deve cercare il sito ufficiale.

Priorità:

1. sito ufficiale;
2. pagina ufficiale "Lavora con noi";
3. pagina "Careers";
4. pagina "Posizioni aperte";
5. pagina "Jobs";
6. pagina "Candidatura spontanea".

Il sistema non deve presumere che l'URL `/lavora-con-noi` esista.

Deve poter esplorare il sito.

Possibili keyword:

- lavora con noi
- careers
- career
- jobs
- posizioni aperte
- opportunità di lavoro
- entra nel team
- unisciti al team
- candidature
- candidatura spontanea
- work with us

---

# 6. Playwright

Playwright deve essere considerato un componente del browser agent, non il motore principale di ricerca.

Utilizzarlo quando serve per:

- siti dinamici;
- contenuti caricati tramite JavaScript;
- navigazione tra pagine;
- apertura di menu;
- ricerca interna al sito;
- lettura di pagine Careers;
- estrazione di informazioni visibili;
- verifica dello stato di una vacancy;
- compilazione di semplici passaggi di candidatura quando l'utente lo richiede e il sito lo consente.

Il browser deve operare rispettando:

- robots.txt quando applicabile;
- termini d'uso;
- rate limits;
- limiti tecnici del sito;
- privacy e dati personali;
- eventuali CAPTCHA o blocchi.

Non tentare di aggirare sistemi anti-bot o controlli di sicurezza.

Se un sito non è accessibile tramite browser automation, Nova deve usare una fonte alternativa o dichiarare che non è stato possibile verificarlo.

---

# 7. Terminal

Il terminale può essere utilizzato dal sistema agentico per attività consentite come:

- parsing;
- normalizzazione;
- trasformazione dati;
- deduplicazione;
- classificazione;
- esecuzione di crawler controllati;
- gestione di job queue;
- elaborazione dei risultati;
- aggiornamento del database;
- script di supporto.

Il terminale non deve diventare un bypass dei limiti imposti dai siti.

---

# 8. Classificazione dell'origine dell'annuncio

Ogni risultato deve avere un campo:

```text
source_type
```

Valori:

```text
DIRECT_EMPLOYER
JOB_BOARD
STAFFING_AGENCY
RECRUITMENT_COMPANY
PRIVATE_PERSON
AGGREGATOR
UNKNOWN
```

Esempio:

```text
Ristorante ABC
source_type = DIRECT_EMPLOYER
```

oppure:

```text
Adecco
source_type = STAFFING_AGENCY
```

Questo è fondamentale perché l'utente può chiedere:

> "Solo aziende, niente agenzie."

In quel caso Nova deve filtrare i risultati classificati come agenzia/intermediario.

---

# 9. Verification Layer

Non considerare automaticamente vero tutto ciò che viene trovato.

Ogni opportunità deve avere:

```text
verification_status
```

Possibili valori:

```text
VERIFIED
PARTIALLY_VERIFIED
UNVERIFIED
EXPIRED
```

Per un annuncio verificato, salvare almeno:

```text
title
company
location
source_url
source_type
discovered_at
published_at (se disponibile)
deadline (se disponibile)
employment_type (se disponibile)
description
requirements
application_method
verification_status
```

La UI deve poter mostrare:

> Verificato sul sito dell'azienda

oppure:

> Trovato su portale di lavoro

oppure:

> Candidatura spontanea — nessuna vacancy specifica trovata

---

# 10. Tre livelli di opportunità

Nova deve poter restituire anche aziende senza un annuncio specifico.

### LIVELLO 1 — Vacancy verificata

```text
Hotel XYZ
Lavapiatti
Milano
Candidatura aperta

[Apri annuncio]
```

### LIVELLO 2 — Candidatura spontanea

```text
Ristorante ABC
Milano

Non è stata trovata una vacancy specifica
per lavapiatti.

Il sito ufficiale accetta candidature spontanee.

[Candidati]
```

### LIVELLO 3 — Azienda compatibile

```text
Ristorante DEF
Milano

Azienda compatibile con il profilo richiesto.
Non è stata trovata una vacancy pubblica.

[Visita azienda]
[Contatti]
```

IMPORTANTE:
non dire che un'azienda "sta assumendo" se non esiste una fonte verificabile che lo dimostri.

---

# 11. Database

Prevedere almeno queste entità.

## Company

```text
id
name
category
address
city
website
official_website
phone
email
source
last_checked_at
careers_url
company_status
```

## Job

```text
id
company_id
title
description
location
employment_type
source_url
source_type
published_at
deadline
discovered_at
last_verified_at
verification_status
status
```

## Source

```text
id
name
url
type
last_checked_at
reliability
```

## Search

```text
id
user_query
normalized_role
location
radius
constraints
created_at
```

---

# 12. Deduplication

Lo stesso annuncio può comparire su:

- LinkedIn;
- Indeed;
- Jooble;
- sito dell'azienda;
- altri aggregatori.

Nova deve evitare duplicati.

Priorità della fonte:

```text
OFFICIAL_COMPANY
    >
DIRECT_JOB_BOARD
    >
AGGREGATOR
```

Se lo stesso lavoro è presente sul sito ufficiale dell'azienda e su un aggregatore, mostrare principalmente la fonte ufficiale.

---

# 13. Matching

Dopo la raccolta, Nova deve fare matching tra:

```text
USER PROFILE
+
USER REQUEST
+
JOB
+
COMPANY
```

Esempio:

Utente:

> "Cerco lavapiatti a Milano, anche senza esperienza, full time."

Nova deve considerare:

- ruolo;
- località;
- distanza;
- esperienza richiesta;
- contratto;
- orario;
- lingua quando esplicitamente richiesta;
- requisiti;
- eventuali preferenze dell'utente.

Non inventare requisiti mancanti.

---

# 14. Search Strategy

Non eseguire sempre la ricerca massima.

Usare livelli progressivi.

### Level 1

Ricerca rapida:

- job boards;
- web search;
- database locale già disponibile.

### Level 2

Se i risultati sono insufficienti:

- discovery di aziende;
- ricerca dei siti ufficiali.

### Level 3

Se necessario:

- Playwright;
- esplorazione Careers;
- verifica approfondita.

Questo evita di usare browser automation costosa per ogni query.

---

# 15. Background Company Radar

Possibile evoluzione importante.

Nova può mantenere periodicamente aggiornato un database delle aziende.

Esempio:

```text
Milano
 ├── Ristoranti
 ├── Hotel
 ├── Catering
 ├── Logistica
 ├── Pulizie
 ├── Supermercati
 └── Altre categorie
```

Un processo periodico può verificare le pagine Careers delle aziende.

Quando compare una nuova posizione:

```text
NEW JOB DETECTED
       ↓
VERIFY
       ↓
CLASSIFY
       ↓
INDEX
       ↓
AVAILABLE TO NOVA
```

Questo riduce drasticamente il lavoro necessario quando l'utente effettua una ricerca.

---

# 16. Importante: non costruire uno scraper fragile

Non implementare:

```text
scrape every website
```

come architettura principale.

Costruire invece:

```text
AGENT
  +
SEARCH
  +
COMPANY DATABASE
  +
BROWSER
  +
VERIFICATION
  +
CLASSIFICATION
  +
MATCHING
```

Il browser deve essere uno strumento che l'agente decide quando utilizzare.

---

# 17. Esperienza utente

L'utente non deve vedere la complessità tecnica.

Deve poter scrivere semplicemente:

> "Cerco lavapiatti a Milano senza agenzie."

Nova risponde, ad esempio:

```text
Ho trovato 8 opportunità verificate
e 14 aziende compatibili.

🟢 5 annunci direttamente da aziende
🟢 3 candidature spontanee
🔵 14 aziende compatibili
🔴 11 risultati esclusi perché pubblicati da agenzie
```

Poi:

```text
Lavapiatti
Hotel XYZ
Milano

Fonte: sito ufficiale
Stato: verificato

[Apri]
```

---

# 18. Integrazione con CV

Questa architettura deve integrarsi con il sistema CV di Nova.

Flusso ideale:

```text
USER
  ↓
"Cerco lavapiatti a Milano"
  ↓
NOVA JOB DISCOVERY
  ↓
trova opportunità
  ↓
USER sceglie azienda
  ↓
NOVA verifica requisiti
  ↓
NOVA recupera CV dell'utente
  ↓
adatta/ prepara candidatura
  ↓
preview
  ↓
utente conferma
  ↓
candidatura / invio / istruzioni
```

Nova non deve inviare candidature automaticamente senza una chiara autorizzazione dell'utente.

---

# 19. Architettura tecnica proposta

```text
                    ┌──────────────────┐
                    │   NOVA AGENT     │
                    └────────┬─────────┘
                             │
                    Intent / Planning
                             │
              ┌──────────────┴──────────────┐
              │                             │
              ▼                             ▼
       Job Search Tool                Company Discovery
              │                             │
              ▼                             ▼
       Search Providers               Web / Directories
              │                             │
              └──────────────┬──────────────┘
                             ▼
                    Research Orchestrator
                             │
                ┌────────────┴────────────┐
                ▼                         ▼
          Search/API                 Playwright
                │                         │
                └────────────┬────────────┘
                             ▼
                     Extraction Layer
                             │
                             ▼
                    Verification Layer
                             │
                             ▼
                     Classification
                             │
                             ▼
                      Deduplication
                             │
                             ▼
                         Matching
                             │
                             ▼
                      Nova Database
                             │
                             ▼
                       Nova Chat/UI
```

---

# 20. MVP

Non costruire tutto contemporaneamente.

Prima versione:

### MVP-1

Supportare:

- ricerca lavoro;
- località;
- esclusione agenzie;
- aziende locali;
- sito ufficiale;
- Careers/Lavora con noi;
- Playwright;
- classificazione direct employer / agency;
- deduplicazione;
- risultati verificati.

### MVP-2

Aggiungere:

- database persistente delle aziende;
- aggiornamento periodico;
- candidature spontanee;
- matching CV ↔ lavoro.

### MVP-3

Aggiungere:

- Company Radar;
- monitoraggio nuove vacancy;
- notifiche;
- candidatura assistita;
- automazione di workflow autorizzati dall'utente.

---

# 21. Obiettivo finale

L'obiettivo non è:

> "Fare un altro Indeed."

L'obiettivo è:

> **Nova deve diventare un agente che cerca opportunità di lavoro nel mondo reale, non soltanto annunci già indicizzati.**

Se un utente dice:

> "Voglio trovare lavoro come lavapiatti a Milano."

Nova deve poter rispondere cercando:

1. annunci esistenti;
2. aziende che cercano quella figura;
3. siti ufficiali;
4. pagine Careers;
5. candidature spontanee;
6. aziende compatibili nella zona.

Questa capacità deve diventare un modulo centrale dell'Agent Architecture di Nova e non una semplice pagina separata di "Job Search".

