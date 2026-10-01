# Attachment flow — report

Project `/home/azureuser/nova-community-agent` · 2026-10-01 · suite **241/241**, typecheck ok (`test-full.log`, `typecheck.log`). Local only, not deployed.

## Problema segnalato
Caricando un file (txt/pdf/docx/xlsx…) l'upload partiva subito e finiva nella conversazione senza che l'utente potesse decidere se e cosa inviare.

## Comportamento ora
1. «Allega» → il file resta **in attesa nel composer** come chip (nome, dimensione, «si invia con il messaggio», ✕ per rimuovere). **Nessuna chiamata al server** finché non si invia.
2. L'utente può:
   - scrivere un messaggio e inviare → upload del file, poi il turno con il testo + `[Allegato: nome]`;
   - inviare **solo il file** → upload, poi un turno sintetico «Ho allegato il file *nome*. Chiedimi cosa voglio farne.» L'agente ha la regola di **non indovinare**: descrive il file (nome, leggibile o no) e chiede con `ask_question` cosa fare;
   - rimuovere il chip → nulla viene inviato né salvato.
3. Dal composer della home la conversazione viene creata **solo al momento dell'invio** (ordine verificato: conversazione → upload → turno).
4. Il pulsante «Invia» è attivo anche con il solo allegato. Limite 4 MB, nessun filtro `accept` (qualsiasi formato: l'estrazione decide cosa è leggibile; nulla viene eseguito).

## File
- `public/app.js`: `stageAttachment/clearAttachment/renderAttachment/uploadPending`, `send()` carica il pending prima del turno; onchange solo stage.
- `public/features.js`: rimosso l'handler PDF che estraeva e caricava subito (il PDF ora segue lo stesso flusso: estrazione lato server in `/files/upload`).
- `staging/voice-files/public/native.js`: l'override dell'upload ora fa solo stage (resta allineato al comportamento di app.js).
- `public/index.html`: input senza `accept`, etichette «Allega file»/«Allega». `public/dark.css`: stili chip.
- `src/agent.ts`: regola OPERATING RULES «ATTACHMENTS» (file in `Task context.files`; con messaggio di solo allegato → descrivi e chiedi, mai indovinare; `read_file` solo su richiesta).
- Test: `tests/attachment-flow-ui.test.ts` (3, Chromium: nessun upload prima dell'invio, rimozione senza effetti, testo+file nell'ordine giusto, solo-file con turno sintetico, home → conversazione solo all'invio); `tests/voice-files-ui.test.ts` aggiornato (prima pinnava l'upload immediato).

## Non fatto / limiti
- Un solo allegato per messaggio (il secondo sostituisce il primo).
- Nessuna barra di avanzamento upload (file ≤ 4 MB, upload sincrono prima del turno).
- Il turno sintetico «Ho allegato…» è testo lato client: il server non ha un campo `attachments` strutturato nel turno (il file è comunque in `Task context.files` con stato estrazione).
- Il clipping del selettore lingua nell'header a 390px è preesistente.
- Deploy sul trial non eseguito.
