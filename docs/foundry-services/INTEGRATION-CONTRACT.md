# Integration contract for the parent (shared files NOT touched by this worker)

Owned and delivered: src/foundry-documents.ts, tests/foundry-documents.test.ts, scripts/foundry-services-probe.ts, docs/foundry-services/, evidence/foundry-services-1/live/.
Untouched: src/agent.ts, src/agent-tools.ts, src/files.ts, src/file-inspection.ts, src/app.ts, public/, package*.json, src/voice.ts, migrations, staged native.js.

## Current interfaces read (for the parent's reference)
- src/file-inspection.ts inspectUpload(name, bytes) -> {executed:false, status:'extracted'|'unsupported', detectedType?, method?, text?, coverage?, pages?, reason?}. PDFs without a text layer and all images currently return status 'unsupported'. This object is stored in files.extraction (src/files.ts line 42/52).
- src/agent.ts read_file (line ~165-179) returns {fileId, text|null, extraction:'unsupported'|'extracted', executed:false, trust:'user_supplied', reason?}.
- src/agent-tools.ts toolSchemas/toolDefinitions use closed() schemas with strict:true; validateTools enforces allowlist + schema; validation for string types defaults maxLength 100 unless set.

## Proposed wiring (parent decides; nothing here is active)
1. Route decision: after inspectUpload returns 'unsupported', call selectDocumentRoute(file) from src/foundry-documents.ts. If route==='foundry-ocr', either (a) run analyzeDocument at upload time and store its result as files.extraction (method 'foundry-content-understanding', with pages evidence), or (b) expose it lazily via the document_ocr tool. Option (b) keeps cloud calls user-visible and bounded per request; option (a) makes read_file work unchanged. Recommendation: (b) first, because the credential is a review key and each call costs money.
2. Tool registration: copy proposedDocumentTools.document_ocr.parameters into toolSchemas and its description into toolDefinitions. The handler must resolve fileId to owner-scoped bytes (same query read_file uses), then call analyzeDocument({analyzerId, bytes, mime}, {signal}) with the run's abort signal. Never pass model-supplied URLs; the adapter rejects them anyway.
3. Receipt shape returned to the model: {fileId, extraction:'extracted'|<state>, text, pages:[{pageNumber,words,meanWordConfidence,minWordConfidence,lowConfidenceWords}], executed:false, trust:'user_supplied', reason?}. Text is untrusted user data; instruct the model to mention low-confidence pages.
4. Credential: the server process needs NOVA_REVIEW_FOUNDRY_KEY (or a purpose-named alias the owner chooses) in its env. Without it the adapter returns status 'unavailable' and makes no network call. Managed identity is NOT sufficient today (401) and RBAC changes are out of scope.
5. Language detect / PII / translate: HTTP shapes proven by the probe (see SERVICE-MATRIX.md and service-matrix.json). Adapters not written yet; schemas in proposedDocumentTools mark verified:'unverified' for the adapter layer. PII masking must be surfaced as best-effort category masking, never as anonymization.
6. Held-out behavior tests to add in the agent suite once wired (not written here, to avoid racing shared tests): model asked to read a .docx must NOT call document_ocr; model asked to read a PNG must call document_ocr with prebuilt-read; model must not call document_ocr when read_file already returned extracted text; model must not claim a document was read after a denied/throttled/timeout state.

## Test and probe commands
- Synthetic suite (no network): node_modules/.bin/tsx --test tests/foundry-documents.test.ts  (10/10 pass)
- Typecheck: node_modules/.bin/tsc --noEmit  (no diagnostics in foundry-documents.ts)
- Live probe (requires key in .hermes/.env or env; makes 5 billable synthetic calls): node_modules/.bin/tsx scripts/foundry-services-probe.ts
