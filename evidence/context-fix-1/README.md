# R1 fix handoff — independent re-review required

## Scope and design

Only `src/app.ts` and `src/files.ts` changed from the received uncommitted foundation. Added `tests/idempotency-files.test.ts` and this evidence directory. Existing migrations, lifecycle/purge implementation, auth, local storage adapter, and original review evidence are unchanged (hash-verified in `verification.json`). No staging, commits, external service calls, dependency installs, or old-project access.

Root cause: generic `mutate` checked completed `idempotency` rows but ignored durable `files.request_key` reservations. The upload released its owner lock between reservation and finalization, allowing another route to claim its key.

The smallest durable fix uses the existing schema: shared `idempotentResult` checks BOTH completed responses and file reservations under the existing authenticated owner-row lock. All generic mutation callbacks (core, context, provenance, action routes) and upload reservation use the same helper before protected work. Completed cache rows remain completed-only; no nullable placeholder response or sentinel status is introduced. Existing `(owner_id, request_key)` uniqueness already supports indexed durable reservation lookup. No migration is required.

- Identical pending upload: `409 upload_pending`.
- Different body/operation with that owner/key: `409 idempotency_conflict`, before callback DB/file side effects.
- Original upload: `201`, one ready file/event/cache; stable replay after PostgreSQL/application restart.
- Generic mutation wins first: upload rejects before reservation or blob write.
- Recovery deletes pending file reservations and records cleanup by file UUID, never deletes an idempotency response by key. Tests cover a legacy same-owner/same-key completed cache and a cancelled old request versus a successful replacement upload.
- Purge removes owner reservations/caches while preserving another owner's same-key cache.

The original owner lock, `authenticatedOwner`, and `clock_timestamp()` revalidation before/after protected file I/O were retained. An initial typecheck found helper argument narrowing errors; explicit `return fail(...)` on existing key-validation failure paths fixes narrowing without casts or changed HTTP behavior. The failed typecheck log is retained.

## RED/GREEN and exact commands

Run commands from `/home/azureuser/nova-community-agent`.

| Command | Exact observed result | Evidence |
| --- | --- | --- |
| `npm test` before edits | exit 0; 39 pass, 0 fail | `baseline-main.log` |
| `./node_modules/.bin/tsx --test --test-concurrency=1 tests/idempotency-files.test.ts` before production edits | exit 1; 0 pass, 1 fail; got 201 conversation instead of 409 conflict | `red.log`, frozen `red.test.ts` |
| Same command after minimal fix | exit 0; 1 pass | `green-first.log` |
| Expanded regression command (intermediate tests) | exit 0; 7 pass | `green-expanded.log` |
| `./node_modules/.bin/tsx --test --test-concurrency=1 evidence/context-fix-1/baseline/tests/idempotency-files.test.ts` | exit 1; 5 pass, 4 fail on original source; acceptance, all-routes, DB failure and FS failure assertions detect 201 instead of 409 | `red-expanded.log` |
| `npm test` final | exit 0; 48 pass, 0 fail, 0 skipped | `final-main.log` |
| `npm run typecheck` final | exit 0 | `typecheck-final.log` |
| `./node_modules/.bin/tsx --test --test-concurrency=1 --test-name-pattern='CONTROL:|R2 observation' evidence/context-review-1/review.test.ts` | exit 0; 6 pass, 0 fail | `unaffected-controls.log` |
| `./node_modules/.bin/tsx --test --test-concurrency=1 --test-name-pattern='R1 reproduction' evidence/context-review-1/review.test.ts` | expected exit 1; 1 failed BUG assertion | `old-bug-assertion.log` |
| `git diff --check` | exit 0 | `verification.json` |
| `python3 evidence/context-fix-1/capture.py` | exit 0; original evidence and baseline snapshots match hashes, index empty, no remaining test PostgreSQL process or fix temp root | `verification.json` |

`baseline/` is the pre-edit source, migration and existing-test snapshot, plus the final new regression file copied into its tests directory to run against the old implementation. Snapshot original files are hash-verified. `red.test.ts` is an exact initial test copy for preservation (its original relative imports assume its original `tests/` location; use the runnable baseline command above for reproduction).

The new all-routes test covers every current generic mutation route (including both source branches), compares complete protected DB table snapshots, checks filesystem listing and zero file-source reads, and verifies independent owners. The nine new tests include real DB-trigger failure after fsync, real filesystem permission failure, restart retry, cancellation/replacement ownership, purge, and legacy-collision preservation. Existing tests retain real file-integrity, quotas, provenance, authentication expiry/revocation/rebind, worker policy and purge controls.

## Original review evidence is deliberately not changed

The old R1 reproduction asserts the BUG (`conflicting.status === 201`, original upload 500). It is expected to fail after the fix; its new log records the corrected 409 conflict, original 201 ready, one event, one blob, and stable 201 retry. A green old bug-assertion test would indicate regression, not acceptance. All six other review tests still pass.

## Exact limitations

- This is a fix implementation handoff, not independent approval. Re-review the source diff and rerun the acceptance tests.
- Single-active-instance encrypted local development adapter only. Overlapping startup may cancel a live upload in its reservation gap; R2 remains the documented nonblocking observation, not fixed here.
- Genuine failed uploads remain pending and consume quota until existing startup recovery. Immediate same-request retry returns `upload_pending`; after recovery the same request/key succeeds. No new retry daemon or eager cleanup behavior was added.
- Existing completed legacy collisions are preserved, not overwritten; the losing historical upload key remains conflicted. Recovery removes only the old pending upload/blob.
- The shared namespace is enforced by application paths using the authenticated owner lock, not a new cross-table SQL constraint. Arbitrary privileged SQL writes can still manufacture legacy inconsistent state, which is explicitly recovery-tested.
- Real private loopback HTTP/PostgreSQL and private ephemeral files only; no cloud storage, KMS, distributed coordination, external delivery, network audit/install or production deployment was exercised.
