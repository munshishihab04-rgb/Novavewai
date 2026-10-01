# licenzpol.it/nova → nuova Nova in produzione · APK Android firmato · 2026-10-01

## Cosa può fare ora l'utente
- **https://licenzpol.it/nova/** è la nuova Nova (NOVA Community Agent): registrazione/login, onboarding lingua, chat in it/bn/Banglish/en con modello via Managed Identity della VM (Foundry 200), CV, documenti, job search (Adzuna + Subito + JSON-LD), voce, chat temporanee, mobile shell. Verificato dal vivo: smoke lingua (it→bn 199 caratteri bangla; misto→en), registrazione via UI reale, onboarding in bangla, home in bangla senza errori console (screenshot `*-phone.png`).
- **PWA installabile**: `/nova/manifest.webmanifest` (scope `/nova/`, icone 192/512 + maskable), theme-color.
- **App Android**: `https://licenzpol.it/nova/download/nova.apk` (+ `.sha256`). Pacchetto `it.licenzpol.nova` v0.1.0 (code 1), 426 KB, Trusted Web Activity su `https://licenzpol.it/nova/` (Chrome a schermo intero, nessuna WebView/bridge/permesso proprio). Firmata (v2) con keystore generata sul server; impronta SHA-256 `6E:F3:DC:…:27:7B` pubblicata in `https://licenzpol.it/.well-known/assetlinks.json` e **verificata uguale** a quella dell'APK (`apksigner`). Copia dell'APK in questa cartella (`nova-0.1.0-1.apk`, sha256 `1378eb8e…3243`).
- LicenzPol (storefront) e Nexus **intatti** (200, servizi attivi, PID invariati).

## Vecchia Nova
`nova-voice` (3950) **fermata e disabilitata**; snapshot completo server+dati (409 MB) + Caddyfile + unit in `/opt/nova-legacy-backups/20261001T110047Z/`. Rollback documentato in `docs/DEPLOYMENT.md` §8. Gli utenti della vecchia Nova non vedono più la loro storia (scelta esplicita dell'owner).

## Come è fatto
- App montata con `NOVA_BASE_PATH=/nova` (nuovo: `src/web.ts` riscrive al volo i riferimenti statici; niente `<base>` perché CSP è `base-uri 'none'`), unit di sistema `nova-community.service`, dati in `/opt/nova-community/data` (`NOVA_TRIAL_DIR`), Caddy `handle /nova/* → 4187` (prefisso preservato) + `handle /.well-known/assetlinks.json → 4187`.
- Toolchain sul server: uv venv (python3-venv assente), Chromium + librerie di sistema via apt, JDK 17 + SDK 35 + Gradle 8.11.1 in `/opt/android-build`.
- Progetto Android in `android/` (gradle, manifest TWA, icone adattive dal marchio spark, splash). Keystore + `signing.env` in `/opt/nova-community/data/keystore/` (600) — **da includere nei backup, senza di essa niente aggiornamenti dell'app**.

## Difetti trovati dal vivo e corretti
1. `could not open shared memory segment` al primo accesso: `logind RemoveIPC=yes` cancellava la shared memory POSIX di Postgres a fine sessione SSH → `dynamic_shared_memory_type = mmap`.
2. `<base href>` bloccato dalla CSP (`base-uri 'none'`) → rimosso, riferimenti riscritti assoluti.
3. Inline `style="display:none"` sullo sprite SVG violava `style-src 'self'` (pre-esistente anche sul trial) → classe CSS.
4. `/.well-known/assetlinks.json` finiva a LicenzPol (404) → route Caddy dedicata.

## Test
Suite **275/275**, typecheck 0 (`test-full.log`). Nuovi: `tests/base-path.test.ts` (prefisso: asset, html, css, js, auth, api, 308, root 404, default root invariato), `tests/pwa-manifest.test.ts` (manifest/icone/scope, assetlinks dal file dati o 404, download APK o 404).

## Limiti dichiarati
- APK **non su Google Play**: installazione manuale ("origini sconosciute"). Senza Play non c'è aggiornamento automatico: ogni release = nuovo `versionCode` + nuovo download.
- TWA richiede Chrome (o browser compatibile) aggiornato sul telefono; senza, Android apre il sito nel browser normale.
- Il trial pubblico su quick-tunnel (`overnight-businesses-…`) continua a girare in parallelo su questa VM: da spegnere quando licenzpol.it/nova è considerato definitivo.
- Account di prova (`smoke_*`, `dbg_*`) marcati `purged`.
