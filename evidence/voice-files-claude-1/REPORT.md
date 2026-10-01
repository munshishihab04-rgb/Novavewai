# Revisione indipendente voice/file — agente 2 (evidence/voice-files-claude-1)

Data: 2026-09-26. Perimetro: solo lettura sorgenti + test locali con DB embedded temporaneo (tests/helpers.ts). Nessuna modifica a src/, public/, package, nessuna chiamata di rete, nessun commit, nessun deploy.

## 0. Scope congelato (hash SHA256 dei file esaminati)

Vedi `hashes-before-tests.txt` (prima dei test) e `hashes-final.txt` (a fine revisione). Nessun drift durante l'esecuzione dei test (`NO_DRIFT`, `NO_DRIFT_FINAL` per i 10 file core).

- src/voice.ts 42c12fdd… · src/voice-provider.ts 33b3c469… · src/voice-policy.ts a48a2767…
- src/capabilities.ts e8bb2f89… · src/generated-files.ts fce28851… · src/files.ts a6af11f5…
- src/agent-tools.ts ad038ce3… · src/file-inspection.ts 691dd1de… · src/app.ts 5ff9079b… · src/agent.ts 27eb9606…
- public/app.js 51d09b73… · public/features.js f68faf6c… · scripts/server.ts, scripts/config.ts, migrations/014,015 (hash completi nel file).

Nota: `evidence/voice-files-independent-1/latest.json` mostrava un hash diverso per src/files.ts (60663f13…) e src/agent.ts (2874b9a4…): l'implementatore ha modificato quei file dopo la revisione precedente; questa revisione copre le versioni attuali sopra indicate.

## 1. Revisione statica (verificata leggendo il codice, con riferimenti a riga)

Percorso canonico voce → agente
- src/voice.ts:24-26 — solo `input_audio_buffer.committed` del provider abilita `item_id`; transcript non committati, `response.output_audio_transcript.done` e POST browser non creano input. Confermato dal test 4 dell'harness (transcript "nocommit" → 0 voice_inputs, 0 messages).
- src/voice.ts:31 — `INSERT INTO voice_inputs … ON CONFLICT DO NOTHING` + `s.seen` + UNIQUE(voice_session_id,provider_item_id) in migrations/014_voice.sql:15 → replay dello stesso item_id produce un solo run/messaggio (test 4 e voice-native.test.ts).
- src/agent.ts:244-249 — il submit vocale costruisce una request server-side e chiama la stessa `turn()` + `dispatch()` del percorso testo (`/conversations/:id/turns`, riga 250). Stessi tool (`validateTools`, agent-tools.ts), stesso fence, stesse ricevute. src/agent.ts:210-212 rilega l'input al voice_session attivo, stesso session_hash, stessa conversazione e testo identico (409 voice_input_invalid altrimenti). Messaggio persistito con channel='voice', provenance='provider_transcribed_audio' (agent.ts:228).
- Nota: l'header `idempotency-key: 'voice-'+inputId` (agent.ts:247) non viene consumato da `turn()` (nessuna `idempotentResult` in agent.ts); l'idempotenza vocale dipende esclusivamente da voice_inputs UNIQUE + run_id (agent.ts:212 `voiceInput.run_id` → 409). È sufficiente ma è bene saperlo.

Ricevute tool non anticipano il commit
- src/agent.ts:174-192 — `createGeneratedFile` (artifact + revision), INSERT ricevuta, evento `tool.succeeded` e checkpoint sono nella stessa transazione; il risultato con `download` è visibile solo dopo commit. `executed:false`, `origin:'assistant_generated'` (generated-files.ts:36).
- src/voice.ts:38-41 — la lettura vocale (`response.create`, `conversation:'none'`) avviene solo dopo che il run è `completed|waiting_user` e legge il testo assistant già persistito con filtro owner. Rollback = nessuna lettura.

File generati (PDF/TXT/ZIP/JS/PHP/Liquid)
- generated-files.ts:8,11-18 — nome `^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$`, niente `/`, `\`, `..`, NUL, CR/LF, `"`; estensioni whitelist; ZIP: entry uniche case-insensitive, ≤20 entry, ≤20000 byte totali, no `text`; formati pdf/zip devono avere estensione coerente.
- generated-files.ts:39-44 — download `WHERE owner_id=$1 AND artifact_id AND revision` (404 per altro owner), `validateGeneratedFile` ri-eseguita alla lettura, `application/octet-stream`, `attachment; filename="…"` (nome già sanificato: nessuna header injection), `nosniff`, CSP `sandbox; default-src 'none'`, `no-store`; owner rivalidato dopo il render (riga 43). HTML generato viene servito come octet-stream attachment (nessun rendering inline).
- ZIP costruito in memoria, metodo stored, nessuna estrazione su filesystem (generated-files.ts:20-31). CRC verificato con Python zipfile nell'harness.

