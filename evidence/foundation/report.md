# J0 foundation — execution report

## Verdict

**Bounded local foundation implemented and exercised; not an MVP and not full architecture J0 completion.** Real TypeScript/Fastify HTTP API and PostgreSQL storage are working. No previous NOVA/Nexus/LicenzPol repository, service, credential or code was consulted. No cloud provisioning, public listening socket or external delivery was performed. No commit was made.

**Latest full run:** `20-final-tests.log`: 14 tests passed, 0 failed, 0 skipped. `typecheck.log`: strict TypeScript passed. `npm-audit.json`: 0 reported vulnerabilities across the installed dependency graph. `cleanup.json`: no owned test processes or temporary PostgreSQL/credential directories remained. These are actual command outputs, not synthetic summaries.

Runtime observed: Node `v26.8.2`, npm `11.19.1`; Fastify `5.12.5`, pg `8.23.0`, embedded-postgres `17.10.0-beta.17`. esbuild transform and embedded-postgres import succeeded, and actual cluster init/start/restart/shutdown succeeded; no install-script bypass or global PostgreSQL service was needed.

## Implemented and verified

- Opaque 256-bit sessions with SHA-256 at rest, expiry and active-owner enforcement. Local bootstrap CLI writes mode-0600 exclusive credential file; no public identity issuance route. Session tokens/passwords are absent from evidence.
- Closed request body/path/query schemas, authentication before body parsing, parameterized owner predicates/composite FKs, explicit safe response projections and redacted errors. Unknown owner fields and cross-owner entity references rejected.
- Conversations/tasks with transactional idempotency responses and outbox events; task lifecycle CAS/version checks and restart/resume.
- Immutable artifact revisions enforced with DB trigger; optimistic lock rejects competing writes; immutable revision-bound JSON read/export and content hash.
- Server-loaded payload, immutable ActionIntent binding owner/id/payload/account/recipient/artifact revision/expiry; explicit authenticated hash approval; one approval per intent and atomic single-use consumption.
- Unique/idempotent receipts and durable action outbox; two competing workers; lease-token fencing; recovery from a persisted executing crash marker without a second effect.
- Synthetic-only adapter, dispatch-time session/approval/revision/task revalidation; revoked, expired, superseded or cancelled queued work cannot call adapter.
- Throw, malformed result, timeout and late return produce `outcome_unknown`, never blind resend. Provider error strings are not persisted/returned.
- Owner-scoped export without credentials/session bindings; atomic purge removes content/caches/events/audit/sessions, retains immutable minimal tombstone; stale worker and direct DB writes cannot resurrect an owner.
- Application process restart, full PostgreSQL restart and CLI bootstrap/server/worker subprocesses tested over real loopback sockets. In-flight synthetic action plus purge tested with a controlled synchronization barrier.
- Fault-injected outbox insert failure proves task mutation rolls back with its event. Auth parser ordering, raw DB-error redaction, SCRAM-only HBA rules and loopback DB binding asserted.

## TDD evidence

Vertical RED→GREEN progression is preserved rather than overwritten:

| Slice | RED | GREEN |
|---|---|---|
| Auth, task, persistence | `01-red-task.log` | `02-green-task.log` |
| Artifact revision/export | `03-red-artifact.log` | `04-green-artifact.log` |
| Intent/approval/worker | `05-red-action.log` | `06-green-action.log` |
| Export/purge/tombstone | `07-red-privacy.log` | `08-green-privacy.log` |
| Revocation/recovery | `09-red-recovery.log` | `10-green-recovery.log` |
| Task lifecycle | `11-red-lifecycle.log` | `12-green-lifecycle.log` |
| Operator CLI/process restart | `13-red-cli.log` | `14-green-cli.log` |
| Query schema closure | `15-red-security.log` | `16-green-security.log` |
| Cancelled-task dispatch policy | `17-red-cancel-policy.log` | `18-green-cancel-policy.log` |
| Bounded worker CLI | `19-red-worker-cli.log` | `20-final-tests.log` |

