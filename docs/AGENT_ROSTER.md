# Squadra NOVA — nomi e responsabilità

Convenzioni richieste dall'utente per rendere leggibile il coordinamento. I nomi identificano ruoli durevoli, non processi sempre attivi. Verificare lo stato live prima di comunicarlo.

## VOCE — esperienza vocale e file
- Responsabilità: stessa conversazione e strumenti tra voce/testo, persistenza, sessioni vocali, allegati, upload e download.
- Scrittura: solo file assegnati per la lavorazione corrente; niente modifiche a Jobs o servizi Foundry senza coordinamento.
- Consegna: percorso reale voce → operazione → salvataggio → allegato → download, test ed espliciti limiti.

## FARO — servizi Foundry
- Responsabilità: accesso e prove dei servizi Azure utili (OCR/layout, traduzione, Language), adattatori e contratti degli strumenti.
- Scrittura: adattatori/test/docs assegnati. Nessuna modifica concorrente ai file condivisi dell'agente.
- Nessun provisioning o modifica RBAC implicita; distinguere catalogo, accesso API, esecuzione e integrazione.

## BUSSOLA — Job Discovery
- Responsabilità: intento ruolo/città, annunci, aziende locali, siti ufficiali/Careers, cache, classificazione, verifica e deduplicazione.
- Fonte: docs/job-discovery/NOVA_JOB_DISCOVERY_ENGINE_SPEC.original.md e INTEGRATION.md.
- Consegna: opportunità con provenienza e stato, senza equiparare azienda compatibile ad assunzione.

## SCUDO — verifica indipendente
- Responsabilità: sicurezza, isolamento utenti, regressioni, casi limite e accettazione end-to-end.
- Non modifica l'implementazione che sta giudicando. Scrive harness e rapporti nelle cartelle evidence assegnate.
- Un autore passato da revisore a correttore non può certificare indipendentemente la propria correzione: usare un nuovo contesto di revisione.
- Report limitati al perimetro realmente verificato; nessun pass finale con problemi bloccanti irrisolti.

## Coordinatore — Hermes nella chat principale
- Mantiene specifiche, priorità, assegnazioni e proprietà dei file.
- Risolve dipendenze e conflitti; verifica risultati e integrazione.
- Coordina un solo deployment dopo i gate pertinenti; non confonde test locali e versione pubblica.
- Modello/provider e stato sono proprietà dell'esecuzione, non del nome del ruolo. Non dichiarare quattro processi attivi se solo alcuni sono in esecuzione.
