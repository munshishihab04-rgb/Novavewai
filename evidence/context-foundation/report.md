# Context foundation — implementer evidence

## Result / boundary

Implemented and locally exercised: persistent append-only user text messages, immutable Source/Evidence attached to exact ArtifactRevision and claim/field, encrypted private immutable UTF-8 files, count/byte quotas, owner-auth downloads, durable pending/ready and purging cleanup, restart recovery and export inventory. **Local encrypted development adapter, not S3/cloud.** Not full J0, not a public/product release. Independent review remains required. No commit created.

Contract was written first in `docs/NEXT-FOUNDATION.md` after reading existing model/migrations/API/delivery and supplied architecture Conversation/Message + Source/Evidence + J0 sections. No legacy project or secret was used, no service provisioned, no provider/deployment/UI/voice/LLM work.

## Executed gates

| Gate | Actual evidence | Result |
|---|---|---|
| Vertical message RED → GREEN | `01-red-messages.log`, `02-green-messages.log` | Missing route 404 → immutable append/read/replay/pagination/restart pass |
| Vertical provenance RED → GREEN | `03-red-provenance.log`, `04-green-provenance.log` | Missing route 404 → source snapshot/excerpt/exact revision scopes pass |
| Encrypted file RED → GREEN | `05-red-files.log`, `06-green-files.log` | Missing route 404 → real encrypted bytes/private permissions/download/restart pass |
| Durable reservation + purge race RED → GREEN | `07-red-purge.log`, `08-green-purge.log` | Missing reservation boundary → late upload denied after purge; physical files absent |
| File-backed source RED → GREEN | `09-red-file-source.log`, `10-green-file-source.log` | Rejected file source 400 → snapshot and full purge cascade pass |
| Wrong root/key fail-closed RED → GREEN | `12-red-store-identity.log`, `13-green-store-identity.log` | Wrong root previously accepted → startup denial, no replacement key |
| Real CLI file integration RED → GREEN | `14-red-file-cli.log`, `15-green-file-cli.log` | File adapter unavailable 503 → subprocess restart downloads exact bytes |
| Never import an unbound old key RED → GREEN | `17-red-fresh-key.log`, `18-green-fresh-key.log` | Prepopulated key previously accepted → exclusive fresh generation/fail closed |
| Full final suite | `19-final-tests.log` | **39/39 pass**, 0 skipped/cancelled/failing |
| Preserved independent adversarial suite | `20-preserved-adversarial.log` | **10/10 pass**; original review files unmodified |
| TypeScript | `typecheck.log` | `tsc --noEmit`, exit 0 |
| Dependencies | `npm-audit.json` | audit exit 0, 0 reported vulnerabilities; no dependency/lock changes |
| Whitespace | `git diff --check` | exit 0 |
| Cleanup | `cleanup.json` | no owned node/PostgreSQL/test runtime processes remain |

Runtime measured Node v26.8.2 / npm 11.19.1; real embedded PostgreSQL 17. Tests use real HTTP sockets and private filesystem directories. `tests/cli.test.ts` preserves prior assertions and adds actual API subprocess restart for messages/files. Existing migrations 001–005 and review evidence are unchanged. Added only additive migrations 006–011.

Adversarial follow-up tests that passed immediately are recorded as **regression coverage**, not fabricated RED cycles. Initial green logs prove each tracer bullet, not exhaustive correctness of every later assertion.

## Concrete invariants exercised

- Owner/conversation composite FKs, caller role/owner/path rejection, same-owner wrong-conversation source/evidence denial, cross-user 404, exact-revision evidence not copied to next revision.
- Message sequence optimistic concurrency yields one 201 and one 409; replay stable; ordered keyset pagination and database restart readback; immutable DB triggers; owner export includes context.
- Real owner-lock waiter plus exact-token revocation denies message read and append. Existing 12 expiry/revocation/rebind tests remain green. Files revalidate after reservation lock and filesystem await; expiry during actual encrypted write cannot commit ready/outbox.
- AES-256-GCM ciphertext differs from source bytes, 0700 root, 0600 key/blob, owner/file AAD and SHA-256, restart decrypt, owner download with attachment/nosniff, corruption and symlink substitution denied before bytes are sent.
- Strict UTF-8/base64/MIME, path traversal names and client path rejected, NUL/PDF rejected, oversize rejected, 16-file cap, concurrent 128-KiB quota never exceeded.
- Actual outbox DB trigger failure after blob fsync rolls back ready/cache, leaves pending inaccessible; same-key retry cannot duplicate write; startup deletes blob/reservation conservatively then permits a new attempt.
- Actual filesystem write permission failure leaves no ready response. Actual unlink failure returns 202 purging with durable cleanup; after repair, restart removes jobs. No false 200 purge.
- Late upload paused after committed reservation cannot write after purge; resume returns 401 and restart filesystem remains clean.
- File Source→Evidence→revision purge removes DB context and blobs. Export explicitly says binaries not included; it is inventory plus separate authenticated download, not a ZIP delivery.

## Files

New: `src/context.ts`, `src/provenance.ts`, `src/files.ts`, `src/local-files.ts`, `src/file-lifecycle.ts`; migrations `006_messages.sql` through `011_local_storage_binding.sql`; `tests/context.test.ts`, `tests/files.test.ts`; contract and this evidence directory.
Modified: `src/app.ts` route/options wiring and explicit pagination schema preservation; `src/privacy.ts` inventory/durable cleanup; `scripts/server.ts` optional `NOVA_FILE_ROOT`; `tests/cli.test.ts` additive assertions; `docs/API.md`, `docs/DELIVERY.md`.

## Limits / review targets

- Files are implemented, not stubbed, but **production storage/KMS/backup/rotation/retention scheduler remain blocked**. Single local store bound to one database/path/key, no relocation or distributed writers. Root initialization fails closed if a crash left an unbound key; operator investigation needed. Losing the key loses access; never silently regenerate it.
- Local FS and DB are not a distributed atomic transaction. Safety uses durable pending reservations and conservative cleanup; availability/automatic retry is intentionally sacrificed. Cleanup retries on startup, not on a background schedule. `202 purging` revokes auth immediately and requires operator restart/repair if filesystem failure persists; no consumer purge-status capability yet.
- Owner locks span small local I/O. No guarantee against indefinitely blocked kernel I/O or same-UID hostile root replacement. Malicious DB admin/superuser or host compromise is outside this application boundary. No hard-kill/power-loss/fsync hardware fault campaign was performed; actual DB/FS boundary fault tests and clean process/PG restarts were performed.
- Ready metadata cannot be edited; whole-owner purge is the only file deletion API. File quotas are application-serialized, not protection against privileged direct SQL. No global/message/source/evidence quota or rate-limit service yet; no public exposure authorized.
- Only user/text message authorship is exposed; assistant/tool/voice roles await trusted orchestrator contracts. No generated agent output is fabricated.
- Evidence is owner-declared and always unverified: literal excerpt is NOT semantic support/attribution/truth, territory is not certified, date range is not freshness validation. URL/publisher/trust-ranking/confidence/research adapters are absent. Evidence read and owner export are unpaginated. Additional evidence does not alter artifact content hash or freeze an approval evidence bundle.
- File encryption does not encrypt PostgreSQL source snapshots or messages. Export contains source text but not delivered file binaries; users must download files separately before purge.
- Existing foundation production limits remain (onboarding/session rotation, RLS/least privilege, TLS, backup deletion replay, telemetry pipeline, migration checksums). No claim that 39+10 local tests establishes production security.