Initial RED failures were asserted absence of API/route/behavior, not fake storage or fabricated provider output. Additional adversarial tests validated already-green worker branches (timeout, lease recovery, redaction, restart). Initial typecheck found one nullable auth variable and was corrected; all subsequent recorded checks passed. The cancelled-task regression genuinely caught an unwanted synthetic adapter call and drove dispatch-policy fix.

## Commands

```sh
cd /home/azureuser/nova-community-agent
npm test
npm run typecheck
npm audit
# Local operator configuration only; no password/token on command line:
npm run bootstrap -- /private/path/session.json
PORT=3000 npm start
npm run worker
```

The test harness generates SCRAM credentials in memory, creates a private temporary cluster, chooses a loopback port and owns cleanup. `npm start`/bootstrap/worker require independent local PostgreSQL `PGHOST=127.0.0.1`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE` environment configuration; the repository does not contain those secrets. Detailed contracts: `docs/API.md`.

## Deliberate limits / review priorities

1. **Independent review remains required.** Implementer performed tests and self-inspection, not independent security approval. Parent should assign a fresh reviewer for owner/auth boundaries, approval binding, worker races, migration constraints and purge/recovery before calling this release-ready.
2. **External effects remain disabled.** There is no provider lookup/read-back/reconciliation. `succeeded` means only synthetic adapter success. `outcome_unknown` has no reconciliation API; it must never be presented as sent or automatically retried.
3. **Conservative locking.** Owner-level serialization includes a bounded in-flight synthetic call. It limits same-owner throughput and delays purge/revocation until the call transaction ends. A purge cannot undo an already-started action. AbortSignal cannot guarantee cancelling an uncooperative future connector; DB connection loss while I/O is in flight needs additional real-provider fencing/idempotency design. No exactly-once external-delivery claim.
4. **Crash coverage is bounded.** Tests perform clean process and database restarts and inject the durable executing crash boundary, plus timeouts/late outcomes. They do not kill the OS process during a real provider request or simulate filesystem/power-loss failures.
5. **Foundation subset.** Source/Evidence entities, object storage, binary exports/PDF, messages, planner, UI/LLM/voice and all domain artifact schemas are deferred. Generic artifacts are only closed text/language documents. Full J0 from the architecture still includes Evidence/object storage work; this report does not mark them done.
6. **Local-only operational posture.** No TLS, rate limits, quotas, production runtime-role separation/RLS, session renewal/account recovery, migration checksums, retention jobs, pagination or bounded export streaming. Installed TS runner is a development dependency. API DB role in ephemeral tests owns the schema; DB administrator bypass is not a defended boundary.
7. **Retention/privacy scope.** Purge covers live DB rows only; backups/object stores/providers do not exist in this implementation. Minimal opaque tombstone persists. Export excludes internal idempotency cache and capabilities. Idempotency history and audit/outbox are currently retained until purge.
8. **Operational observability.** Errors are deliberately redacted and logs disabled rather than a full structured-redaction/metrics pipeline. Queue is bounded foreground batch, not a supervisor-managed daemon; first candidate-page contention may require another batch. HTTP response safety uses explicit projections rather than comprehensive generated response schemas/OpenAPI.
9. **Bootstrap privilege.** A local operator with DB credentials can create users. Session output-file write failure after DB commit could orphan an unused user/session; no remote identity vulnerability, but operator cleanup/transactional provisioning should be hardened before production onboarding.

## Changed scope

New `src/{app,actions,privacy,worker}.ts`; five SQL migrations; `scripts/{bootstrap,config,server,worker}.ts`; real PostgreSQL test harness and eight `*.test.ts` files; package scripts; `docs/API.md`; this report and raw evidence. Existing `tsconfig.json` kept strict NodeNext. Parent-authored documents outside `docs/API.md` were not edited. No UI or existing-product files changed.
