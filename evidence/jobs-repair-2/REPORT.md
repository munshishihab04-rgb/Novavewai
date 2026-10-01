# Jobs repair 2 — truthful discovery-link contract (local candidate only)

Date: 2026-09-30 UTC. **Not deployed; not production-ready; no working vacancy established.** Only this repository was changed. No service restart, public-asset edit, external API/provider/page request, credential access, source activation, application submission or other-product action. Native tests use disposable PostgreSQL and loopback HTTP with controlled providers, not the running private trial.

## Root cause and correction

`jobs-repair-1` mapped every citation to an Opportunity with `opportunity_kind: VACANCY` and the requested city as its factual `city`. Marking those records UNVERIFIED did not correct the false kind/location. The four historical citations are index/search pages; their mapping also recommended the already-closed InfoJobs Italia.

- `src/jobs.ts`: citation-only fallback now returns `status: search_links_only` and separate `searchLinks`, each `kind: BROWSING_SUGGESTION`, title, URL, discovery timestamp and `observedLocation: null`. It emits neither `jobs` nor `opportunities`, and never assigns `opportunity_kind`, even when the URL looks like a specific ad. Specific-page evidence verification is not implemented by this fallback, so **no citations are promoted**.
- The requested city is `requestedCity`, not `city` on a link or result. It is explicitly a search constraint, not observed location. Existing primary-adapter city semantics are unchanged and remain outside this repair.
- Exclude `infojobs.it` and its subdomains (case-insensitive, trailing-dot normalized for comparison) based on `evidence/jobs-sources-1/report.md` and `docs/job-discovery/INTEGRATION.md`. This is not a new live availability check or a general approved-source registry.
- Shared `requiresDirectEmployer` recognizes the existing restrictions plus `senza intermediari`, `solo datori diretti`, and `direct employers only`. Native dispatch carries the conversation-grounded constraint into the fallback. Restrictive results explicitly report `noAgencies: true`, `constraintStatus: unmet`, and a notice that no direct employer is confirmed. Search links remain browsing suggestions; UNKNOWN cannot enter fallback opportunities because that path creates none. Primary service UNKNOWN filtering uses the same helper.
- Preserve the source-cause/cooldown fix without changing its storage or budget logic. Native fallback retains `sourceUnavailable.code`, `limitReason`, retry delay and original-search URL. One discovery call and repeat-call suppression remain intact.
- `src/agent.ts` changes are confined to jobs import/dispatch. No broader orchestration, verification, discovery, UI or source adapter expansion.

## TDD and exact verification

Failing tests were run and read before the corresponding behavioral fixes:

1. `red-search-links.txt`: expected zero opportunities, got two (generic index and detail-shaped citation).
2. `red-closed-source.txt`: expected three retained historical links, got four.
3. `red-native-constraint.txt`: native persisted receipt omitted `noAgencies` for explicit `senza agenzie`.

Corresponding green logs are retained. Original repair-1 tests expected the old misleading contract; their before bytes and explicit adaptation diffs are retained, not silently treated as unchanged tests.

Final commands:

```sh
TMPDIR="$PWD/evidence/jobs-repair-2/tmp" PLAYWRIGHT_BROWSERS_PATH="$PWD/.playwright" \
  node --import tsx --test --test-concurrency=1 tests/jobs-*.test.ts
npm run typecheck
TMPDIR="$PWD/evidence/jobs-repair-2/tmp" node --import tsx evidence/jobs-repair-2/replay.ts
sha256sum -c evidence/jobs-repair-2/historical-SHA256SUMS
```

- **26 tests passed, 0 failed**, all `tests/jobs-*.test.ts`; `targeted-tests-final.txt`, parsed `test-summary.json`. Not the whole repository test suite. The earlier 24-test run is also preserved.
- **Typecheck passed**, `typecheck-final.txt`.
- Native controlled-provider test covers five direct-only phrases, persisted exact receipt fields, canonical role/city query, one source and one web call per run; the existing native repair test verifies repeated same-run calls are suppressed.
- Unit tests cover zero opportunity/job output, requested/observed location separation, InfoJobs root/subdomains, citation bound, fragment dedupe, and existing unsafe local-URL exclusion. These are not comprehensive SSRF/security tests.
- Real local Chromium executes the unchanged `public/app.js` receipt renderer against a new search-link receipt: **zero cards and zero anchors**. This confirms there is no opportunity-card rendering, not a delivered browsing-link UI. The receipt/model contract supplies the suggestions; no live-model response wording or complete public UI integration was tested.
- Existing jobs tests cover primary cache/strict publisher behavior, throttle source cause (one attempt, `jobs_policy_unreviewed`, separate `jobs_rate_limited`, 15 seconds), native revocation/cancellation, source deny-by-default, parsing, progressive fixture behavior and original listing rendering. Passing old progressive tests does not resolve independently documented defects.
- Offline replay of the exact historical four citations returns **three browsing suggestions, zero opportunities, zero jobs**; `historical-replay.json` is explicitly an offline replay, not a fresh search. The timestamp belongs to historical discovery, not fresh verification.
- Recorded historical hashes verified unchanged. Old evidence was not overwritten. Final source/test hashes are in `SHA256SUMS`.

## Remaining blockers / honest delivery boundary

The private trial still runs its previous code: no restart was authorized here. Primary source remains unavailable/deny-by-default. No specific listing was fetched, verified, or shown to be current; no confirmed direct-employer vacancy exists from this repair.

Independent review blockers remain: S1 asset-budget handling, S2 browser redirect boundary, I1 stale/negated/unsupported city resolution, I3 generic web-search bypass, P1–P4 progressive verification/merge/filter/schema issues, safe discovered-domain transport and source policy/reuse review. I2 is narrowed for the five tested affirmative phrases, **not fully resolved**: history flattening, constraint withdrawal/correction, exhaustive language coverage and task-scoped preference provenance remain open. This patch does not claim a security fix, full MVP-1, verified jobs or production readiness.

## Files and reusable regression procedure

Modified source: `src/jobs.ts`, `src/agent.ts` only. Adapted tests: `tests/jobs-web-fallback.test.ts`, `tests/jobs-agent-repair.test.ts`. New tests: `tests/jobs-search-links.test.ts`, `tests/jobs-agent-search-links.test.ts`. New evidence lives only in `evidence/jobs-repair-2/` (before snapshots, red/green/final logs, diffs, replay, checksums and report).

For future citation adapters: replay historical URLs without network I/O; assert the result kind before inspecting its verification badge; assert requested and observed locations independently; test the actual persisted native receipt with a model that omits the user's constraint; only then exercise the renderer. Preserve original evidence and adaptation diffs. This procedure is recorded here rather than writing a skill outside the delegated repository boundary.
