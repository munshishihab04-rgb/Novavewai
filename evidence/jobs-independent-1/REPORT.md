# Independent jobs review + official-source feasibility

Reviewed 2026-09-26 UTC. **Verdict: do not activate the current Subito adapter unchanged.** The bounded native foundation is useful, and all 18 existing jobs tests pass, but independent reproductions found native intent bugs, a browser redirect boundary gap, and progressive discovery correctness gaps. Full MVP-1 remains incomplete. No implementation/deploy/restart/paid-provider request was made.

## Verified scope

Read the original 798-line specification, INTEGRATION.md, jobs-search-1/REPORT.md and jobs-sources-1/report.md; reviewed jobs*.ts, jobs tool schema, native dispatch and searchWeb interface. Existing tests run individually/sequentially across seven jobs test files: **18 passed, 0 failed**, including temporary PostgreSQL session-revocation/cancel tests and local Chromium parsing/rendering. Not the full suite. `targeted-tests.txt` is the execution log. `reviewed-source-hashes.json` identifies the inspected source snapshot; shared source can change concurrently.

Additional executable review probes (all controlled fixtures except public-probe.py):

```sh
node --import tsx evidence/jobs-independent-1/reproduce.ts
TMPDIR="$PWD/evidence/jobs-independent-1/tmp" node --import tsx evidence/jobs-independent-1/native-reproduce.ts
PLAYWRIGHT_BROWSERS_PATH="$PWD/.playwright" TMPDIR="$PWD/evidence/jobs-independent-1/tmp" node --import tsx evidence/jobs-independent-1/browser-reproduce.ts
node --import tsx evidence/jobs-independent-1/search-interface.ts
```

All completed successfully, asserting the current bad behavior, not claiming safety acceptance. JSON outputs are saved beside each probe. No real provider, production DB, IMDS, credentials or application submissions were used. Existing jobs tests ran with TMPDIR inside this evidence directory. Test databases were cleaned; a tsx compilation cache remains there.

## Findings requiring bounded fixes

### S2 — High: Playwright route allowlist does not fence redirect targets

`src/jobs-subito.ts:53–64`: `route.continue()` delegates redirects to Chromium. The handler is not re-invoked for every redirect target. The post-navigation URL/status check occurs **after** target I/O. The robots navigation also lacks a final-URL equality check. Consequently the asserted exact URL/origin network boundary is not enforced for redirects.

Reproduction: local HTTP `/start` redirects to non-allowlisted `/not-allowlisted`; allowlisting only `/start` records one route callback, but the forbidden target receives one request. `browser-reproductions.json`, S2. This demonstrates the browser behavior, **not** a known Subito open redirect or successful exploitation against production.

Fix: move public-document fetching through a controlled transport with `redirect: manual/error`, validate each allowed hop before I/O, or fulfill browser document routes with safely fetched bodies (`route.fetch({maxRedirects:0})` only as a fixed-origin step, not as the full discovered-site SSRF defense). For arbitrary discovered hosts require DNS/IP pinning and network egress policy too. Do not rely on final page URL or browser route callbacks to prevent redirect SSRF.

### S1 — Medium: blocked assets exhaust the document request budget

`src/jobs-subito.ts:55–56`: requests increment before resource filtering, and `denied=true` after three attempts is later fatal. A robots document + HTML containing four images gives requests=6 and `jobs_request_budget`, despite images being intentionally blocked. Real sites usually contain assets; JavaScript disabled does not disable HTML images/styles.

Reproduction uses the same routing conditions in real Chromium, controlled inline HTML. `browser-reproductions.json`, S1. This is not live Subito parser evidence.

Fix: discard non-document resources before consuming the permitted-navigation counter; separately cap all attempted traffic if desired without interpreting ordinary blocked assets as a failed jobs search. Test the complete navigation/route boundary, not only `page.setContent` parser input.

### I1 — High relevance/integrity: history flattening overrides explicit current city

`src/agent.ts:148–154` joins up to 20 conversation-wide user turns, ignores `call.args.city`, and asks `jobIntent` for one supported city across all text. `src/jobs.ts:17` does not model negation, recency or unsupported places.

