# NOVA Community Agent — J0 local foundation API

This is an executable **foundation slice, not an MVP or a public service**. There is no UI, LLM, voice, real email, browser automation, object storage, PDF renderer or provider integration. Generic artifacts currently use a closed `{text, language}` schema (`it|bn|en`). Source/Evidence entities are not yet implemented; this slice does not claim the entirety of architecture J0 is complete.

## Run and verify

From `/home/azureuser/nova-community-agent`:

```sh
npm test
npm run typecheck
npm audit
```

Tests provision real embedded PostgreSQL 17 clusters with random in-memory passwords, SCRAM authentication, `127.0.0.1` binding and private temporary directories. They start real HTTP sockets and subprocesses, restart PostgreSQL and API processes, and stop/remove their own resources in `finally`. No global database service, sudo or cloud account is used. Dependencies (including `tsx`) must be installed with development dependencies for this local foundation.

For operator use against an **independent, already-running local PostgreSQL database**, set `PGHOST=127.0.0.1`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE` securely in the process environment. Do not put credentials in chat, command history, committed files or evidence. Scripts reject non-loopback database configuration.

```sh
# Parent directory must already exist and be private; output file must not exist.
npm run bootstrap -- /private/path/session.json
PORT=3000 npm start
# Separate foreground terminal; bounded batch, exits when queue is empty.
npm run worker
```

Bootstrap runs migrations, creates a fresh opaque user and a random 256-bit bearer session with 24h expiry, and writes credentials using exclusive create and mode `0600`. It never prints credentials. Bootstrap is a **local database-operator privilege**, not a web signup mechanism. There is no public identity/session issuing endpoint, account recovery, session renewal or password flow. Protect and delete the credential file as appropriate. Startup migrations are transactional, serialized and tracked; SQL files must remain immutable after deployment. API binds only `127.0.0.1`. `SIGINT`/`SIGTERM` closes its HTTP listener and pool.

## Common contract

All routes, including unknown routes, authenticate `Authorization: Bearer <opaque-session>` in `onRequest`, before parsing/validation or resource access. Only SHA-256 session hashes are stored. Ownership comes exclusively from the authenticated session; client/model `owner` fields are rejected. Cross-owner references return the same `404` as missing records.

POST routes require `Idempotency-Key: <1..100 ASCII letters/digits/_/->`. Keys are scoped to the owner, fingerprint method + exact URL + canonical JSON body and cache the safe response in the mutation transaction. Identical replays return the original status/body; different input yields `409 idempotency_conflict`. Keys are currently retained until purge, without automatic TTL. Use fresh keys for new operations. DELETE purge does not require a key and revokes the caller's session, so a retry returns `401`.

Bodies, path parameters and queries are closed schemas. Unknown fields/queries are rejected; maximum request body is 64 KiB. UUID IDs; no implicit type coercion. All response objects are explicit projections (never `SELECT *` returned to clients). Errors expose only `{ "error": "stable_code" }`; no SQL, stack, raw parser input, provider exception, token hash or session hash. HTTP logging is disabled. No CORS or cookie auth is configured.

| Status | Meaning |
|---|---|
| 200 | Read/export/purge |
| 201 | Accepted durable mutation (including queued execution) |
| 400 | Invalid schema or missing/malformed idempotency key |
| 401 | Missing, expired, revoked or purged session |
| 404 | Resource absent or not owned |
| 409 | Optimistic-lock, idempotency, intent/approval or transition conflict |
| 413 | Body too large |
| 500 | Redacted internal failure; transaction rolled back |

## Conversations and tasks

- `POST /conversations` — `{ "title": "..." }`; returns `{id,title}`.
- `POST /tasks` — `{ "conversationId": "uuid", "goal": "..." }`; returns `{id,conversationId,goal,status,version}`.
- `GET /tasks/:id` — persisted state, same safe fields.
- `POST /tasks/:id/transition` — `{ "baseVersion": 1, "status": "active" }`; returns `{id,status,version}`.

Title/goal maximum 300 characters. Allowed transitions: `created → active|cancelled`, `active → paused|completed|cancelled`, `paused → active|cancelled`. Terminal tasks cannot resume. This is checkpoint/lifecycle storage, not an autonomous task planner. Mutation and event/outbox insertion commit together.

## Canonical artifacts

- `POST /artifacts` — `{ "taskId":"uuid", "title":"Draft", "content":{"text":"...","language":"it"} }`.
- `POST /artifacts/:id/revisions` — `{ "baseRevision":1, "content":{"text":"Updated","language":"it"} }`.
- `GET /artifacts/:id/revisions/:revision` — `{id,revision,content,hash}`.
- `GET /artifacts/:id/revisions/:revision/export` — same fields plus `renderer: "canonical-json-v1"`.

Artifact content max 20,000 characters. SHA-256 is over canonical JSON **content**, not HTTP response bytes. Revision numbers increase monotonically. Writes reject stale bases with `409 revision_conflict`; DB triggers reject revision UPDATE/DELETE except owner purge. Historic revisions remain readable and exportable even when superseded. Export is JSON derived from that exact immutable revision; **not PDF or a binary object store**.

## Policy, intent, approval and receipts

1. `POST /intents`
   ```json
   {
     "artifactId":"uuid",
     "revision":1,
     "operation":"simulate.send",
     "account":"synthetic-account",
     "recipient":"fixture@example.invalid",
     "expiresInSeconds":300
   }
   ```
   Only synthetic operation/account and `@example.invalid` recipients are accepted; expiry 1..900 seconds. Payload is loaded server-side from the owned revision, never supplied by the caller. Response includes id, operation, account, recipient, artifactId, revision, payload, expiresAt, bindingHash, consequence and `policy: require_approval`. Hash freezes those fields **plus owner and intent ID**. Intent rows are immutable.
2. `POST /intents/:id/approve` — `{ "bindingHash":"64 lowercase hex" }`; returns approval `{id,intentId,status,bindingHash}`. Authenticated owner must explicitly acknowledge the displayed binding. Only one approval exists per intent; revocation requires a new intent, not reapproval.
3. `POST /intents/:id/execute` — `{ "approvalId":"uuid", "bindingHash":"..." }`. Revalidates revision/hash/expiry, atomically consumes one approval, writes one queued receipt and outbox entry. Response `{id,intentId,status:"queued"}` is **not a successful send**. Receipt and approval unique constraints prevent repeated consumption.
4. `npm run worker` dispatches the queue through the explicitly synthetic adapter. There is no network send implementation. Before I/O it revalidates owner, session expiry, approval state/binding/expiry, current revision and task status (`created|active`). Invalid queued work is cancelled.
5. `GET /receipts/:id` — `{id,intentId,status,reference}`. Status is `queued|executing|succeeded|outcome_unknown|cancelled`. A `synthetic-*` reference denotes simulation, not an external receipt.
6. `POST /approvals/:id/revoke` — `{}`; revokes authorization for future dispatch. It cannot undo an effect already in flight/completed.

### Durable worker semantics

Claims use short DB transactions, owner `FOR UPDATE SKIP LOCKED`, unique random lease token, DB-time lease expiry and conditional update. A stale token cannot process a reclaimed lease. All application mutations serialize on owner row first (conservative per-owner throughput).

The worker commits `executing` **before I/O**. Then it takes the owner lock, rechecks policy/fence, performs bounded synthetic I/O, persists the redacted outcome and completes outbox atomically. While in flight, purge/revision/revocation/claim serialize behind that owner lock. Purge cannot undo already-started work; after purge commits no owned data/capability can be recreated. A claim recovered with an existing `executing` marker becomes `outcome_unknown`, never retried automatically. Even a crash before I/O can conservatively become unknown.

Timeout, thrown adapter error or malformed result becomes `outcome_unknown`; late resolution cannot overwrite it. Default call timeout 5s and lease 30s. AbortSignal is advisory: JavaScript cannot guarantee cancellation of an uncooperative future provider. This is a reason **not** to add real connectors without an independent design/review and remote idempotency/reconciliation. Unknown outcomes have no reconciliation API yet. Non-action outbox events are acknowledged by the local worker but not pushed to clients.

## Privacy

- `GET /me/export` — owner-locked consistent snapshot containing conversations, tasks, artifacts, revisions, intents, approvals, receipts, outbox events and audit. Excludes session secrets/hashes, execution session bindings and idempotency caches. Currently in-memory/unpaginated: local foundation only.
- `DELETE /me` — `{ "confirm":"purge" }`. Marks immutable user tombstone and removes sessions, cached responses, events, audit and all cascaded product data in one transaction. Returns `{status:"purged"}`. Subsequent calls receive `401`.

The retained tombstone contains only opaque ID, status, creation/purge timestamps. DB triggers reject writes for inactive owners, owner reassignment and tombstone deletion/reactivation. Database administrator/superuser bypass remains outside the application threat boundary. Purge here covers this database only; no claim is made about external storage or backups, which are not implemented.

## Explicit release limits

Independent security/concurrency review is required before advancing release gates. No public exposure: rate limiting, quotas, TLS, telemetry redaction pipeline, least-privilege DB runtime role/RLS, retention scheduling, backup/restore deletion replay, migration checksum verification, session rotation/recovery and export pagination are not production-ready. No Evidence/source model, object store or user-facing product flow is included. See `evidence/foundation/report.md` for actual test evidence and residual risks.
