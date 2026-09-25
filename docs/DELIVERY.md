# NOVA Community Agent — delivery ledger

## Authority and boundary

The user approved the A–K architecture and autonomous implementation. Request intervention only for genuinely missing access, new consequential costs or blocking scope decisions. No repetitive approval per engineering phase.

Canonical planning material: `/home/azureuser/nova-community-agent-spec-v2/`.

This repository is a NEW product. Do not inspect, import, migrate or deploy the old NOVA, Nexus or LicenzPol. No inherited secrets, users, datasets, production service units, design approvals or verification claims.

## Runtime decision ADR-001

Use TypeScript, Fastify and the PostgreSQL wire protocol (`pg`). During local development, a pinned embedded-postgres package starts a genuine PostgreSQL process bound to loopback, under this user's permissions, with an isolated data directory and random credentials. It is NOT an in-memory replacement for PostgreSQL, nor a recommendation to deploy an embedded dev cluster to production.

System discovery found Node 26.8.2 and npm 11.19.1, but no Docker or PostgreSQL installation. Therefore no global package/service changes are needed for the first tests. Production runtime and database deployment remain a separate gate. Test on an explicitly chosen supported deployment runtime before release; current local tests alone establish only local runtime behavior.

Dependencies must remain pinned in package-lock.json. `npm audit` is a dependency check, not a proof of supply-chain safety. Initial package intelligence lookup timed out for some sources; preserve this limitation rather than reporting complete supply-chain vetting.

## Current work boundary

J0 first vertical: authenticated HTTP operation → durable Task → canonical Artifact revision → revision-bound read/export → process/database restart and resume → side-effect policy/receipts → owner isolation and purge.

External effects in foundation tests are SYNTHETIC ADAPTERS. There is no authorized live email/candidature/booking send. A JSON revision export is not a PDF renderer. Developer-provisioned opaque sessions are not completed consumer onboarding/authentication.

## Foundation completion requirements

- Test-first RED/GREEN evidence for new behavior.
- Actual PostgreSQL transactions, constraints and concurrent requests.
- Actual HTTP listener smoke, not Fastify inject alone.
- Sessions hashed at rest; no raw token/secret in tracked evidence.
- Closed request schemas and owner-scoped access.
- Revision conflicts reject rather than silently overwrite.
- Approval bound to exact account/recipient/payload/revision and expiry.
- Idempotency and replay protection persisted before side effect.
- Ambiguous outcomes remain unknown until reconciled; no blind resend.
- Outbox event and mutation committed together; lease fencing for stale workers.
- Purge revokes sessions and prevents queued writes from recreating owner data.
- Restart/reopen reads canonical state, not an in-process cache.
- Independent security review after implementer tests; parent reruns relevant tests.

Passing this subset is NOT completion of full J0. The conversational continuation now implements messages, exact-revision Source/Evidence and an encrypted local development file lifecycle (docs/NEXT-FOUNDATION.md; evidence/context-foundation/report.md). Cloud object storage, retention scheduling, onboarding and production backup/key-management gates remain unimplemented.

## Ordered continuation

1. J0 complete outstanding foundation boundaries, not merely tables.
2. J1 implement real conversational orchestration with a provider adapter and bounded tools. No canned replies sold as an agent.
3. J2 canonical Artifact and contextual Studio in a mobile-first shell.
4. J3 CV end-to-end: natural conversation, correction, preview, template, exact PDF and reopen.
5. J4 real voice ↔ text continuity, provider and device audio tests.
6. J5 document/OCR/translation/checklist with extraction coverage and provenance.
7. J6 permitted multi-source research/jobs, dedup and source evidence.
8. J7 visible recurring tasks/reminders/notifications and disable/revoke.
9. J8 application package preparation.
10. J9 individually verified external connectors with explicit action approval.

Keep the complete master-spec matrix alongside these narrow slices. Do not replace the requested product with an endlessly polished CV database, nor call a broad UI demo the completed agent.

## Reporting

Only verified milestones; distinguish implementation, local controlled tests, real provider tests and public production. No invented percentages, deployment, memory, sources, verification or capability claims.
