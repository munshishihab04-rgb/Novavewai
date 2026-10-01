# Lease lifecycle correction

## Result

The specific R2 delayed-error regression is fixed in the local candidate. This is an implementation verification report, not a claim that a separate independent reviewer was run for this patch.

- Production delta: only `src/runtime.ts`.
- Added permanent regression: `tests/agent-lease-order.test.ts`.
- Before patch, the regression failed on escaped pool error `57P01` (`red.log`).
- After patch, runtime + new regression: 12 tests pass (`green-runtime.log`).
- Byte-identical copies of original reviewer probes, delayed-error/no-listener probes and supplemental matrix: 16/16 pass (`original-probes.log`).
- Full suite: 106/106 pass, no cancelled or skipped tests.
- Typecheck and whitespace check: exit 0.

## Correction

End the dedicated lease connection while it is still checked out. Keep its Runtime error handler until the terminal client `end` event. Only then call `release(true)` to remove the ended client from the pool. This prevents pg-pool's idle error listener from being installed while real lease error events are still queued. No global pool errors are suppressed, no private pg-pool internals are changed, and the shared barrier and exact-session transaction fences are unchanged.

Existing permanent tests verify failed initialization cleanup, end-only invalidation, backend termination, unknown persistence with held reads, replacement draining, cancelled/purged runs and preservation of the successor lease. Positive multi-tool and process/PG restart controls are included in the full suite.

## Preservation and scope

All prior review/fix reports and existing tests remain byte-identical. The only changed existing protected file is `src/runtime.ts`; the new test and this evidence directory are additions. No commit, deploy, old-product changes or credential discovery. No new external inference was required for this deterministic DB lifecycle correction. Foundry's prior successful smoke remains a separate access check, not model-quality acceptance.

Source SHA-256: `037772750b19e658b8983a2acabc37da43148b2c3f01743111abdda6cd6170d5` (`src/runtime.ts`). Detailed commands/hashes: `verification.json`; actual production delta: `runtime.diff`.

The reproduced code blocker no longer fails its unchanged assertions. UI/CV work is a subsequent slice, not implemented or deployed by this correction. Full-cluster network partitions, distributed/cross-database file roots and real-model semantic reliability remain outside this local engine test scope.
