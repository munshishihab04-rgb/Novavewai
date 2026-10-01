# J1 agent-core implementation evidence

## Outcome

Implemented bounded real orchestration, not canned chat: authenticated turn → durable user message/task/run → chat-completions request → schema/policy-checked tools → canonical artifact mutation plus receipt → observed tool result in the next provider request → persisted assistant reply → reopen. Provider responses in these tests are **explicitly controlled protocol fixtures**, not model reasoning. Actual model inference is **NOT VERIFIED**.

Latest verification: **86 tests passed, 0 failed/cancelled/skipped**, including all 48 previously accepted tests unchanged and 38 new agent/config/restart tests. `npm run typecheck`, `npm audit --json`, and `git diff --check` passed. No commit. Independent review remains pending.

## Commands and evidence

Working directory: `/home/azureuser/nova-community-agent`.

| Command / cycle | Evidence | Observed |
|---|---|---|
| `npx tsx --test tests/agent.test.ts` before engine | `01-red-engine.log` | 404 instead of 201 |
| Local `tsx --test tests/agent.test.ts` after engine | `03-green-engine.log` | initial vertical passed |
| Export contract RED / implemented export / expanded suite | `04-red-export.log`, `05-expanded.log` | missing agent export failed, then 21 passed |
| `tsx --test --test-name-pattern='pluggable provider' tests/agent.test.ts` | `06-red-pluggable.log`, `07-green-pluggable.log` | unvalidated adapter failed; revalidation/deadline passed |
| `tsx --test tests/agent-config.test.ts` | `08-red-config.log`, `09-config-restart.log` | missing env loader failed; env/restart passed |
| `tsx --test --test-name-pattern='server-wide' tests/agent.test.ts` | `10-red-capacity.log`, `11-expanded-green.log` | missing global bound failed; bounded capacity passed |
| `tsx --test --test-name-pattern='stop with malformed' tests/agent.test.ts` | `19-red-malformed-stop.log`, `20-final-tests.log` | malformed tool_calls object accepted before fix, rejected after |
| `npm test` | **`20-final-tests.log`** | **86/86 passed** |
| `npm run typecheck` | **`21-final-typecheck.log`** | exit 0 |
| `npm audit --json` | `14-npm-audit.json` | exit 0, no reported vulnerabilities |
| `git diff --check` | **`22-final-diff-check.log`** | exit 0 |

Intermediate failing implementation runs/typecheck diagnostics are retained, not overwritten as successes. The broad defensive matrices extend the initial end-to-end RED/GREEN; their tests mostly passed on first execution and are not claimed as individual pre-code RED cycles. The initial `npx` invocation triggered incomplete package threat-intelligence lookup (deadline exhausted), not a malicious-package finding; subsequent commands used the already installed pinned local binary. No dependency/package changes were necessary.

## Exercised acceptance

- Actual HTTP sockets, real private PG17 clusters and encrypted local file store, no Fastify inject or in-memory DB substitute.
- Four provider turns with list → create revision 1 → update revision 2 → complete; tool outputs appear in subsequent provider inputs, actual canonical revision/hash readback, assistant authorship persisted and reopened.
- Question pauses task; fresh authenticated user answer with explicit task ID resumes it, reads authorized uploaded UTF-8 file and completes. User endpoints reject assistant/tool role injection.
- Same owner-wide idempotency key returns original run reference while running, after failure and after restart, with no repeat inference/tool mutation. One active run per conversation; at most four globally. One agent runtime per DB.
- Tool allowlist and closed schema reject approval/prototype/owner injection, malformed arguments and cross-conversation artifact/file access. No grants, sends, SQL/code/path/URL tools added.
- Invalid JSON, empty content, malformed stop calls, refusal, truncation, oversized body, HTTP errors and redirects fail closed. Uncooperative injected provider cannot indefinitely block orchestration; injected output also revalidated.
- Model-call/tool-call/context/concurrency budgets. Oversized tool-result context rolls back its artifact and receipt together. Repeated tool call ID cannot repeat a canonical mutation.
- Held real provider response while HTTP cancellation/purge/message/task/revision changes and exact initiating session revoke/expiry proceed; no owner lock spans model await and no late product mutation/assistant resurrection.
- Real file decrypt followed by controlled await: cancel/purge/revoke blocks receipt and subsequent inference. Fault hook wraps real store read, not invented bytes.
- Real subprocess SIGKILL after persisted `inference_in_flight`, then PostgreSQL and API restart: unknown outcome remains explicit, key replay makes no provider request, fresh explicit turn resumes task and calls provider. Separate durable queued/running fixture recovery verifies failed/unknown with `inferenceResumed:false`.
- Provider failure after a committed tool retains the canonical revision and receipt; reopening/replay does not repeat it. Real PostgreSQL receipt-insert trigger failure rolls back artifact/revision/receipt atomically.
- Persisted event pagination matches DB count with no duplicate IDs; owner isolation and export role/agent projections exclude prompt checkpoints/session hashes. Existing purge cascades new tables.

