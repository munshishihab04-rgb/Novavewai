# J0 conversational prerequisites — bounded contract

New independent repository only. No legacy code/secrets, providers, UI, voice, OCR, PDF, execution or deployment. Preserve migrations 001–005 and all existing foundation semantics.

## Vertical acceptance

1. Append-only user text messages, authenticated owner + conversation FK, server IDs, optimistic `baseSequence`, durable idempotency/outbox, bounded keyset pagination and restart readback. No caller impersonation of assistant/tool.
2. Immutable Source snapshots from an owned message (later an owned ready UTF-8 file), immutable Evidence linking exact artifact revision and claim/field. Same conversation enforced. Literal excerpts checked; evidence says `user_supplied` / `literal_excerpt`, NEVER externally verified. Territory/time scope is owner-declared, not certified. Conflicting evidence is additive; no automatic propagation to another revision.
3. Real **local encrypted development adapter**, not S3/cloud: server UUID blob names, private directory and fresh locally generated persisted 256-bit key, AES-256-GCM + owner/file AAD, plaintext SHA-256 integrity, exclusive writes. Accept only `text/plain` canonical base64 encoding of strictly decoded UTF-8, 16 KiB decoded cap, no binary controls/PDF signatures, no client paths; sanitized `.txt` display names only. Owner quota 16 files / 128 KiB including pending reservations. No transformation/execution.
4. Upload durable pending reservation → owner-locked I/O → authenticated final ready commit. A failed/ambiguous boundary is never claimed ready. Startup recovery conservatively deletes pending blobs/reservations, never promotes them. Owner purge commits tombstone/revocation and durable opaque blob cleanup jobs atomically; cleanup removes physical bytes before success. Failed cleanup is retried on startup, not hidden. Late upload must recheck owner/session after lock and I/O; cannot resurrect a purged owner.

## API shape / limits

`POST/GET /conversations/:id/messages`; POST `{baseSequence,text}`, GET `?after=<sequence>&limit=<1..50>` (default 20). Immutable sequence.
`POST /sources`; `{conversationId,messageId}` (or `fileId` once implemented). Server snapshots content/hash and labels provenance.
`POST /evidence`; `{sourceId,artifactId,revision,targetKind:field|claim,target,excerpt,territory,validFrom,validUntil}`. `field` supports only `/text` and `/language`; `claim` is a bounded caller-declared label, not a truth evaluation. Exact revision GET `/artifacts/:id/revisions/:revision/evidence`.
`POST /files`; `{conversationId,name,mime:"text/plain",dataBase64}`; owner-authenticated `GET /files/:id` metadata and `/content` attachment. Optional adapter must be explicitly configured; unavailable is 503, never a fake store. Metadata/references in owner export include `binaryIncluded:false` and separate download requirement.

## Consistency / threat boundary

Every new protected read/write takes owner lock and revalidates exact token with DB wall clock, including after filesystem awaits. Immutable DB entities use owner-active and immutable triggers; composite FKs forbid foreign-owner linkage. API supplied ownership, verification state, paths and unsupported fields rejected. Idempotency fingerprints payload; append conflict is 409. Local process/DB operator and malicious same-UID filesystem mutation remain trusted; reject unsafe roots/symlinks rather than claiming host compromise resistance. No key backup/rotation or production secret manager. No distributed storage writers. Purge does not erase external backups. Retention scheduler and production quotas/rate limits remain separate.

Evidence must include observed per-vertical RED before code, real HTTP + PostgreSQL + private filesystem, restart, cross-owner/cross-conversation rejection, pagination, malformed/oversize/corrupt files, DB/blob failures and purge race. Preserve audit/typecheck/full tests, stop own processes, no commit; independent review follows.
