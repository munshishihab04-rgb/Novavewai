# Multilingua (IT · বাংলা · Banglish · EN) + home mobile — report

Project `/home/azureuser/nova-community-agent` · 2026-10-01 · locale, non deployato. Esito suite/typecheck: vedi `test-full.log`, `typecheck.log`.

## Regola del prodotto (una sola, condivisa chat + voce)
- **L'utente scrive/parla come vuole**: italiano, bangla (script bengalese), Banglish (bangla in lettere latine), inglese o **misto** nello stesso messaggio. Nova capisce sempre; non chiede mai di cambiare lingua.
- **Nova risponde nella lingua impostata** (se fissata), anche se l'utente scrive in un'altra lingua o in un mix. Con **Automatica** segue la lingua dominante dell'ultimo messaggio (bangla→bangla in script bengalese; Banglish→Banglish).
- **Richiesta esplicita in conversazione** («rispondi in inglese», «বাংলায় বলো», «answer in Italian») **vince** sulla preferenza per quella conversazione, finché l'utente non chiede altro. Un semplice cambio di lingua dell'utente non è una richiesta.
- Tre impostazioni **indipendenti** per utente: **interfaccia** (it / bn / bn-latn / en), **risposte chat** (auto + 4), **risposte vocali** (auto + 4; bn-latn = parla bangla, sottotitoli in lettere latine). Si cambiano dal menu → «Lingua e voce» e si applicano subito all'interfaccia, dal turno successivo alla chat, dalla prossima sessione alla voce.

## Implementato
| Area | File |
|---|---|
| Modulo lingua: codici, nomi, `replyLanguageRule(pref, channel)`, validazione preferenze, stringhe UI per 4 lingue (stesse chiavi, test) | `src/language.ts` |
| Persistenza preferenze (migration 019 `user_preferences`), `GET/PUT /me/preferences` (merge parziale, 400 su valori non validi, owner-isolated) | `migrations/019_user_preferences.sql`, `src/web.ts` |
| Chat: regola lingua iniettata nel system prompt a ogni turno dalla preferenza salvata (mai dal modello) | `src/agent.ts` |
| Voce: policy riscritta sulla stessa regola; `auto` dall'UI risolve alla preferenza voce salvata; `bn-latn` accettato dal `/voice/sessions` | `src/voice-policy.ts`, `src/voice.ts`, `public/features.js` |
| Interfaccia: `public/i18n.js` **generato** da `src/language.ts` (`scripts/build-i18n.ts`), `data-i18n` su index.html, `applyLanguage()`, dashboard/features tradotti via `t()`, `html lang`, font **Noto Sans Bengali** (OFL, servito localmente, CSP `font-src 'self'`) | `public/app.js`, `public/dashboard.js`, `public/features.js`, `public/index.html`, `public/dark.css`, `public/NotoSansBengali-*.ttf`, `assets/fonts/OFL.txt` |
| Pannello «Lingua e voce» (3 select, salva solo le chiavi cambiate, ri-render immediato) | `public/index.html` `#languagedialog`, `public/app.js` |
| Home (dashboard) su telefono: stesso header pulito ☰ · logo · ⏱ (PROVA PRIVATA e ⚙ nel menu); testi home tradotti | `public/dashboard.js`, `public/dark.css` |
| PDF/CV/DOCX in bangla: Noto Sans Bengali embedded nel worker + **shaping HarfBuzz** (`uharfbuzz`, Apache-2.0) attivo quando il testo contiene bengalese → vocali/congiunte corrette (verificato visivamente, prima erano sbagliate); DOCX imposta il font complex-script | `scripts/cv_layouts.py`, `scripts/document-worker.py`, `scripts/office_formats.py` |

## Test
- `tests/language.test.ts`: default, validazione, persistenza, isolamento owner, parziale; regola `auto`/fissa/`bn-latn`/override esplicito; policy voce per tutte le preferenze.
- `tests/language-agent.test.ts`: il system prompt della chat contiene la regola corretta (auto → bn → bn-latn) cambiando la preferenza fra un turno e l'altro, con un messaggio utente **misto** (it+Banglish+en).
- `tests/i18n-ui.test.ts` (Chromium): tutte le lingue hanno le stesse chiavi; UI in bn e Banglish con `html lang`, drawer tradotto, font Bengali dichiarato e applicato; pannello lingua (3 select, PUT solo delle chiavi cambiate, re-render); header home mobile pulito.
- `tests/cv-render.test.ts`: CV con contenuto bengalese incorpora Noto Sans Bengali, CV latino resta DejaVu.
- Screenshot verificati con vision in `evidence/i18n/`: home/chat/drawer/impostazioni in bn, bn-latn, en su phone 390, tablet 768, desktop 1366; `cv-bn-*.pdf/png` (shaping corretto nei 3 template).

## Limiti dichiarati
- La regola lingua è **istruzione al modello**, non un filtro deterministico: non c'è un controllo server-side che verifichi la lingua della risposta prodotta (un test con provider reale IT/BN/misto non è stato eseguito in questo turno).
- Voce `bn-latn`: lo script latino vale per i sottotitoli; la qualità del parlato bangla dipende dal provider realtime.
- Traduzioni bn/Banglish scritte da me, non riviste da madrelingua: da far validare dalla comunità prima del rilascio.
- Il selettore «IT / বাংলা / EN» nel header desktop resta solo un avviso informativo (le impostazioni reali sono nel pannello «Lingua e voce»).
- Messaggi di errore (`errorText`) e i receipt delle card lavoro restano in italiano.
- Deploy non eseguito.