Native API + temporary PostgreSQL reproduction (`native-reproductions.json`):
- Earlier Bologna, then “Ora cerca a Milano invece di Bologna” → `needs_city`, zero search calls, even though correction is explicit.
- Earlier Bologna, then “Ora cerco cameriere a Parma” → searches **Bologna**. Unsupported current city is silently replaced by stale supported city.
- Pure intent probe: “Cerco cameriere, non a Milano” selects Milano.

Fix: retain owner/task-scoped structured intent with message/sequence provenance. Resolve current explicit affirmative city first; use pending-task city only for a continuation with no replacement. A requested unsupported city must yield unsupported_city, not fall back to history. Validate proposed tool city against that state. Avoid merely selecting the first/last known-city regex match.

### I2 — Medium: explicit direct-only constraints are missed

`src/agent.ts:153`, `src/jobs.ts:43`: differing small regexes are the only server constraint preservation. Native input “Dishwasher in Milano, direct employers only”, model query “dishwasher” → downstream query contains no strict restriction. Pure service probes return an UNKNOWN job for “senza intermediari”, “solo datori diretti” and “direct employers only”; “senza agenzie” correctly returns zero.

Fix: one structured `noAgencies` field grounded in user turn/state, applied after cache lookup and before output slicing; recognize explicit correction/withdrawal rather than permanently inheriting any old restrictive substring. Add IT/EN natural-language cases and city-only continuation. Current tests cover only the exact Italian phrase.

### I3 — Medium policy boundary: generic search bypass is only a prompt instruction

`src/agent.ts:156–159` exposes generic web_search without the jobs city/source guard. Controlled native provider, user “Cerco lavoro come lavapiatti” (no city), tool query “lavapiatti Milano” → generic search executes. `native-reproductions.json`, I3. No actual paid search was performed.

This does not prove the real model chooses the bypass; it proves the server cannot uphold the report's city-before-any-search guarantee. Fix by routing job-intent external discovery through one server-owned jobs orchestration policy/state. Preserve generic web research for non-job requests. Legitimate alternative-source discovery belongs inside that policy, not a prompt-only escape from source denial.

## Progressive extension: blockers before wiring live providers

`src/jobs-discovery.ts` is currently unwired. These findings are integration gates, not demonstrated production exploits. `reproductions.json` reproduces all four:

- **P1 (24,33–35):** three UNVERIFIED vacancies count as enough, so an available verifier is never called. Separate sufficient candidate discovery from sufficient verified evidence; always verify selected candidates when claiming verified results, with bounded budget.
- **P2 (29,34):** verify receives six candidates, then `replace=true` deletes all rows. Eight compatible companies become six even with identity verifier. Merge verification patches by stable candidate identity; preserve untouched rows and provenance, including empty/partial verifier responses.
- **P3 (23,36–38):** slice(0,12) occurs before strict publisher filtering. Twelve UNKNOWN entries hide a DIRECT_EMPLOYER at index 12 and return zero. Filter/rank then limit; count exclusions from the actual examined candidate pool.
- **P4 (27–29):** only array size is validated. A row with `javascript:` source_url, VERIFIED, null last_verified_at and empty evidence is returned unchanged. Runtime schemas must bound strings/bytes/enums/timestamps and URLs, and require evidence for official identity, vacancy role/location and verification status. TypeScript types do not validate provider output. Current Subito UI has a separate strict URL filter, so this is not a demonstrated UI XSS.

Semantic cross-source dedupe/official evidence preference remains absent as the implementer correctly disclosed. Do not merge jobs just because employer/title match: preserve requisition ID, place, contract/role distinctions and alternate sources.

## Live public official-source feasibility — real retrieval, not fixtures

`live-robots.json` records initial policy fetches. `live-pages.json` records bounded GET statuses, timestamps, compact excerpts and discovered links. No browser/terminal anti-bot workaround, login, form post or contact harvesting. Named official domains were checked directly; these were **reviewer-selected seeds**, not output of a live web-search call.

### Miscusi: viable narrow first adapter candidate

