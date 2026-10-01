# Jobs live delivery 1

Date: 2026-09-30 UTC. Candidate only; not deployed or restarted.

## Result

The bounded live investigation did **not establish a current specific cameriere vacancy in Bologna**. Two managed searches produced two specific candidate URLs. Reading the originals found one explicitly expired Adecco vacancy and one Lavoropiù page whose current body no longer contains the advertised role/location. They are retained as dated unavailable evidence and are not promoted to vacancies. Generic search indexes remain leads only. Detailed observations are in `LIVE-PAGES.md`.

## Integration delivered

- `src/jobs-live.ts`: fixed-origin adapter for only `www.adecco.com` and `www.lavoropiu.it`; HTTPS, no credentials/ports, redirect error, max six leads and 1 MB body. It requires role and city in the original listing body, detects expired pages, classifies agency evidence, attaches page URL/timestamp/evidence, and excludes every non-confirmed-direct publisher under no-agencies.
- `src/agent.ts`: current-turn city correction and unsupported-city preservation replace conversation flattening/model-city trust. Explicit no-agencies withdrawal is handled. The existing single jobs search fallback now verifies allowlisted specific pages and emits opportunities only when body evidence passes. Session/cancel fences remain around calls and persistence.
- `tests/jobs-live.test.ts`: adapter and current-city/no-agencies correction coverage.
- No cache seed, scheduler, static vacancy, source bypass, contact extraction, application, service restart, or deployment was added. Public assets were not changed.

## Verification

- `tests/jobs-*.test.ts`: **28 passed, 0 failed** (`targeted-tests.txt`).
- `npm run typecheck`: passed (`typecheck.txt`).
- Actual adapter replay against the four search-2 citations: `opportunities=0`; Adecco unavailable from Node transport and Lavoropiù body mismatch (`live-adapter-result.json`). Browser evidence gives the stronger Adecco status: explicitly expired.
- Search usage: 2/2 permitted short queries. Browser pages: 8/8 bounded public pages, counting two specific pages, Indeed, Bakeca, two Restworld routes, Job in Tourism, and the specific-page revisit/session navigation. No denied page retried to bypass access.

## Honest boundary / blocker

The requested product outcome—present current Bologna cameriere offers—cannot truthfully be claimed from this bounded run. The available specific leads were stale/expired and the other sources were indexes, blocked, or 404. The code is a safe narrow integration path but has no current real vacancy to return today; it therefore remains a review candidate, not a universal jobs dataset or production-ready feature. Parent should not deploy as “working Bologna offers” until a current original listing passes the adapter or another reviewed fixed source is added.
