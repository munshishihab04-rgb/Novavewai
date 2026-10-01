# Public access 1 — registrazione e login self-service (NOVA Community Agent)

Data: 2026-09-30 · Scope: `/home/azureuser/nova-community-agent` · Metodo: TDD (test scritti prima, RED verificato, poi implementazione) · Nessun deploy/restart/commit (compete al coordinatore).

## Cosa può fare ora l'utente
- Aprire NOVA senza link personale, creare un account (nome utente + password) e usare subito il proprio spazio privato.
- Rientrare con `Accedi`; la sessione dura 7 giorni (invito: resta 24h).
- Il flusso invito (`#invite=`), compreso il benvenuto personale per Ricky, è invariato.

## Cosa NON è incluso (rischi residui)
1. **Nessuna verifica email / recupero password**: chi perde la password perde l'accesso; nessun canale di reset. Il nome utente è l'unico identificatore.
2. **Esposizione costi**: la registrazione è aperta; le difese sono 5 registrazioni/IP/ora, 20 richieste/min/IP sulle rotte auth, 10 login falliti/15 min per IP+utente e il tetto giornaliero per account (`NOVA_DAILY_RUNS_PER_ACCOUNT`, default 60 run). Un attaccante con molti IP può comunque creare account e consumare 60 run ciascuno. Non c'è un tetto globale giornaliero né un budget in euro; consigliato monitorare Foundry e, se serve, `NOVA_PUBLIC_REGISTRATION=off` (chiude le registrazioni, login resta attivo).
3. I contatori rate-limit sono in memoria (per processo): si azzerano al riavvio e non sono condivisi fra istanze.
4. Il tetto giornaliero conta i *run* (turni), non i token: un turno può fare fino a 8 chiamate modello.
5. Sessioni: nessuna rotazione/chiusura remota di tutte le sessioni di un account; `logout` invalida solo la sessione corrente (comportamento preesistente).
6. Username enumerabile via `409 username_taken` in registrazione (inevitabile con nomi unici pubblici); il login non distingue utente sconosciuto da password errata e paga sempre scrypt.
7. `staging/jobs-generic-1/app.js` non è più byte-identico a `public/app.js` (non toccato per vincolo di scope; i test staging leggono solo `renderJobReceipts`, che è invariato). Da riallineare al prossimo rilascio.
8. Gli owner esenti vanno passati in env al riavvio del servizio trial (unità `systemd-run` transient: stop + reset-failed + rilancio con `EnvironmentFile`), es. in `~/.local/share/nova-community-trial/trial.env`:
   `NOVA_UNLIMITED_OWNERS=<owner-id del file owner-id>,<owner in ricky-invite-metadata.json>`. Nessun id è hardcodato nel codice.

## Backend
- `migrations/017_accounts.sql`: `account_credentials(owner_id PK→users, username UNIQUE + CHECK regex, password_hash, created_at, last_login_at)`, `account_usage(owner_id, day, runs, PK(owner_id,day))`.
- `src/accounts.ts` (nuovo): normalizzazione username (lowercase, `^[a-z0-9_.-]{3,32}$`), password 10..200, scrypt `N=32768,r=8,p=1`, salt 32 byte, `timingSafeEqual`; formato `scrypt$N$r$p$salt$key`. `verifyAgainstDummy` esegue scrypt su un hash fittizio quando l'utente non esiste (contatore `scryptStats.dummyVerifications` asserito nei test). `Throttle` (finestra scorrevole, memoria limitata). `accountLimitsFromEnv` (valida `NOVA_DAILY_RUNS_PER_ACCOUNT`, `NOVA_UNLIMITED_OWNERS`), `consumeDailyRun` (lock riga + upsert atomico dentro la transazione del turno).
- `src/web.ts`: `POST /auth/register` (201 + cookie `__Host-nova` 7 giorni HttpOnly Secure SameSite=Strict; 400 `invalid_username`/`weak_password`/`invalid_request`, 409 `username_taken`, 403 `registration_closed`, 429 `rate_limited`), `POST /auth/login` (401 `invalid_credentials` per qualsiasi fallimento; 429 con `retry_after` dopo 10 fallimenti/15 min per IP+username; aggiorna `last_login_at`; rifiuta utenti purged). Entrambe le rotte sono nel controllo CSRF (`x-nova-request` + Origin) e nel bucket 20/min. Opzione `registration` (default da env `NOVA_PUBLIC_REGISTRATION`). `/auth/exchange`, `/auth/preview`, `/auth/logout` invariati.
- `src/agent.ts`: unica modifica mirata nel turno: `consumeDailyRun` dopo i controlli esistenti → `429 daily_limit_reached` con `detail` in italiano; il turno rifiutato non persiste messaggio, task né run. `AgentOptions` accetta `dailyRunsPerAccount`, `unlimitedOwners`.
- `src/app.ts`: `SafeError.detail` opzionale, propagato dal gestore errori (solo per SafeError).
- `scripts/trial.ts`: legge le opzioni da env all'avvio (`accountLimitsFromEnv`, `registrationOpenFromEnv`) e le passa a `buildApp`/`buildWeb`.

