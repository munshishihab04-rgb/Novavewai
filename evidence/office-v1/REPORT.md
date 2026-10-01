# Office formats v1 (DOCX · XLSX · CSV) — report

Project `/home/azureuser/nova-community-agent` · 2026-10-01 · TDD (RED→GREEN per slice) · suite **238/238**, typecheck ok (`test-full.log`, `typecheck.log`). Local only, not deployed.

## Cosa può fare ora l'utente
- Chiedere a Nova un **file Excel (.xlsx)**, **Word (.docx)** o **CSV**: `create_file` li genera davvero (openpyxl / python-docx nel worker sandbox) e il download ha il MIME corretto, così sul telefono si aprono con l'app giusta.
- **Caricare** un .xlsx o .docx: viene estratto (primo foglio → CSV; paragrafi/tabelle → testo con `#`/`-`) e `read_file` lo legge; Nova può quindi correggerlo o riutilizzarlo.
- **Editor tabellare** nel pannello risultato per CSV e XLSX (creati o rivisti): celle modificabili, «Aggiungi riga/colonna», salvataggio = nuova revisione (CSV canonico), «Scarica <nome>» sempre della revisione aperta. DOCX/PDF/testo usano l'editor testuale esistente.
- Le formule non vengono mai eseguite né create (`=`, `+`, `-`, `@` iniziali rifiutati); macro rifiutate in lettura.

## Implementato
| Area | File |
|---|---|
| CSV codec condiviso (RFC 4180, `;` auto-detect), render/extract via worker | `src/office.ts` |
| Worker: `render-docx`, `render-xlsx`, `extract-office`; cap 2000 righe × 64 colonne × 1000 char, testo 60 KB | `scripts/office_formats.py`, `scripts/document-worker.py` |
| Formati `create_file`: `text|pdf|zip|docx|xlsx`; MIME reali (pdf/docx/xlsx/zip/csv/json/txt; codice resta octet-stream); errori worker → 422 col codice | `src/generated-files.ts` |
| Upload `.docx/.xlsx` → estrazione | `src/file-inspection.ts` |
| Capability oneste (create_file, read_file) + descrizione tool | `src/identity.ts`, `src/agent-tools.ts` |
| UI: `#table` editor, `#tabletools`, download con nome reale e fetch autenticato; selettore PDF/«Scarica PDF» nascosti per file generati | `public/app.js`, `public/index.html`, `public/dark.css` |
| Librerie aggiunte in `.venv-docs` (uv): python-docx 1.2.0 (MIT), openpyxl 3.1.5 (MIT), lxml 6.1.3 (BSD) | — |

## Test
- `tests/office.test.ts` (4): CSV round-trip, XLSX reale riletto da openpyxl, cap righe, formula rifiutata (verificato con mutante), DOCX con stili Title/Heading/List Bullet, extract xlsx/docx, bytes non-office rifiutati.
- `tests/office-agent.test.ts` (2): tool schema/estensioni, capability line; via HTTP reale: creazione xlsx/docx/csv, MIME, bytes `PK`, isolamento owner (404), revisione dall'editor ri-renderizza l'xlsx, workspace espone `file.format`, upload xlsx/docx estratti e letti da `read_file`.
- `tests/office-ui.test.ts` (1, Chromium): tabella da CSV quotato, modifica cella + riga, salvataggio POST con CSV atteso, label/href download che segue la revisione, DOCX resta in editor testuale, niente innerHTML.
- Screenshot desktop/mobile in questa cartella, controllati con vision: nessun overflow della tabella (wrapper `overflow-x:auto`); il clipping del selettore lingua nell'header a 390px è **preesistente** e fuori da questa fetta.

## Non implementato
- Più fogli per xlsx (solo primo foglio in lettura, un foglio in scrittura), stili/formule/grafici, celle unite.
- Immagini e tabelle complesse nel DOCX generato (solo titoli, paragrafi, elenchi); in lettura le tabelle diventano righe `a | b`.
- Editor tabellare per file **caricati** (si legge, non si modifica in-place: Nova può crearne una copia con `create_file`).
- PPTX, ODT/ODS, XLS/DOC legacy.
- Deploy sul trial.
