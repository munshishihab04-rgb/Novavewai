# NOVA Community Agent

An autonomous, honest assistant for the Bengali community in Italy — CV, documents, letters, job search with sources, study — in **Italian, বাংলা, Banglish and English**, by chat and voice. Founded in Bologna by Shihab Rahman (2026); AI owned by the community and independent of any single provider.

**Status (2026-10-01):** private/public trial live on an Azure VM. 273 tests green (`npm test`), `tsc --noEmit` clean. Every feature slice has evidence in `evidence/<slice>/REPORT.md` with live proofs and explicit limits.

## What a user can do today
- **Talk in any of the four languages, even mixed**; Nova replies in the language the user chose (interface / chat / voice set independently; first-visit onboarding asks the language first). Explicit in-conversation requests ("rispondi in inglese") override.
- **CV**: structured interview one question at a time, 3 PDF templates (modern / classic / professional), Bengali shaping correct, every edit is a new immutable revision, download receipts.
- **Documents**: create/read PDF, DOCX, XLSX, CSV, ZIP, text; table editor for CSV/XLSX; attachments staged before sending; uploads inspected (no OCR).
- **Job search**: role + city → real listings from **Adzuna (official API)**, **Subito** (on-demand reader under owner policy), and robots-permitted pages with schema.org JobPosting; cards show source, employer/date when published, city vs province, agency vs unknown; "altre offerte" extends the search; nothing invented, original link is the source of truth.
- **Voice**: realtime voice surface with captions, language policy shared with chat.
- **Privacy**: per-account isolation, encrypted files, immutable history, temporary chats that self-delete, data export, purge.
- **Mobile**: clean header (☰ · logo · temporary chat), drawer with conversations / settings / account.

## Repository map
| Path | Purpose |
|---|---|
| `src/` | server: `app.ts` (core API, migrations), `web.ts` (UI routes, CSP), `agent.ts` (native agent loop, tools dispatch, language rule), `agent-tools.ts`, `jobs-*.ts` (discovery, Adzuna, Subito, JSON-LD, grounding), `cv-*.ts`, `office.ts`, `documents.ts` (python worker bridge), `language.ts` (i18n + reply-language policy), `voice*.ts`, `identity.ts` |
| `public/` | single-page UI (vanilla JS, textContent-only rendering): `app.js`, `dashboard.js`, `features.js`, `i18n.js` (**generated** by `scripts/build-i18n.ts`), `dark.css`, fonts |
| `scripts/` | `trial.ts` (production entry), `document-worker.py` + `cv_layouts.py` + `office_formats.py` (sandboxed renderer), live smokes (`*-live-smoke.ts`, `public-access-smoke.ts`), invite tools, `nova-public-url.sh` |
| `migrations/` | 001–020, additive, applied at start |
| `tests/` | node:test + Playwright; temp PostgreSQL per test; controlled provider (no network) |
| `deploy/` | `setup.sh` (idempotent server setup), `systemd/` unit templates |
| `docs/` | `DEPLOYMENT.md` (runbook), `API.md`, `AGENT-CORE.md`, `decisions/` (governance decisions with dates), job-discovery spec, Foundry services contract |
| `evidence/` | per-slice reports, logs, screenshots, SHA256SUMS — the audit trail |
| `assets/fonts/` | Noto Sans Bengali (OFL) |

## Run locally
```bash
npm ci && PLAYWRIGHT_BROWSERS_PATH=$PWD/.playwright npx playwright install chromium
python3 -m venv .venv-docs && uv pip install --python .venv-docs/bin/python -r requirements-docs.txt
npx tsc --noEmit && PLAYWRIGHT_BROWSERS_PATH=$PWD/.playwright npm test      # ~8 min, 273 tests
```
Production start, release procedure, flags and rollback: **`docs/DEPLOYMENT.md`**. Environment reference: `.env.example`.

## Principles that shape the code
- **Honesty over polish**: receipts state what was observed, when, from which source; unknown stays unknown; capabilities list is derived from the tools actually enabled.
- **Provider independence**: Nova-owned data, tools and policy; Azure/Adzuna/Cloudflare are replaceable adapters.
- **User-grounded actions**: a city for job search comes only from the user; the model never invents it; CV facts are stamped by provenance (`raccolto` / `proposto` / `confermato_utente`).
- **Governance as data**: risky choices (e.g. Subito access/pagination) are flags in `trial.env` plus a dated decision record with a revert path — see `docs/decisions/`.
- **TDD + live proof**: no slice is "done" without green suite, a smoke on the public origin, and a report of what is still missing.

## Licence notes for bundled third-party assets
Noto Sans Bengali — SIL OFL 1.1 (`assets/fonts/OFL.txt`). Python deps: reportlab (BSD), uharfbuzz (Apache-2.0), python-docx (MIT), openpyxl (MIT), lxml (BSD), pypdfium2 (Apache-2.0/BSD), pypdf (BSD).
