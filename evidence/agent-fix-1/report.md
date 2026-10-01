# Agent review-1 fix report

## Outcome

The four reproduced blockers are fixed in the local candidate. Independent rereview is still required; no release approval is claimed.

- Original independent probes, unchanged: **9/9 pass**, versus **5 pass / 4 expected failures** before production edits.
- Final `npm test`: **105/105 pass**, **0 fail / 0 cancelled / 0 skipped** (207479.268135 ms). This includes all original 86 tests (48 foundation + 38 agent/config/restart), unchanged, and 19 permanent regression tests.
- Final `npm run typecheck`: exit **0**.
- `git diff --check`: exit **0**. Separate no-index checks against the dirty baseline cover new/untracked source, tests and docs too: no whitespace diagnostics (exit 1 means files differ).
- No staging or commit. No legacy project, credential discovery, cloud, real model or UI access by this fix task. PG databases are ephemeral private test instances; providers are controlled loopback HTTP.

## Fixes and observed readback

### SESSION-WRITER

Exact owner + initiating token authorization uses `clock_timestamp()` after canonical, receipt/event and terminal writes, immediately before returning the effect transaction for commit. The final check is authorization-only: it preserves the run's own updated task status, checkpoint, context hash, sequence and artifact revision rather than applying stale pre-write context or requiring its newly completed run to remain running.

Original PG artifact row-lock probe now reads revision **1**, content **BEFORE**, zero tool receipts, one provider call, `failed/session_revoked`, tool_calls **0**. Permanent tests also block actual receipt insertion and terminal event insertion; all artifact/receipt/outbox/message/task-completion effects roll back when the session expires. Existing positive multi-tool, question/completion and canonical-CAS tests remain green.

### PROVENANCE

`/sources` now reads the message role and rejects non-user messages with **409 generated_source_not_allowed** before inserting a source/outbox/idempotency result. Independent source readback has no persisted generated-as-user row. Minimal choice: rejection, not a new origin enum or migration. User message and file source behavior stays covered by unchanged foundation tests.

### STARTUP-RESERVATION

A dedicated application singleton is acquired before file initialization/recovery. It applies to non-agent and no-file application instances as well as agent mode; otherwise a non-agent file runtime could still delete a live reservation. Existing runtime binding/root checks remain. Rejected startup leaves the live pending upload untouched, a colliding turn returns 409, and the original upload completes 201. Permanent probes cover agent→non-agent and non-agent→non-agent overlap.

Failed file/run initialization relinquishes the acquired dedicated client, including before callers invoke close. A real existing-key initialization failure verifies zero remaining singleton locks, immediate successor startup, and removal of application-owned error/end listeners.

### LEASE-LOSS

Dedicated client error/end permanently invalidates the instance, synchronously aborts its jobs, rejects new HTTP work, and destroys (rather than pools) the lease client. Healthy DB persists `outcome_unknown/runtime_interrupted` by exact active run ID under the owner lock. This persistence runs independently of held filesystem reads. Cancellation, purge and already terminal runs win; an old runtime cannot mark successor runs unknown.

Agent effect and generic mutation/file transactions take a shared handover barrier and check actual dedicated lock ownership before work and after writes. A successor acquires the singleton and waits for the exclusive handover barrier before destructive recovery. A real artifact writer-lock probe verifies successor startup waits for the old transaction to roll back; the old revision remains unchanged, no receipt appears and no second inference is dispatched. Provider dispatch also checks runtime validity after checkpoint commit.

The original child-process probe now reports **no exit/crash, empty stderr**, **one provider call**, `outcome_unknown/runtime_interrupted`, **zero artifacts/assistant messages**, and no remaining old lease. Permanent cases terminate the real PG backend during held inference, then start a new runtime, execute a fresh turn, release the old response, and verify only NEW_RUNTIME persists. Cancel/purge cases and closing the dead app while the successor owns the lock also pass. A dedicated client end-only probe verifies fail-closed HTTP and listener cleanup.