## Frontend
- `public/index.html`: sezione `#login` ridisegnata come card scura (brand NOVA, tagline italiana, tab `Accedi`/`Crea account` con `role=tablist`, campi username+password con toggle Mostra/Nascondi, bottone primario `#31c985`, `#autherror` con `role=alert`, nota "Prova pubblica: le conversazioni sono private per account; non inserire dati sensibili."). `#logintext`/`#enter` restano per il flusso invito.
- `public/app.js`: mappa errori estesa (`invalid_credentials`→"Credenziali non valide", `username_taken`→"Nome già in uso", `rate_limited`→"Troppi tentativi, riprova tra poco", `registration_closed`, `invalid_username`, `weak_password`, `daily_limit_reached` mostrato in chat come avviso), validazione client prima della rete, submit disabilitato durante la richiesta, password azzerata dopo login/logout. Con `#invite=` il form è nascosto e il comportamento è identico a prima (personal welcome incluso). Solo `textContent`, nessuna libreria.
- `public/dark.css`: stili `.authcard` (mobile-first, card centrata su desktop alto, selettori con prefisso `.login` per vincere `.login button` di `style.css`).

## Test (node:test, PostgreSQL embedded, Chromium Playwright)
- `tests/accounts.test.ts` (3): hashing/validazione; register→api→logout→login (cookie flags, scadenza 7 giorni, `last_login_at`, duplicato case-insensitive senza righe `users` orfane, dummy scrypt su utente sconosciuto, utente purged, invito 24h invariato); CSRF sulle nuove rotte, bucket registrazione 5/h, throttle login 10/15min con `retry_after`, bucket 20/min, `registration_closed` senza righe create.
- `tests/account-limits.test.ts` (2): parsing env; guardia giornaliera 429 + detail, nessun conteggio/persistenza del turno rifiutato, owner esente illimitato, isolamento fra account, giorno precedente non conta.
- `tests/auth-ui.test.ts` (1): card in Chromium 390×844 e 1440×950 — tab, `aria-selected`, toggle password, validazione client senza rete, mapping errori API, errore XSS-shaped reso come testo, assenza `innerHTML` in `app.js`, registrazione→shell, logout→card pulita, no overflow orizzontale, regressione invito con benvenuto Ricky e `/auth/exchange`.
- Regressione: `tests/web.test.ts`, `tests/welcome.test.ts` invariati e verdi.

**Suite completa: 217/217 pass (prima 211/211; +6 nuovi), 0 fail · `tsc --noEmit` pulito.** Log: `test-full.log`, `test-new-and-regression.log`, `typecheck.log`.

## Screenshot (Playwright, backend instradato)
`auth-card-desktop.png`, `auth-card-desktop-register.png`, `auth-card-mobile.png`, `auth-card-mobile-register.png` — verificati visivamente: tab attivo corretto, bottone #31c985, toggle centrato, nessun overflow.

## File toccati
Nuovi: `migrations/017_accounts.sql`, `src/accounts.ts`, `tests/accounts.test.ts`, `tests/account-limits.test.ts`, `tests/auth-ui.test.ts`, `evidence/public-access-1/*`.
Modificati: `src/web.ts`, `src/agent.ts`, `src/app.ts`, `scripts/trial.ts`, `public/index.html`, `public/app.js`, `public/dark.css`.
Non toccati: `src/jobs*.ts`, `staging/`, voce, evidence precedenti.
