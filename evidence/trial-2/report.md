# Trial 2 — connected capabilities

## Delivered on temporary public trial
- Realtime voice via Azure WebRTC (`gpt-realtime-2.1-mini`), Italian/Bengali/English selector, separate non-mutating session, max three minutes, explicit stop/visibility cleanup.
- Live web search via Azure Responses `web_search_preview`, official-source preference, citations, source links, timestamp, no arbitrary URL fetch/form submission. Also available as an agent tool with exact owner/session revalidation before and after external await.
- PDF text-layer upload/extraction: signature validation, strict parser, encrypted/scanned rejection, 4 MiB / 30 page / 15.5 KiB extracted-text bounds, two-worker and 15-second process bounds. Extracted text enters existing encrypted owner-bound file storage as untrusted user data.
- Professional text-artifact PDF export bound to exact saved revision, classic/modern styles, selectable Unicode text, page footer, safe markup escaping. Browser text download and version history remain.
- CV generation is model + canonical artifact, with policy requiring no invented facts and section hierarchy. The exported fixture visually renders cleanly and preserves text, but sparse source data correctly yields a sparse CV rather than fabricated filler.

## Verification
- Final suite: 112/112 pass; typecheck, JS syntax, whitespace checks pass.
- Public Cloudflare browser: WebRTC channel connected, inbound audio bytes/packets observed, session closed and browser resources released; web search returned official INPS citation; PDF uploaded, extracted, read by real gpt-5.4-mini, canonical CV artifact created, professional PDF downloaded; no page errors.
- Synthetic audio input was injected into a real realtime session and produced audio replies without provider errors, but semantic responses were inconsistent; no claim of input-transcription quality. A real human phone/microphone test remains outstanding.
- PDF fixture/export roundtrip: one page, selectable text contains Amina Test, Gestione inventario, Italiano B2. Rendered-page visual review found no clipping/render defects and clear hierarchy; content completeness remains dependent on user-confirmed facts.
- Agent search: schema rejects injected URL options; session-revocation-during-search test commits no receipt/message. Direct Azure search proves web search executed and source cited.
- Public readback hashes match local app.js/features.js/style.css. Anonymous workspace remains HTTP 401. Synthetic smoke owners/conversations removed; real owner untouched.

## Scope and limits
- PDFs: text-layer only. Scanned/image-only PDFs explicitly rejected; OCR is not enabled. Input PDF bytes are not retained as original; only bounded extracted UTF-8 text is stored.
- Voice: separate helper conversation; it cannot mutate/save/search. It is not yet a unified voice agent or durable transcript. No human phone pronunciation/naturalness test.
- Search: query + cited answer only; no autonomous browsing, clicking, downloading, forms, government transactions or email.
- CV: high-quality rendering for confirmed text; not a full structured Europass-style data engine, ATS certification, template marketplace or DOCX export. The model cannot fill missing facts.
- Other master-spec items remain: OCR and broad office formats, actions/approvals with real destinations, reminders/monitoring, verified source ledger in UI, full localization, accessibility audit, native/share integrations, production identity/hosting/backups/observability. This trial is broader and usable, not “everything missing completed.”

## Runtime
Public base remains `https://loving-say-than-seemed.trycloudflare.com`; original owner invitation/session remains separate. Temporary Cloudflare tunnel deadline remains 2026-09-26 13:56:17 UTC. Account-less Quick Tunnel has no uptime guarantee. Local owner data persists beyond tunnel expiry.
