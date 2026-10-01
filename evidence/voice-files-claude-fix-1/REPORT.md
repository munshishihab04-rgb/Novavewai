# Voice admission fix — evidence/voice-files-claude-fix-1

Date: 2026-09-26. Scope: two reported server logic gaps in `/voice/sessions` (REPORT voice-files-1 §limit 5). No deploy, restart, commit, public/ change, network call or provider cost. Sole writer for this fix.

## Reproduced before edits (red)
`red-before-fix.tap` — new tests/voice-admission.test.ts against unmodified src: 0 pass / 4 fail.
- capacity: 8 owners concurrent with held provider connect → more than four `connecting|active` rows admitted (assertion "more than four sessions admitted concurrently", actual false).
- duplicate key: second POST with same idempotency-key → 409 voice_active instead of replay.
- lost-ack: duplicate during connecting → 409 voice_active, no read-only recovery route (voice_pending expected).
- restart: replay after restart had no durable state to consult.

## Changes
1. migrations/016_voice_admission.sql — `voice_sessions.request_key` (validated pattern), `request_fingerprint`, UNIQUE(owner_id,request_key). Additive only.
2. src/voice.ts POST /voice/sessions:
   - Requires `idempotency-key` (same regex/fingerprint/`idempotentResult` mechanism as `mutate()`; no parallel infrastructure).
   - Admission transaction (after authenticatedOwner owner lock + exact bearer session check): key/fingerprint conflict → 409 idempotency_conflict; reserved session for that key → replay of durable 201 response only if the session is still `active`; `connecting` → 409 voice_pending; failed connection → 503 voice_connection_failed; anything else (stopped, restart-failed, expired) → 409 voice_stopped, never a stale SDP answer. Then conversation ownership, one-active-per-owner, and global capacity count under `pg_advisory_xact_lock(913007)` (new id, transaction scoped, held only inside the short admission transaction — NOT during the provider network call, no global owner lock). Row inserted as `connecting` with key+fingerprint before the provider call, so a lost ack has a durable id.
   - After provider connect: activation UPDATE and INSERT of the 201 response into `idempotency` commit in one transaction; replay comes from the DB, not a second `provider.connect`.
   - SafeError from inside the connect block (voice_stopped after cancel) is propagated honestly instead of being flattened to 503.
3. src/voice.ts GET /voice/sessions?requestKey=… — read-only recovery of id/status/conversationId/expiresAt by owner+key; never returns the provider answer.
4. staging/voice-files/public/native.js — the handshake POST uses one requestKey; on `network` or `voice_pending` error it recovers the reserved id read-only via GET by key and stops it, then surfaces the error ("Voce non avviata"). No blind reconnect. Not deployed (staging only).

## Verification (executed commands, exit codes)
- `node_modules/.bin/tsx --test --test-concurrency=1 --test-reporter=tap tests/voice-admission.test.ts` (pre-fix) → red-before-fix.tap, exit 1, 0/4.
- `node_modules/.bin/tsx --test --test-concurrency=1 --test-reporter=tap tests/voice-admission.test.ts tests/voice-native.test.ts evidence/voice-files-claude-1/harness.test.ts` → targeted-after-fix.tap, exit 0, **13 pass / 0 fail** (4 new admission tests, 4 existing voice-native, 5 independent Claude harness). Real temporary embedded PostgreSQL, controlled provider, no network.
- `node_modules/.bin/tsc --noEmit` → typecheck.log, exit 0.
New test coverage: 8-owner concurrent admission exactly 4×201/4×429 with 4 provider calls and ≤4 live rows during the race, freed slot admits (positive control); duplicate key replay identical body with 1 provider call; fingerprint mismatch conflict; fresh key → voice_active; foreign owner key namespace 404; read-only GET by key (no sdp); missing key 400; lost-ack during connect → voice_pending, recovery id, replay after completion identical; cancel (stop) of unknown-to-client id recovered by key while connecting → original returns voice_stopped, replay voice_stopped, no reconnect; app restart → session failed, replay voice_stopped with no provider call, fresh key admits; bearer revocation → 401 with no provider call.
Not run: full `npm test`, Playwright UI test (tests/voice-files-ui.test.ts; not modified — the mocked 201 path is unchanged, but the new recovery branch in native.js is not browser-exercised here).

## Hashes
Before (hashes-before.txt): src/voice.ts 8e3b2396…, native.js a83622b9…, 014_voice.sql a9014e61…
After (hashes-after.txt): src/voice.ts 947e1884…, native.js 4d98958f…, 016_voice_admission.sql 928e7e83…, tests/voice-admission.test.ts 95ecee82…

## Limits / honest notes
- Migration 016 must be applied on a coordinated restart; not deployed. 013–015 untouched.
- The staged UI recovery discards a lost-ack session (stop) rather than attaching to it: reattaching a WebRTC answer to a new peer is not possible without renegotiation, so discard+retry is the safe behaviour. Recovery GET exposes only id/state.
- Capacity is serialized via an advisory lock per admission transaction; owner lock (`users FOR UPDATE`) is still per owner. Expired-but-not-closed rows still count toward capacity until close/timer/restart marks them, as before.
- Browser provider control over the data channel and non-verbatim realtime speech remain unresolved release gates; NOT addressed by this fix. Full transport ownership would require a redesign (server-owned speech transport), documented not improvised.
- Time budget forced skipping an independent browser run of the new native.js branch; server behaviour it relies on is fully tested.

Artifacts (absolute):
/home/azureuser/nova-community-agent/evidence/voice-files-claude-fix-1/REPORT.md
/home/azureuser/nova-community-agent/evidence/voice-files-claude-fix-1/red-before-fix.tap
/home/azureuser/nova-community-agent/evidence/voice-files-claude-fix-1/targeted-after-fix.tap
/home/azureuser/nova-community-agent/evidence/voice-files-claude-fix-1/typecheck.log
/home/azureuser/nova-community-agent/evidence/voice-files-claude-fix-1/hashes-before.txt
/home/azureuser/nova-community-agent/evidence/voice-files-claude-fix-1/hashes-after.txt
/home/azureuser/nova-community-agent/src/voice.ts
/home/azureuser/nova-community-agent/migrations/016_voice_admission.sql
/home/azureuser/nova-community-agent/tests/voice-admission.test.ts
/home/azureuser/nova-community-agent/staging/voice-files/public/native.js
