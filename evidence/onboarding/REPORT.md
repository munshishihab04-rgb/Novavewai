# Prima visita: scelta lingua + card informative · rilascio in produzione (trial pubblico)

Project `/home/azureuser/nova-community-agent` · 2026-10-01 · **pubblicato** su https://overnight-businesses-fun-fred.trycloudflare.com

## Cosa può fare ora l'utente
- Al **primo accesso** (per account, su qualunque dispositivo) compare la guida: **passo 1 lingua** (Italiano · বাংলা · Banglish · English, ognuna scritta nella propria lingua; la scelta si applica subito dietro la finestra), **passo 2** tre card informative già nella lingua scelta (cosa fa Nova · scrivi/parla come vuoi, Nova risponde nella lingua scelta · spazio privato + chat temporanea + non inserire password), nota «Nova non è un professionista», «Cambia lingua» / «Inizia».
- «Inizia» salva **interfaccia, chat e voce allineate** alla lingua scelta e marca l'account come già accolto: la guida non ricompare. È riapribile da ☰ → Impostazioni → «Guida iniziale» (mobile) o da ⚙ sulla home desktop (che prima era un pulsante morto) e dalla sidebar desktop.
- Tutte le fette precedenti sono in produzione: multilingua chat/voce/interfaccia, pannello «Lingua e voce», font bengalese, PDF/CV bangla con shaping corretto, header mobile pulito + menu laterale, chat temporanea, allegati con anteprima prima dell'invio, DOCX/XLSX/CSV, CV v1.

## Prova dal vivo (modello reale, origine pubblica) — `language-live-smoke.json`
1. Account nuovo → `onboarded:false`, interfaccia `it` (default) ✔
2. Salvataggio guida `{ui:bn,chat:bn,voice:bn,onboarded:true}` ✔
3. Utente scrive **in italiano** → risposta **in bengalese** (201 caratteri bangla, 0 latini) ✔
4. Preferenza chat → `en` (interfaccia resta `bn`) → utente scrive **misto Banglish+italiano+inglese** → risposta **in inglese** (0 bangla) ✔
Account di prova purgato con `purge-smoke-accounts.ts`.

## Rilascio
Suite 255/255 + typecheck 0 sui byte pubblicati → stop servizio → backup `~/.local/share/nova-trial-backups/<ts>/nova-community-trial.tgz` (18.9 MB) → start → migrazioni 018/019/020 applicate (verificato su DB) → asset serviti identici a `public/` (`cmp` su app.js, i18n.js, dashboard.js, features.js, dark.css; index.html differisce solo per `/native.js` iniettato dal server, identico allo staging) → font 200 `font/ttf`, CSP `font-src 'self'` → `public-access-smoke.ts` tutto ✔ → `language-live-smoke.ts` ✔.

## Implementazione
- `migrations/020_onboarding.sql`: `user_preferences.onboarded boolean default false`; può solo passare a `true` (server: `OR`), `PUT /me/preferences` accetta solo `onboarded:true` (400 altrimenti). `src/language.ts`, `src/web.ts`.
- `public/app.js`: `openWelcome/welcomeStep/finishWelcome`; `prefs.onboarded` default `true` in assenza di dato (mai mostrare la guida a chi non è certo nuovo). `public/index.html` `<dialog id="welcome">`, voce menu in drawer e sidebar. `public/dashboard.js`: ⚙ desktop apre il menu (prima: apriva il dialog provider sopra tutto / inizialmente nulla). `public/dark.css` stili `#welcome`.
- Stringhe in 4 lingue (`welcome_*`) in `src/language.ts` → `public/i18n.js` rigenerato.
- Test: `tests/welcome-onboarding-ui.test.ts` (Chromium: ordine lingua→card, etichette native, applicazione immediata, un solo PUT allineato, non ricompare dopo reload, riapertura dal menu, nessun innerHTML), `tests/language.test.ts` esteso (flag onboarding: default, solo true, persistente, isolato per utente).

## Limiti dichiarati
- Traduzioni bn/Banglish scritte da me, non validate da madrelingua.
- La lingua di risposta è istruzione al modello: provata dal vivo su 2 turni (it→bn, misto→en), non è un filtro deterministico su ogni risposta.
- Voce `bn-latn` dipende dal provider realtime; non provata dal vivo in questo turno.
- La URL pubblica è un quick tunnel Cloudflare e può cambiare (cron avvisa su Telegram al cambio).
