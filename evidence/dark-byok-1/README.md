# Dark dashboard + BYOK implementation notes

Scope: new Nova Community Agent trial only. Baseline under evidence/dark-byok-1/baseline. No old products touched.

Design direction extracted from user references: black canvas, charcoal rounded groups, horizontal shelves, sparse green accent and a persistent two-level composer. Nova content remains task-first rather than copying reference branding, proprietary artwork or unverified model cards.

Provider contract:
- Nova managed default remains available.
- Microsoft Foundry BYOK accepts only HTTPS Azure AI/OpenAI resource hosts and fixed `/openai/v1/`; no redirects or arbitrary URL paths.
- AWS Bedrock BYOK accepts a constrained region and uses AWS Bedrock API-key bearer authentication on regional Runtime Converse endpoints. AWS model/inference-profile ID is manual because the Runtime API key is not claimed to grant management catalog listing.
- Keys stored encrypted AES-256-GCM with owner+provider AAD; never returned via APIs. The server key is private mode0600. Disconnect removes the ciphertext. Provider portal revocation remains separate.
- Provider/model selection applies to the next run. Running runs persist provider/model/generation and revalidate generation after provider awaits; replacement/disconnect fences late output. No fallback to Nova.
- Voice and web search remain Nova-managed and are disclosed separately.
- Foundry model list reads the provider endpoint, paginates boundedly, deduplicates and labels results catalogued-not-tested. Catalog presence is not access/tool compatibility.

Security tests include endpoint allowlist, owner/provider-bound encryption, Bedrock tool conversion, no key readback, paginated catalog, owner/session boundaries, and key-replacement late-output fence.
