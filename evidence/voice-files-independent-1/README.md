# Independent voice/file acceptance lane

## Scope and safety

Only this evidence directory is owned. No application implementation, public assets, package changes, deployments, commits, live provider calls, or credential lookup. Uses existing embedded PostgreSQL helper against a private cluster, real migrations, `buildApp`, real local encrypted file store and canonical agent writer. Provider completions alone are synthetic. `fetch`, job search and web search are explicitly denied. Test-generated DB/storage files live under `.tmp/` here and are cleaned by fixture teardown. No uploaded/generated code is executed. ZIP inspection uses Python `zipfile` in memory, never filesystem extraction.

## Commands

From `/home/azureuser/nova-community-agent`:

```sh
python3 evidence/voice-files-independent-1/run.py
```

Runner retains actual TAP output in `latest.tap`, counts, exit status and before/after source SHA256 in `latest.json`. Source changes during execution are disclosed rather than treated as stable verification. Node test concurrency is one; individual DB tests have 30s budgets; outer runner has 120s budget.

After generated-format implementation is stable:

```sh
INDEPENDENT_FORMATS_READY=1 python3 evidence/voice-files-independent-1/run.py
```

Once a real voice adapter exists (contract below):

```sh
INDEPENDENT_FORMATS_READY=1 \
INDEPENDENT_VOICE_ADAPTER=/home/azureuser/nova-community-agent/evidence/voice-files-independent-1/voice-adapter.ts \
python3 evidence/voice-files-independent-1/run.py
```

Opt-in tests fail, rather than silently skip, if the required implementation is absent. An ordinary green default run does **not** certify pending gates.

## Executable coverage

- TXT, JS, PHP, Liquid: canonical user turn → real create_file receipt/revision → authenticated download → exact bytes, Unicode/line-ending preservation, assistant-generated provenance, `executed:false`, attachment/sandbox/nosniff/no-store headers, foreign-owner denial, persisted user/assistant history.
- Duplicate canonical input: simultaneous same-key requests, same-key post-commit acknowledgement replay, distinct-key same stale input and foreign-owner replay. Actual run/receipt/artifact counts and provider calls must remain one operation. This is a **text-path baseline**, not proof of voice input identity.
- Fault injection: private PostgreSQL trigger rejects receipt INSERT after artifact mutation begins. Proposed provider prose says “I saved”; assert no artifact/revision/receipt, no success event/outbox artifact event and no persisted assistant claim survives rollback. This proves server persistence behavior, not realtime spoken output.
- Existing upload behavior: foreign conversation upload and metadata/content reads denied; exact TXT bytes retained; opaque unknown upload currently rejected with error and without a stored file/provider interpretation.
- Tool boundary: generic host shell, execute-file and arbitrary code tools denied; path injection rejected. Code fixtures are literal data, not executed.
- Opt-in PDF/ZIP: generate through the real agent, download owner-scoped bytes, verify `%PDF-` and extracted sentinel, verify ZIP magic/CRC/entry list and exact JS/PHP/Liquid/TXT contents with independent Python reader. Reject traversal, absolute/Windows paths, NUL, duplicate names, disguised PDF and multibyte overflow; positive valid-ZIP control prevents reject-all false positives.
- Pending voice adapter tests: duplicate same speech with distinct callback IDs, correct authorship, voice→text continuation and history reopening, before-dispatch owner isolation, replay disclosure protection, and failed voice-file result status. Actual microphone, data-channel ordering and playback remain a separate browser/provider gate.

## Voice adapter contract — pending, no invented endpoint

At inspection, `src/capabilities.ts` exposed only `POST /voice/connect` with `{sdp,language}`. There was no canonical voice-input route or identity schema. Existing `POST /conversations/:id/turns` accepts `{text,baseSequence,taskId?}` and Idempotency-Key. It returns canonical `{id,conversationId,taskId,status}`. Read-only progress is `/runs/:id` and `/runs/:id/events`; history is `/conversations/:id/messages`. Do not mislabel posting directly to the text route as voice adapter acceptance.

Create `voice-adapter.ts` only after inspecting the implemented voice boundary. Exports:

- `register?(app,pool)`: register actual application capability/voice routes if not already in buildApp. No fake handlers.
- `submit(f,input,token)`: call the actual implemented voice route through `f.send`/`f.app.inject`. Input `{text,baseSequence,inputId,callId}`; `f.conversation` is the target. Return `{status,runId,...}` mapped from actual response. Do not manufacture run IDs, receipts, de-duplication or status.
- `outcome(f,submitted,token)`: inspect the actual voice tool result/reconciliation boundary. Return `{status,confirmedSaved}` based on real response fields. Do not hardcode false. Retain raw result for diagnostics. If no separate voice result exists because browser reads canonical runs, explicitly document that mapping and keep browser spoken-success acceptance pending.

Tests currently expect asynchronous acceptance (normalized 201 + canonical run ID). If final implementation returns synchronous receipts, adapt transport mapping/assertions deliberately while preserving acceptance guarantees; do not invent a fake queued operation.

## Unknown upload transparency — baseline and pending expansion

The passing baseline requires an explicit rejection for `.unknown` binary input. It does **not** establish accepted-but-unread support. At initial inspection `/files` accepted only `.txt`, UTF-8, `text/plain`. Once broad uploads land, that baseline should fail rather than quietly accept new metadata.

Required follow-up against the final upload schema:

1. Upload opaque `.unknown` bytes and invalid UTF-8 disguised as `.js` (each bounded to a tiny fixture). If accepted, preserve exact bytes on authenticated download and expose explicit unread/unsupported or extraction-failed metadata. If rejected, require an explicit error and no row/receipt.
2. Ask actual `read_file` through a controlled provider; capture the next provider input. Require unsupported content not returned as decoded/understood `text`, and require explicit unread status/reason. A successful storage receipt is not a successful extraction receipt.
3. Upload a bounded in-memory ZIP with `../outside.txt`, an absolute entry and a nested ZIP. Never extract to disk; require rejection or safe unread/manifest-only behavior, no traversal, no execution.
4. Repeat metadata/download/read_file with another owner and another conversation. Require no content disclosure before or after cached read replay.
5. Upload JS/PHP/Liquid containing throw statements/instructions; exact download does not mean execution or trusted instructions. Inspect tool receipt and resulting prompt as untrusted data.

## Evidence boundaries / unresolved gates

- Generated PDF/ZIP source changed during inspection, so tests were authored but not run against moving implementation.
- Voice route/input identity and unknown-upload metadata contract were unavailable when harness was authored. Pending is not green.
- Initial policy explicitly said separate voice conversation and no saving/tools; existing `tests/voice-language.test.ts` even asserted `cannot save drafts`. That historical test needs conscious migration, not accidental preservation as parity acceptance.
- No real speech, playback, barge-in, browser close/reopen, partial JSON/SSE recovery, permission-revocation race, database/app restart, or live-provider correctness is claimed here.
- `failed operation cannot say saved` is verified only at canonical persistence/events for the controlled commit fault. Whether audio repeats pre-commit or failed-operation prose remains pending the real voice output adapter/browser test.