Upload
- files.ts:29-42 — `/files/upload`: nome `fileName`, mime pattern, ≤4 MiB, base64 canonico, `..` rifiutato (riga 36), `inspectUpload` (file-inspection.ts) restituisce `extracted` solo per testo UTF-8 ≤16 KiB o PDF con text-layer; altrimenti `status:'unsupported'` con `reason` esplicito (ZIP: "ZIP stored only. No archive extraction…"), sempre `executed:false`.
- files.ts:69-79 — content download owner-scoped, hash/size verificati dallo store (409 file_integrity_failure), `attachment`, `nosniff`, `no-store`.
- agent.ts:179 — `read_file` su file non estratto restituisce `extraction:'unsupported'` + reason "Do not claim to have read it".

Nessuna shell host
- agent-tools.ts:7-15,25 — solo i tool elencati; qualunque altro nome → `tool_denied` (test 2 dell'harness: execute/run_shell/bash/exec_file/python/eval rifiutati). Nessun `child_process` nei sorgenti voice/file (`inspectUpload` non decomprime né esegue).

Close/cancel/reload
- voice.ts:7-18 — `close()` revoca la sessione, chiude il transport e cancella i run `queued|running` legati (`voice_stopped`); `onReady` marca `failed/runtime_interrupted` le sessioni `active|connecting` residue (riavvio processo); `onLoss` chiude tutte le sessioni live; timer 180 s.
- voice.ts:28,39 — ogni input e ogni poll rivalidano `status='active' AND expires_at>clock_timestamp()` e il token; scaduto lato DB → chiusura `voice_input_failed`/`voice_session_unavailable` e nessuna persistenza (test 4).
- voice.ts:45 — un solo voice session attivo per owner (409 voice_active, indice `one_active_voice`), capacità globale 4.

## 2. Difetti / lacune concrete (non risolti)

D1 — BLOCCANTE per l'accettazione utente: il frontend reale non usa il percorso nativo.
- public/features.js:25 chiama `api('/voice/connect', …)` (route legacy in src/capabilities.ts:10-15 con `create_response:true, interrupt_response:true` e istruzioni "You are in a separate voice conversation… cannot save drafts", voice-policy.ts:11). In quel percorso il modello realtime risponde da solo: i turni vocali NON sono persistiti nella chat, NON passano per agente/tool canonici. La UI dichiara "Sessione separata · non salva o modifica i documenti" (features.js:15).
- Nessuna occorrenza di `/voice/sessions`, `/files/upload` o `/revisions/:n/download` in public/*.js (grep = 0). L'upload UI accetta solo .txt (app.js:39) e PDF via `/documents/extract` → salvato come `pdf_estratto.txt` (features.js:33): nessun riconoscimento formato/stato unsupported lato UI.
- tests/voice-files-ui.test.ts (aggiornato 12:08) carica `staging/voice-files/public/native.js`, che NON esiste nel repo (`ls: cannot access`). Quel test non può quindi validare nulla del frontend nativo al momento.

D2 — BLOCCANTE per l'esercizio reale: il provider vocale nativo non è cablato nel server.
- scripts/server.ts:5 costruisce `buildApp(pool,{fileRoot, agent})` senza `voice:`; scripts/config.ts non contiene alcun riferimento a voce; `AzureSpeechProvider` è referenziato solo da scripts/voice-native-audio-probe.ts. Con il server attuale `POST /voice/sessions` risponde 503 `voice_unavailable` (voice.ts:44). `capabilityRoutes` (legacy /voice/connect) è montato solo in scripts/trial.ts:24, non in server.ts.

D3 — Coesistenza del percorso legacy. Finché src/capabilities.ts espone `/voice/connect` (risposta autonoma del modello, nessuna persistenza), esiste un canale vocale che viola "same canonical agent/tool path as text". Va rimosso o disabilitato quando il nativo entra in produzione.

D4 — Minore: src/voice.ts:38 `speak()` effettua al massimo 600×100 ms = 60 s di polling; run più lunghi (timeout run è configurabile) terminano senza lettura vocale e senza segnale al client. Non è un difetto di sicurezza.

D5 — Minore: src/voice.ts:33 riusa `latest.task_id` come task del nuovo turno vocale se il task è `active|paused|created`, senza collegamento esplicito alla conversazione (il filtro conversazione è implicito nella query di `latest`). Comportamento corretto ma il turno vocale in una conversazione con task già `completed` crea sempre un task nuovo: coerente col percorso testo senza `taskId`.

## 3. Test eseguiti (tutti con DB embedded temporaneo, provider sintetico, nessuna rete)

Harness indipendente (nuovo, in questa cartella):
  cd /home/azureuser/nova-community-agent && node_modules/.bin/tsx --test --test-concurrency=1 --test-reporter=tap evidence/voice-files-claude-1/harness.test.ts
  Output: evidence/voice-files-claude-1/harness.tap — 5/5 ok (exit 0).
  1. PDF/TXT/ZIP/HTML generati via agente reale (create_file): `%PDF-`, byte TXT identici (CRLF/Unicode), ZIP letto e CRC verificato da Python `zipfile` con contenuti esatti di app.js/index.php/theme.liquid/readme.txt, HTML servito come octet-stream attachment; header disposition/nosniff/no-store/CSP sandbox; 404 per altro owner, 401 anonimo; ricevute = revisioni = 4; revision non-file → 404.
  2. validateTools/create_file: 15 payload malformati rifiutati (traversal, assoluto, backslash, .exe, formato/estensione incoerenti, entry `..`, path con `/`, duplicati case-insensitive, ZIP vuoto, entries su text, CR/LF e `"` nel nome); tool shell-like negati.
  3. Upload flessibile: .js → extracted; ZIP con nome-membro traversal → stored, `unsupported`, byte restituiti identici, disposition sicura; binario e fake .txt → unsupported; owner isolation (404 metadata/content/upload su conversazione altrui); `a..b.js` → 400; replay idempotency-key → stesso id, una riga.
  4. Voce: 404 conversazione altrui, 409 seconda sessione, 404 stop altrui; transcript non committato ignorato; replay stesso item_id → 1 voice_input, 1 run, messaggi [user voice, assistant voice] nella stessa conversazione; download ricevuta owner-scoped; `response.create` con `conversation:'none'` e testo assistant persistito; scadenza lato DB → input tardivo non persistito, transport chiuso, stato `failed`; riavvio app → sessioni `active` residue marcate `failed/runtime_interrupted`.
  5. Evento `error` del transport → sessione `failed/voice_transport_error`, transport chiuso; sdp/language non validi → 400.

Test esistenti mirati (nessun `npm test` completo):
  cd /home/azureuser/nova-community-agent && node_modules/.bin/tsx --test --test-concurrency=1 --test-reporter=tap tests/voice-native.test.ts tests/generated-files.test.ts tests/flexible-uploads.test.ts tests/file-formats.test.ts tests/idempotency-files.test.ts
  Output: evidence/voice-files-claude-1/existing-targeted.tap — 15/15 ok (exit 0).

Non eseguiti: tests/voice-files-ui.test.ts (dipende da staging/voice-files/public/native.js assente; richiede Playwright/Chromium), tests/voice-language.test.ts (percorso legacy), suite completa.

## 4. Controlli pendenti (non certificabili qui)

- Parlato reale: provider Azure realtime, ordinamento eventi `committed`/`transcription.completed` reali, VAD, riproduzione audio, interruzione (`response.cancel`, voice.ts:21). Nessuna chiamata esterna eseguita.
- Frontend nativo (`/voice/sessions`, download autenticato dei file generati, upload multi-formato con stato unsupported visibile): il codice non esiste in public/ e il file staging referenziato dal test UI è assente.
- Cablaggio `voice:` in scripts/server.ts/config.ts e rimozione/disabilitazione di `/voice/connect`.
- Riavvio con sessioni realmente live (verificato solo il marcatore DB `runtime_interrupted`, non la ripresa del browser).

## 5. Verdetto

Backend voce/file (src/voice.ts, generated-files.ts, files.ts, file-inspection.ts, agent-tools.ts, wiring in agent.ts) — PASS nel perimetro testato: persistenza vocale nella stessa conversazione via percorso canonico, ricevute post-commit, download owner-scoped di byte reali (PDF/TXT/ZIP/JS/PHP/Liquid/HTML), upload con stato unsupported trasparente, nessuna shell esposta, replay/idempotenza, close/expiry/restart.

Accettazione utente end-to-end — NON SUPERATA: il frontend distribuito usa ancora `/voice/connect` (sessione separata, non persistente), non espone upload flessibile né download dei file generati, e il server di produzione non istanzia il provider vocale nativo (D1, D2, D3).

File prodotti (percorsi assoluti):
- /home/azureuser/nova-community-agent/evidence/voice-files-claude-1/REPORT.md
- /home/azureuser/nova-community-agent/evidence/voice-files-claude-1/verdict.json
- /home/azureuser/nova-community-agent/evidence/voice-files-claude-1/harness.test.ts
- /home/azureuser/nova-community-agent/evidence/voice-files-claude-1/harness.tap
- /home/azureuser/nova-community-agent/evidence/voice-files-claude-1/existing-targeted.tap
- /home/azureuser/nova-community-agent/evidence/voice-files-claude-1/hashes-before-tests.txt
- /home/azureuser/nova-community-agent/evidence/voice-files-claude-1/hashes-final.txt