`verification.json` records exact modified-source hashes, parsed test totals, and byte-for-byte preservation of every old tracked test and migration. Migrations 001–011 are unchanged; migration 012 is additive. Test harnesses stop/remove their own DB/process/filesystem resources in finally blocks.

## Files

New: `docs/AGENT-CORE.md`; `migrations/012_agent_core.sql`; `src/agent.ts`, `src/agent-provider.ts`, `src/agent-tools.ts`, `src/artifacts.ts`; `tests/agent.test.ts`, `tests/agent-config.test.ts`, `tests/agent-restart.test.ts`, `tests/agent-child.ts`; this evidence directory.

Modified: `src/app.ts` integrates agent and shared canonical artifact writers; `src/context.ts` projects actual persisted role; `src/privacy.ts` exports safe agent data; `scripts/config.ts` validates NEW-project provider env; `scripts/server.ts` enables it when configured. No previous tests/migrations, lockfile, package manifest, UI or old project files modified.

## Missing access and limits

- Parent reports the user authorized only an existing Azure Foundry model resource; its credential-access probe was blocked by tool approval timeout. No provider secret is available here. No credential discovery, metadata lookup, old-project inspection, vault search or cloud alternative was attempted. Parent owns authorization/access next. Neither generic HTTPS adapter compatibility nor controlled fixtures prove acceptance against that Foundry deployment/model.
- Runtime provider env: `NOVA_AGENT_ENDPOINT`, `NOVA_AGENT_MODEL`, `NOVA_AGENT_API_KEY`, all-or-none, HTTPS only; unset means agent unavailable. Credentials are not printed. HTTP loopback is only explicit test construction, not a production env option. Query-bearing endpoints are intentionally unsupported; an Azure endpoint requiring API-version query or different auth/protocol will need an independently tested adapter change after access is approved.
- Finite local monolith scope, not distributed scheduling, consumer UI, voice, browser, research, PDF, deployment or real external-effect approval. No automatic inference retries or unknown-outcome reconciliation. Fresh user turn is an explicit new attempt, not resumed unknown inference.
- Context covers latest 20 messages and current task artifact inventory; initial prompt does not silently ingest every full artifact/file. Provider must request allowed reads. Context beyond byte/item ceilings fails closed. Terminal tasks are not reopened automatically. Plain final text ends a run without claiming task completion.
- DB/session operator and injected provider implementation are trusted code; model output is untrusted. Abort cannot undo a request already received by a provider; revocation/purge cannot retract already disclosed prompt data. Persisted checkpoints/receipts contain user content in PostgreSQL and are not protected by file-store encryption. No provider-side retention/deletion guarantee.
- Local filesystem/DB outages have no distributed availability guarantee; DB failure while recording a terminal error can leave a running checkpoint until restart recovery. No provider await holds an owner lock. Filesystem calls retain the existing local adapter's lack of a guaranteed OS I/O deadline.
- No chain-of-thought stored/exposed. Generated assistant claims are not automatically fact-verified; tool/event receipts are the authoritative evidence of actual local effects. All provenance remains unverified.
- Independent adversarial review is the next gate; this implementer report is not production/security approval.
