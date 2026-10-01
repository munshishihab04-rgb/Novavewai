# Independent J1 re-review

**Verdict: NOT APPROVED (`passed=false`).** Three original blockers close; dedicated-lease handling still has one reproducible event-ordering error. This is a bounded regression closure, not a new-feature audit.

## Remaining blocker: R2-LEASE-DELAYED-ERROR

`src/runtime.ts:25` calls `client.release(true)` when `check()` detects the singleton lock has disappeared. `pg-pool` 8.23.0 installs its idle error listener even for destructive release (`node_modules/pg-pool/index.js:384-397`). If the dedicated client's actual termination error arrives after this check-induced release, that listener forwards the error to `pool.emit('error')`. Keeping the Runtime client listener does not consume the event or prevent forwarding. Production `localPool()` has no pool error handler.

A supplemental real PG termination during file-put handover initially failed with an administrator-termination error. Nine isolated subsequent executions and five complete supplemental reruns passed. Those passes did not establish safety. A deterministic scheduler probe then held delivery of the real dedicated-client error/end events, allowed a normal protected HTTP request to detect the missing lock and return 503, and released the pending events. An observing pool handler recorded the escaped error; the otherwise identical no-pool-handler case threw it. Both corrected assertions fail. No implementation was changed.

Commands:

```sh
node --import tsx --test --test-reporter=tap evidence/agent-review-2/delayed-lease-error.test.ts
node --import tsx --test --test-reporter=tap evidence/agent-review-2/delayed-lease-no-listener.test.ts
```

The deterministic probe controls event delivery, not SQL lock results or the emitted PG error. It proves a permitted ordering still fails; it does not prove the initial intermittent failure had this exact ordering. No stale write/double inference is alleged.

## Verified

- Permanent `agent-review-regressions` + `agent-runtime`: **19/19**.
- Byte-identical copies of original corrected-behavior probes: **9/9**.
- Entire `npm test`: **105/105**, zero skipped/cancelled; includes multi-tool canonical revision, question/completion, reopen/replay and SIGKILL + PG/API restart controls.
- `npm run typecheck` and `git diff --check`: exit 0.
- Preserved pre-fix source: original probes reproduce exactly **4 failures / 5 passes**; unchanged receipt/terminal final-write assertions both fail as expected.
- Supplemental startup matrix: agent/non-agent/no-file combinations exclude destructive second startup. File-put drain barrier passes on reruns.
- Session rollback and generated-source rejection verified. Ordinary error/end, unknown persistence during held read, old/new generation fences, cancel/purge and cleanup controls pass. Delayed error after missing-lock invalidation does not.

`execution-results.json` contains exact commands, counts and log hashes, including failures and repeats. Historical evidence was not overwritten. Initial runner metadata omitted counts because Node selected its Unicode spec reporter; `execution-results.json` parses both spec and TAP and is authoritative.

## Source identity and preservation

HEAD: `43e981937cfeadfef5e38c9d40d856bffc6b7c23` (candidate is uncommitted, so HEAD alone is insufficient).

Reviewed source-manifest SHA-256: `313ce8f542b0d2b75105f50575390f815ed479408c6197927c5bae1444890d37`.

Runtime SHA-256: `dba6d9f2f79073f4d08a4c7663a9007e5930fc338d043b2888910350af676e73`.

All candidate hashes match `agent-fix-1/verification.json`. Full per-file hashes and aggregate encoding are in `reviewed-source-manifest.json`. **209 protected files unchanged**, including original history, baseline and implementation/tests. Review writes are confined to this directory; no commit.

## Scope and gate

Private local embedded PostgreSQL and controlled loopback provider only. No real-model/semantic injection evaluation, cloud/metadata/credential access, external products, UI/CV/voice or deployment verification. Database-unavailable persistence is best effort; full network partitions and distributed/cross-database file-root ownership are not covered.

The unchanged gate remains blocked solely by R2-LEASE-DELAYED-ERROR. Do not authorize UI/CV progression on the basis of the green permanent suite while this corrected lifecycle assertion fails.
