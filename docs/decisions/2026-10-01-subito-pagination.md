# Decisione: paginazione Subito nel job finder — PROPOSTA (in attesa del product owner)

Data: 2026-10-01 · Stato: **DECISA — opzione B** (owner, risposta «B», ~06:45 UTC) · Raccomandazione Hermes era A+C · Registrazione: `~/.local/share/nova-community-trial/subito-pagination-decision.json`, flag `NOVA_JOBS_SUBITO_PAGINATION=owner-accepted` · Istruttoria: Hermes
Decisione precedente collegata: `~/.local/share/nova-community-trial/subito-policy-decision.json` (2026-09-30, lettura on-demand di 1 pagina lista, rischio commento-robots/ToS accettato dall'owner).

## Fatti misurati oggi (browser reale, sola lettura)
| Query | Risultati dichiarati da Subito | URL unici su pagina 1 | Oggi Nova ne tiene |
|---|---|---|---|
| cameriere · Bologna | 31 | 30 | **20** |
| barista · Bologna | 39 | 30 | 20 |
| magazziniere · Bologna | 50 | 30 | 20 |
| cameriere · Milano | 153 | 30 | 20 |
| cuoco · Roma | 184 | 33 | 20 |

- robots.txt (letto oggi): commento in testa «It is expressively forbidden to use search robots or other automatic methods… Only if Subito.it has given such permission» + direttive macchina `User-agent: *` → `Allow: /`, **`Disallow: */?o=*` e `Disallow: *&o=*`** (= paginazione vietata esplicitamente). Robots è servito dietro Akamai: `curl` viene bloccato, il browser no.
- L'adapter attuale carica già tutta la pagina 1 ma scarta le card oltre la 20ª (`SUBITO_MAX_CARDS=20`): **10–13 annunci per query vengono buttati via senza alcuna richiesta in più**.
- Cache 6 h per (ruolo, città); ricerca identica ripetuta nello stesso run soppressa; a «altre offerte» oggi Nova fa domande e non agisce (verificato live, `evidence/jobs-banglish/live-trial-more-offers.json`).

## Obiettivi che pesano sulla scelta
Copertura ampia e utile per la comunità (Bologna in primis, poi grandi città) · onestà verso l'utente · modalità on-demand, non raccolta di massa · indipendenza dai provider e comportamento difendibile pubblicamente (Nova «di proprietà della comunità») · rischio legale/blocco sostenibile dall'owner · evitare di farci bloccare da Akamai (perderemmo anche la pagina 1).

## Opzioni
**A — Nessuna paginazione, ma usare tutto ciò che è già lecito** *(consigliata, attuabile oggi)*
1. Cap card 20 → 30+ (si legge la stessa pagina: zero richieste in più, zero rischio aggiuntivo). Per Bologna copre il 77–97 % dei risultati dichiarati.
2. A «altre offerte / aro offer dekhaw / more»: Nova **agisce** invece di chiedere — cerca 2 ruoli affini (cameriere → barista, aiuto cuoco, addetto sala…) e/o comuni vicini, deduplica contro le schede già mostrate, e dice onestamente «Da Subito ho già letto tutta la prima pagina (N annunci); per le pagine successive apri qui ↗» con il link ricerca originale.
3. Nessuna eccezione nuova alle regole robots: restiamo nel perimetro già accettato il 30/09.
- Pro: subito, difendibile, +50 % di annunci per query a Bologna, risolve il difetto «domanda senza azione». Contro: a Milano/Roma restano fuori 120–150 annunci per query.

**B — Paginazione bounded (es. fino a 3 pagine = ~90 card), solo su richiesta esplicita «altre offerte»**
- Pro: copertura reale nelle grandi città. Contro: viola una **direttiva macchina esplicita** (`Disallow */?o=*`), non più solo un commento in prosa: è una categoria di rischio diversa (RFC 9309 non rispettato, posizione indifendibile pubblicamente, maggiore probabilità di blocco Akamai che farebbe perdere anche la pagina 1 a tutti gli utenti). Tecnicamente banale (togliere il fence `?o=` e il limite `navigations>=1`), ma non coerente con «AI onesta di proprietà della comunità».
- **Non la raccomando.** Se l'owner la sceglie comunque: flag separato `NOVA_JOBS_SUBITO_PAGINATION=owner-accepted`, max 3 pagine, solo su richiesta esplicita dell'utente, pausa ≥2 s, decisione JSON datata con revoca.

**C — Permesso/partnership Subito (o fonte ufficiale alternativa)**
- Chiedere a Subito l'autorizzazione scritta all'accesso automatico (il loro stesso robots la prevede) oppure attivare un aggregatore con API ufficiale (Adzuna: registrazione gratuita, copre Italia). Pro: copertura piena e legittima, risolve anche il commento robots. Contro: tempi e un'azione dell'owner (registrazione/contatto). Compatibile con A nel frattempo.

## Raccomandazione
**A oggi + C avviata dall'owner.** B resta documentata come possibile ma sconsigliata: lo scarto di copertura a Bologna (il nostro mercato principale) con A è piccolo, mentre il costo reputazionale e di blocco di B è alto e ricadrebbe su tutti gli utenti.

## Natura della decisione (impegno dell'owner, 2026-10-01)
**Temporanea.** L'owner la motiva così: siamo agli inizi e senza valore percepibile nessuno userà Nova; si impegna a sostituirla con una via legittima (permesso scritto di Subito o aggregatore con API ufficiale, es. Adzuna) man mano che il progetto cresce, e a non prendere altre scorciatoie di questo tipo. Revisione entro **2026-12-01**. Criteri di uscita: fonte ufficiale attiva per le città principali oppure permesso Subito → rimozione del flag, riavvio, decisione marcata «superata».

## Avanzamento (stesso giorno)
Adzuna (API ufficiale, app registrata dall'owner) è **in produzione** accanto a Subito: `evidence/adzuna/REPORT.md`. Alla revisione del 2026-12-01 misurare la copertura Adzuna-only per le città principali e spegnere la paginazione Subito se sufficiente.

## Cosa serve dall'owner
Una riga: «A», «A+C», oppure «B accettata» (in quel caso la registro come decisione datata con il tuo nome e la implemento con i limiti sopra).
