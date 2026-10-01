# Foundry services — verified matrix for NOVA bounded document capability

Resource: https://foundryn.services.ai.azure.com (AIServices kind, francecentral; see ../../evidence/foundry-services-1/discovery.json).
Auth used: key from env NOVA_REVIEW_FOUNDRY_KEY (header Ocp-Apim-Subscription-Key), read only inside the probe/adapter process. Never written to files.
Managed identity of this VM: 401 on Content Understanding (missing MultiModalIntelligence/analyzers/read). RBAC NOT changed. Production use therefore needs either the key in the server env or an RBAC grant decided by the owner.

Live smoke run: 2026-09-26, synthetic data only, one operation per service, no retries. Raw sanitized output: ../../evidence/foundry-services-1/live/service-matrix.json, probe-stdout.txt, synthetic.png.

| Service / analyzer | Accessible (catalog/auth) | Actual operation executed | Result | Integrated in NOVA |
|---|---|---|---|---|
| Content Understanding prebuilt-read (OCR) | yes (catalog 200, 88 analyzers) | yes: analyzeBinary 420x140 PNG -> 202 -> polled -> Succeeded (2019 ms, 2 polls) | text exact match, 1 page, 11 words, mean conf 0.94, min 0.58 | adapter ready (src/foundry-documents.ts), NOT wired into agent tools |
| Content Understanding prebuilt-layout | yes | yes: same PNG -> Succeeded (1787 ms) | same text, markdown output; tables not exercised (no table in synthetic image) | adapter ready (allowlisted), NOT wired |
| Content Understanding prebuilt-invoice and other 85 analyzers | catalog only | NOT executed (out of scope; sensitive/id/health analyzers deliberately excluded) | unknown | not integrated, not allowlisted |
| Language — LanguageDetection (/language/:analyze-text 2024-11-01) | yes | yes: 1 Italian sentence -> 200, it, score 1.0 | works | schema proposed only |
| Language — PiiEntityRecognition | yes | yes: 1 English sentence -> 200; masked DateTime + Email (conf 0.8) | works; masking is category detection, not anonymization | schema proposed only |
| Translator text v3.0 (/translator/text/v3.0/translate) | yes | yes: en -> it, 200 | works | schema proposed only |
| Speech | n/a here | not probed (realtime voice already implemented by the voice worker) | — | out of scope |
| Audio/video/image prebuilt analyzers | catalog only | NOT executed | unknown | not integrated |

Key facts from official docs (learn.microsoft.com, checked 2026-09-26):
- REST: POST {endpoint}/contentunderstanding/analyzers/{analyzerId}:analyzeBinary?api-version=2025-11-01 with application/octet-stream body -> 202 + Operation-Location; GET {endpoint}/contentunderstanding/analyzerResults/{operationId}?api-version=2025-11-01 until status Succeeded/Failed.
- Service limits (content-understanding/service-limits): documents pdf/tiff/jpg/png/bmp/heif/heic async <= 200 MB / <= 300 pages, sync <= 10 MB / 5 pages; images min 50x50, max 10k x 10k px; Office formats accepted by the service but NOT forwarded by NOVA (kept local-only/stored). Standard S0: 1,000 pages-or-images per minute, 3,000 operations per minute.
- Prebuilt analyzers reference `prebuilt-analyzer-completion` / `prebuilt-analyzer-embedding` models (catalog entry). No model deployment was created; prebuilt-read/layout executed without any deployment step on this resource.
- Pricing: not numerically verified here (pricing page is JS-rendered; consult https://azure.microsoft.com/pricing/details/content-understanding/ and Language/Translator pricing for the francecentral region). Content Understanding bills per page/image for document analyzers; Language and Translator bill per 1k characters. NOVA caps: 4 MB per document, 60k chars of text retained, 20 polls at 1.5 s.

NOVA adapter limits (src/foundry-documents.ts): fixed endpoint; allowlist prebuilt-read, prebuilt-layout; input bytes only (magic-number check PDF/PNG/JPEG/TIFF) — the model never supplies a URL; Operation-Location must sit under the fixed endpoint or it is not followed; 20 s per request, 20 polls x 1.5 s max; states extracted | unsupported | unavailable | denied(401/403) | throttled(429) | failed | timeout | cancelled; no retries; per-page word count, mean/min confidence, low-confidence word count; result marked executed:false, trust:'user_supplied'.

Not claimed: universal format support, table-extraction quality, handwriting, multi-page throughput, invoice field extraction, anonymization guarantees.