- `https://miscusi.com/robots.txt` returned 200 with disallows for admin/api/auth/login and `_rsc` URLs; ordinary pages used here are not disallowed. This is not a content-reuse license.
- Homepage returned 200 and actually links `/lavora-con-noi` (no guessed Careers path).
- `https://miscusi.com/lavora-con-noi` returned 200, role/city cards and a link to the employer jobs subdomain. It explicitly offers “Candidatura spontanea”.
- `https://jobs.miscusi.com/robots.txt` returned 200; `/admin`, `/api/`, `/application/`, `/login` are disallowed; reviewed public vacancy/spontaneous pages are not. Two reads of this policy occurred because the first probe omitted plain-text retention; no denial was retried.
- **Actual official linked vacancy:** `https://jobs.miscusi.com/camerierae-di-sala-e-brigata-di-cucina-milano` returned 200. Title “Cameriera/e di sala e brigata di cucina — Milano | Miscusi”; page contains “Posizione aperta” and Milano. Evidence supports a broad sala/cucina vacancy, **not a specifically advertised lavapiatti job** and not guaranteed continued availability or authenticity certification.
- **Actual official spontaneous channel:** `https://jobs.miscusi.com/candidatura-spontanea` returned 200, “Non trovi la posizione giusta? Scrivici lo stesso” and restaurant/office choices. This supports explicit spontaneous applications, not a specific city vacancy. No form opened/submitted beyond reading public page HTML.
- `/ristoranti` returned 200 but server HTML showed zero loaded regions; do not infer no locations or complete coverage. Careers gives a usable Milano example without that dynamic endpoint.

Thus the public official-page path is concretely feasible without a search provider/browser for a reviewed seed. This is **not approval for scheduled crawling/reuse**; source-policy/terms assessment and explicit activation are still needed.

### Eataly: company/Careers feasible, vacancy retrieval unresolved

- robots returned 200; inspected paths not disallowed.
- Official homepage → actual `/it_it/lavora-con-noi` link → actual `/it_it/lavora-con-noi/posizioni-aperte` link; all returned 200. Header/footer link Milano Smeraldo and Bologna stores.
- Posizioni page server HTML contains introduction but no concrete vacancy evidence. It cannot be labelled no vacancies or verified hiring. A bounded permitted browser/embedded official ATS investigation is a later step, not done here.
- Homepage reached the 1,000,000-byte read cap; marked truncated. Legal-notes page was reachable but this bounded extraction did not establish an automated-use license.

### UNA: malformed robots outcome

`https://www.gruppouna.it/robots.txt` returned 200 **HTML “Pagina non trovata”**, not a valid robots file. Stopped this source; no policy allowance or company-vacancy completeness is inferred from status 200.

### Subito: exactly what is and is not established

Implementer evidence records one **robots.txt HTTP403**, followed by no job-page fetch. That proves that policy fetch failed on that attempt and explains their fail-closed adapter status. It does **not** prove all public listing/detail URLs are blocked, nor that denial is permanent. Parent context separately reports an earlier browser read of public list/detail pages; that establishes historical reachability only, not continuous access or automation/reuse permission. This review made no new Subito request and did not circumvent its denial. Keep separate fields for policy_unknown/access_blocked at a particular URL, retrieval time, and source-level adapter disabled state.

## Precise implementable adapter recommendation

### 1. Reuse searchWeb as candidate discovery, not job truth

Existing signature is `searchWeb(query:string, signal:AbortSignal) -> {text,sources:[{title,url}],checkedAt,kind:'web_search'}`. It uses managed identity then Azure Responses, model `gpt-5.4-mini`, `web_search_preview`, required tool choice and store:false. `scripts/trial.ts:24` already injects it as generic `search`. **Do not invoke it under this no-charge review.** `search-interface.ts/json` exercised the exact interface with all fetches replaced; no IMDS/Azure network calls. It also proves HTTPS-only citation filtering accepts `https://127.0.0.1/private`: citations are untrusted candidate URLs, not SSRF-safe verified sources.

