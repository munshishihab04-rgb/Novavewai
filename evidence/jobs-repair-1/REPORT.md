# Jobs repair 1 — candidate fix evidence

Date: 2026-09-30 UTC. Scope: Nova Community Agent jobs files plus the narrow native-agent jobs dispatch. No deploy, restart, commit, application/contact action, subscription, resource creation, access bypass, budget increase, or old-product change.

## Production trace and reproduction

A read-only query used the existing trial database secret and selected only sanitized receipt fields for `occupation=cameriere`, `city=Bologna`; it did not select message text, user IDs, tokens, checkpoints, or unrelated receipts. `native-receipts-sanitized.json` shows three recent receipts: `jobs_policy_unreviewed` at 17:09:03Z, the same at 17:09:28Z, then `jobs_rate_limited` at 17:09:37Z. This confirms the local 15-second throttle masked the real unavailable source state on a later attempt.

The regression was written and run red before implementation. `red-throttle.txt` records expected `jobs_policy_unreviewed` but actual `jobs_rate_limited` on immediate retry.

## Candidate fix

- `src/jobs.ts`: persist source attempt outcome with the existing budget write, preserve that cause during the 15-second cooldown, and report `limitReason=jobs_rate_limited` plus exact `retryAfterSeconds`. Unavailable results are `retryable:false` and include the fixed original Subito search URL. A failed real source attempt still consumes one of the unchanged daily 40-attempt budget; retries do not consume another attempt.
- `src/jobs.ts`: map at most six HTTPS public search citations to explicitly `UNVERIFIED` candidate opportunities. Reject credentials, ports, localhost/private/link-local IPv4 and local hosts. These are leads, never represented as retrieved/working jobs.
- `src/agent.ts`: when the jobs source is unavailable and existing `searchWeb` is configured, make exactly one bounded role+city candidate-discovery query. Preserve the source failure separately in `sourceUnavailable`. Suppress repeat jobs calls for the same role/city within the run (`jobs_retry_suppressed`) rather than allowing model blind retries.
- `src/jobs-subito.ts` remains deny-by-default; the unsafe adapter was not enabled or changed.

## Verification

- TypeScript: `npm run typecheck` passed.
- Targeted suite: 21 passed, 0 failed (`targeted-tests.txt`). Includes native agent receipt integration, fallback count, repeated-call suppression, source-cause/cooldown distinction, candidate URL filtering, existing city/cache/privacy/browser/progressive/UI/session-fence tests.
- One authorized bounded live `searchWeb` query: `cameriere Bologna offerte lavoro`; one query, first six citations considered, four candidates retained at 2026-09-30T17:13:25.746Z (`bounded-live-candidates.json`). They are marked UNVERIFIED. No candidate page was fetched and no listing is claimed current/working.
- SHA-256 values are in `SHA256SUMS`.

## Exact unchanged/new limits

Existing: source min interval 15,000 ms; daily source attempts 40; source timeout 25 s; native jobs timeout 30 s; model calls max 8; tool calls max 16. New fallback: one web query per unavailable jobs attempt/run key; at most six returned citations considered; no candidate-page fetches. Repeated same role/city jobs calls in one run make zero additional source/web calls.

## Independent blockers checked / still open

- S1 blocked assets exhaust request budget: unresolved; adapter remains disabled.
- S2 redirect boundary gap: unresolved; adapter remains disabled.
- I1 stale/negated/unsupported city handling: unresolved.
- I2 strict direct-only phrase coverage: unresolved.
- I3 generic `web_search` bypass for job intent: unresolved outside this targeted fallback path.
- P1–P4 progressive verification/merge/filter/schema findings: unresolved; fallback does not use that orchestrator or claim verification.
- Source policy review and observed Subito robots/access state remain unresolved. The actual primary source result is therefore unavailable, not successful.
- Four live search citations prove bounded candidate discovery works, not that any job is reachable, current, direct-employer, or verified. No safe working vacancy was established in this scope.

Release remains blocked pending parent review of these limitations; no public assets required staging because the receipt renderer already supports generic opportunities and no served file changed.
