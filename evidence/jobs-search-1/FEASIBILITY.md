# Feasibility / gap gate against expanded Job Discovery Engine specification

Read all 798 lines of the user-supplied specification before continuing. Scope: this repository only; no restarts, deployment, applications, CV matching or radar.

The original bounded Subito vertical is NOT the full MVP-1. It supplies native job search, canonical role/city intent, shared metadata cache, bounded browser adapter and transparent source failure. Progressive discovery must be provider-neutral: cache/search/API first; local compatible-company discovery and discovered official websites next; bounded browser verification only where needed and permitted. Browser adapters are replaceable fallbacks, not the architecture core.

Required classification contract: opportunity_kind = VACANCY / SPONTANEOUS_APPLICATION / COMPATIBLE_COMPANY; hosting source_type separated from publisher_type. Unknown publishers never become DIRECT_EMPLOYER from Privato/Azienda verificata labels. Strict no-agencies means only independently supported direct-employer results; unknowns are excluded, with exclusion counts. Compatible-company results never claim hiring. Spontaneous applications require an observed official channel, not guessed URLs, and no submission.

Feasible extension boundaries: injected search/discovery/verification providers, explicit evidence URLs + timestamps/status, conservative URL/evidence identity deduplication, hard progressive stage budgets. Existing general web_search can discover candidates but does not establish official-company identity or hiring. A grounded structured extraction/verification adapter is needed before live company discovery can be claimed implemented.

Current source-access blocker: one public curl GET https://www.subito.it/robots.txt returned HTTP 403 Access Denied. No job pages were fetched as a workaround. Permission is not inferred from browser reachability. Production adapter is disabled unless a policy/permission review reference is explicitly configured and still checks robots/access controls. Parent owns broader source/terms research.

Open full MVP-1 gaps: approved alternative search sources and ingestion adapters; verified company identity/official-domain evidence; real Careers navigation/status verification; cross-source entity matching; result UI classification, provider/live acceptance tests. Interface + fixture verification is not real-source verification. No full-MVP completion claim is authorized by passing bounded tests.
