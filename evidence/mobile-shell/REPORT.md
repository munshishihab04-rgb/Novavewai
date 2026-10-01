# Mobile shell + chat temporanea — report

Project `/home/azureuser/nova-community-agent` · 2026-10-01 · suite **245/245**, typecheck ok. Locale, non deployato.

## Cosa cambia per l'utente (telefono ≤700px)
- **Header pulito**: ☰ (apre il menu) · logo NOVA al centro · ⏱ «Chat temporanea» a destra. Spariti dal header mobile: breadcrumb, «Conversazioni», ⚙, «PROVA PRIVATA», «IT / বাংলা / EN», «Web» (tutti spostati nel menu). Nessun overflow orizzontale (test).
- **Menu laterale (drawer)**: Nuova conversazione · Chat temporanea · Conversazioni · I miei risultati · **Le tue conversazioni** (elenco) · **Impostazioni** (Provider e modelli con modello attivo, Lingua, Chat vocale, Ricerca sul web) · **Account** (avatar + nome utente o «accesso con invito», Esporta i miei dati, Esci). Tutto visibile senza scroll a 390×844.
- **Chat temporanea** (nuova, anche su desktop): si apre dal header o dal menu; la conversazione viene creata al primo invio con `ephemeral:true`; banner esplicativo; **non compare** fra le conversazioni; il pulsante 🗑 «Chiudi» la elimina (conferma) con tutto il contenuto (messaggi, task, bozze, file: i blob passano dal ledger `file_cleanup`); scadenza automatica **24 h** (sweep orario nel processo trial).
- Desktop invariato: sidebar + breadcrumb restano; il pulsante ☰ è nascosto.

## Backend
- Migrazione `018_ephemeral_conversations.sql`: colonna `conversations.ephemeral` (default false), flag immutabile dopo la creazione; i trigger di immutabilità (revisioni, messaggi, fonti, eventi, receipt, file) ammettono la cancellazione **solo** dentro una transazione che ha impostato `SET LOCAL nova.ephemeral_cascade='on'` (muore con la transazione). La storia ordinaria resta immutabile (asserito nel test).
- `POST /conversations` accetta `ephemeral`; `DELETE /conversations/:id` (owner-bound) elimina solo conversazioni temporanee (409 `conversation_not_ephemeral` per le normali, 409 `run_active` se Nova sta lavorando, 404 altro owner); pulizia blob sincrona best-effort, altrimenti resta nel ledger.
- `GET /workspace` esclude le temporanee; `GET /me` (username/kind) per la card account.
- `sweepEphemeral(pool)` in `src/context.ts`, schedulato in `scripts/trial.ts` ogni ora.

## Test
- `tests/ephemeral.test.ts`: creazione, uso normale (task, messaggi, artifact, upload), nascosta dalla lista, DELETE altro owner 404, DELETE owner cascata completa + cleanup blob, 404 dopo, normale → 409, immutabilità storia ordinaria, sweep elimina solo le scadute.
- `tests/mobile-shell-ui.test.ts` (Chromium 390px + 1280px): header pulito, elementi nascosti, nessun overflow, touch target ≥40px, drawer con tutte le voci e navigazione, chat temporanea (flag nella POST, banner, non in lista, chiusura → DELETE), desktop invariato.
- Screenshot: `chat-mobile.png`, `drawer-mobile.png`, `tempchat-mobile.png` (verificati con vision: nessun clipping; «Web» rimosso dal header mobile).

## Non fatto
- Lingua interfaccia: la voce «Lingua» nel menu mostra solo l'avviso esistente (l'UI resta in italiano, come prima).
- Nessun bottom-nav; nessun gesto swipe per aprire il drawer.
- Chat temporanea: la cancellazione non copre eventuali export già scaricati dall'utente (ovvio) e la scadenza 24 h è fissa (non configurabile).
- Deploy sul trial non eseguito.