## TDD and evidence

- `baseline/`: exact pre-fix dirty J1 src, scripts/config, migrations, tests, docs and original review history, plus package/TypeScript configuration.
- `baseline-sha256.json`: preserved baseline hashes.
- `red-independent.log`: exact original corrected-behavior probes before code: 9 tests / 5 pass / four expected failures.
- `red-independent-artifacts/`, `green-independent-artifacts/`: actual readback JSON and harness copies for each run. Original `evidence/agent-review-1/` was restored byte-for-byte after each probe run; its historical verdict remains NON APPROVATO, not rewritten as acceptance.
- `red-session-provenance.log` → `green-session-provenance.log`: 2 expected failures → 2 pass.
- `red-startup-modes.log`: both non-agent overlap assertions fail before runtime changes.
- `red-final-writes-baseline.log`: expanded receipt/terminal tests also run against isolated preserved pre-fix source: 2 expected failures. This was supplemental differential verification after the primary exact session RED/GREEN, not the initial TDD proof.
- `red-lease-file-read.log` → `green-lease-file-read.log`: new held-read assertion failed before independent unknown persistence was implemented; five related lease checks subsequently pass.
- `green-independent.log`: 9/9 unchanged independent probes pass.
- `npm-test-final.log`, `typecheck-final.log`, `diff-check.log`: final gates.
- `fix.diff`: complete delta against the actual dirty J1 baseline, including untracked files (not merely HEAD diff).
- `verification.json`: candidate source hashes and preservation inventory; **zero mismatches** across baseline bytes and original tests/scripts/migrations/review history; 51 protected live files verified unchanged.

## Changed files

Production delta from incoming dirty J1: `src/agent.ts`, `src/app.ts`, `src/files.ts`, `src/file-lifecycle.ts`, `src/provenance.ts`; new `src/runtime.ts`. Documentation: `docs/AGENT-CORE.md`. Permanent tests: new `tests/agent-review-regressions.test.ts` and `tests/agent-runtime.test.ts`. All other incoming src/config/migration changes are preserved, not ours. No migration was added or modified by this fix.

## Harness incidents and remaining scope

- The first in-process lease RED surfaced the real unhandled PG error in all three cases, then timed out during cleanup (120 s; 3 failed + 1 cancelled file-level result). `red-lease-runtime.log` is retained; it is not a passing acceptance run. The earlier original child probe supplies clean independent RED evidence. Later complete suites have zero cancellations.
- Two supplemental lifecycle tests initially assumed nonempty roots are rejected and required zero PG client listeners. Actual LocalFiles accepts unrelated files; the corrected test uses an existing `.key`. PG-pool installs its own idle error listener on destructive release; final tests check removal of application-owned callbacks instead. Another harness correction observes pool `acquire`, not only `connect`, since the lease can reuse an existing client. All intermediate logs remain.
- This is a per-database, single-host application ownership boundary, not distributed scheduling or a cross-database shared-file-root lock. Operator must not share one file root between different databases.
- If PG is unavailable, loss persistence is best effort and restart recovery is the fallback; no inference retry is enabled. Full-cluster network-partition testing was not added. Already committed tools remain durable; a loss after a committed checkpoint/effect can remain ambiguous by design. Filesystem operations already in progress are not cancellable, but their DB effect transaction is fenced and replacement recovery drains it. An indefinitely blocked external DB lock/read can delay cleanup/startup; no new lock-timeout feature was introduced.
- Provenance rejection is forward-looking: it does not rewrite historical sources or identify model text manually pasted as a user message.
- Actual model quality/semantic prompt-injection resistance, UI/voice, cloud integration and deployment are outside this fix.
- An unrelated untracked `evidence/azure-access/` appeared in final git status during the task; it was neither opened nor changed and is excluded from this fix inventory.