Proposed `createJobsDiscovery({searchWeb, publicPages, sourcePolicies, cache, budget})`, injected through `AgentOptions.jobsSearch`. Keep all native pre/post I/O run/session fences. Do not bypass via generic web_search. First validate/resolve structured city+role+constraints. Build bounded public-only queries from canonical occupation/category/city, never full user text/CV/name. Suggested maximum two search calls: role+city job sources, then sector+city official businesses if needed. These future calls require separately authorized provider spending. For no-spend mode use curated reviewed seeds only and explicitly label its limited coverage, not “live web search”.

Treat citations as candidate records `{url,title,discoveredAt,discoveryQueryKey}`. Search prose is a lead, never a VERIFIED job record. Reject non-HTTPS/credentials/nonstandard port/local or metadata IP targets; strip fragments for identity, preserve meaningful query/requisition IDs. Discover Careers by observed anchors. Verify off-domain ATS ownership via the outbound official-site link and retain that link as evidence.

### 2. A safe public-page transport before broader domain discovery

- Source-policy registry per origin: allowed purpose/paths, review reference, reviewedAt, robots outcome and expiry. HTTP200 is not permission; block/unknown stays explicit. Never auto-enable because a nonempty env var exists.
- HTTPS GET only, no cookies/auth/forms/downloads/scripts, DNS resolve all A/AAAA then reject private/loopback/link-local/reserved/mapped addresses; connect to the validated pinned IP with original TLS name, revalidate manual redirects, enforce external egress denial for private networks. Ordinary preflight DNS + unpinned fetch is insufficient against rebinding.
- Bound two discovery queries, six candidates to verify, twelve public page fetches total including policy documents, at most three origins, one concurrent request, 1MB decoded body/page, 10s/page and 30s overall. Cache policy documents separately; reduce useful pages when policy consumes the budget rather than silently exceed it. No retry on denial/CAPTCHA. Return partial evidence plus bounded-stop reason.
- Prefer static HTML first (Miscusi proves why); one isolated browser fallback only if policy permits and remaining budget allows. Route browser I/O through the same transport/egress rules. Do not inherit the existing redirect flaw.

### 3. Structured extraction + honest matching

Return separate candidate/company/opportunity records; extend Opportunity with company identity, category, officialWebsite, official-link evidence, observed role/location and optional employment data. A generic official Contacts page is only company evidence. Explicit spontaneous acceptance is a separate kind. VERIFIED vacancy needs official/linked-ATS body evidence, role+place, exact source URL and last_verified_at. General kitchen vacancy must not become exact lavapiatti. Unknown location stays unknown; footer store names are not vacancy locations.

Apply no-agencies after retrieval using proven publisher identity, not domain popularity or a badge. Keep partial company matches separate from jobs. Merge evidence by stable identity and prefer official source while retaining portals. Fix P1–P4 before attaching providers.

### 4. Integration and finite acceptance

Current `Job.source='Subito'` and `compactJobs` only support Subito; do not route official pages through them or mislabel them Subito. Extend the result contract around `opportunities`, preserve existing jobs compatibility temporarily. Parent should update receipt rendering to all three explicit kinds and safe original-source links; current card renderer only reads `result.jobs`. New cache keys include schema/source/role/city and only public metadata; owner search preferences remain outside shared cache. Leave scheduler disabled until separately approved.

Finite next gate: S1/S2 + I1/I2/I3 + P1–P4 regression assertions; controlled native continuation/correction/constraint tests; deny private and redirect targets before I/O; one permitted real Miscusi official vacancy + spontaneous-channel observation with timestamps; one unavailable/dynamic source status; zero applications/contacts copied; then parent decides deployment. Full MVP-1 additionally requires live candidate search/company discovery and cross-source matching, not just this seed adapter. No infinite new general-review loop is required.

## Ownership / remaining blockers

Only `evidence/jobs-independent-1/` was created/modified. No source/shared files, public assets, skills, service configuration, deployment or old products changed. Reusable probe workflow is documented here rather than writing skills outside the delegated ownership boundary. Outstanding: narrow fixes, source-policy/reuse review, actual search-provider authorization/live test, safe discovered-domain transport, opportunity renderer integration and parent restart approval. The current evidence supports a useful implementation plan and real official-page reachability, not delivered live job discovery.
