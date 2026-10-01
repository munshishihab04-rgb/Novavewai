# NOVA Community Agent — Deployment runbook

Everything below describes the system **as it runs in production on 2026-10-01** (Azure VM, non-root user, systemd `--user`, Cloudflare quick tunnel). No step requires sudo except `loginctl enable-linger` once.

## 1. Architecture at a glance
| Piece | What | Where |
|---|---|---|
| App server | Fastify + native agent loop (`scripts/trial.ts` → `src/app.ts`, `src/web.ts`, `src/agent.ts`) | loopback `127.0.0.1:4187` |
| Database | **embedded PostgreSQL 17** (`embedded-postgres`), scram auth, data dir inside the data directory | `$DATA/db`, port `55439` loopback |
| Files | user uploads/exports, encrypted at rest, immutable (DB triggers) | `$DATA/files` |
| Secrets (auto-generated on first run, mode 600) | `db-secret`, `provider-key` (BYOK encryption key), `owner-id` | `$DATA/` |
| Config | `trial.env` (flags, Adzuna keys) | `$DATA/trial.env` |
| Model | Azure Foundry via **Managed Identity** (IMDS token, no API key on disk) → `gpt-5.4-mini`; BYOK Foundry/AWS per user, encrypted | `src/managed-provider.ts`, `src/provider-registry.ts` |
| Python worker | sandboxed renderer: PDF (reportlab + HarfBuzz Bengali shaping), DOCX, XLSX, CV layouts, extraction | `.venv-docs`, `scripts/document-worker.py` |
| Browser | Chromium (Playwright) for Subito reader + UI tests | `.playwright/` |
| Public exposure | Cloudflare quick tunnel, auto-restart, URL recorded by `scripts/nova-public-url.sh` | `$DATA/public-url.json` |

`$DATA` = `~/.local/share/nova-community-trial` (override with `NOVA_TRIAL_DIR`). **Nothing under `$DATA` is ever committed.**

## 2. Fresh server
```bash
git clone https://github.com/munshishihab04-rgb/Novavewai.git nova-community-agent && cd nova-community-agent
deploy/setup.sh                 # toolchain check, npm ci, Chromium, .venv-docs, data dir, systemd units, full test suite
$EDITOR ~/.local/share/nova-community-trial/trial.env   # Adzuna keys, flags (see .env.example)
NOVA_START=1 NOVA_SKIP_TESTS=1 deploy/setup.sh          # start (or: systemctl --user enable --now nova-community-trial)
```
Prerequisites: Node ≥ 22 (prod: v26 in `~/.local/bin/node`), `uv`, `python3`, DejaVu fonts (`fonts-dejavu-core`). Bengali font (Noto Sans Bengali, OFL) is bundled in `assets/fonts/` and `public/`.

### First run (owner bootstrap + invite)
On first start `scripts/trial.ts` initialises the DB, runs all migrations (`migrations/*.sql`, idempotent via `schema_migrations`), bootstraps the owner account and writes `owner-id`. Then:
```bash
npx tsx scripts/trial-renew-invite.ts        # fresh owner invite link: <origin>/#invite=…  (also writes $DATA/invite-current)
scripts/nova-public-url.sh show              # current public origin
```
Self-service registration (username/password, scrypt) is on when `NOVA_PUBLIC_REGISTRATION=on`.

## 3. Release procedure (code update) — proven, use in this order
```bash
cd ~/nova-community-agent && git pull
npx tsc --noEmit && PLAYWRIGHT_BROWSERS_PATH=$PWD/.playwright npm test          # must be green on the exact bytes you publish
systemctl --user stop nova-community-trial
TS=$(date -u +%Y%m%dT%H%M%SZ); mkdir -p ~/.local/share/nova-trial-backups/$TS
tar -C ~/.local/share -czf ~/.local/share/nova-trial-backups/$TS/nova-community-trial.tgz nova-community-trial   # DB + files + secrets
systemctl --user daemon-reload && systemctl --user start nova-community-trial nova-community-tunnel
sleep 6 && systemctl --user is-active nova-community-trial nova-community-tunnel
U=$(scripts/nova-public-url.sh show | tail -1); curl -s -o /dev/null -w "%{http_code}\n" $U/
cmp <(curl -s $U/app.js) public/app.js && echo "published bytes verified"
TRIAL_URL=$U npx tsx scripts/public-access-smoke.ts        # register→login→conversation→logout on a throwaway account
TRIAL_URL=$U npx tsx scripts/language-live-smoke.ts        # it→bn and mixed→en replies
TRIAL_URL=$U npx tsx scripts/jobs-live-smoke.ts            # cameriere/Bologna real listings
npx tsx scripts/purge-smoke-accounts.ts                    # marks smoke_* accounts purged (never DELETE users: FKs)
```
Migrations run automatically at start; new ones are additive (018 ephemeral conversations, 019 language preferences, 020 onboarding).
Rollback: stop → extract the backup tgz over `$DATA` → `git checkout <previous>` → start.

## 4. Operations
- Logs: `journalctl --user -u nova-community-trial -f` (no secrets are logged; provider errors are codes).
- Public URL rotates on every tunnel restart: `scripts/nova-public-url.sh show`; re-issue invites against the new origin. A `no_agent` cron (`nova-public-link-watch.sh`) can notify on change.
- Ephemeral ("temporary") conversations are swept hourly (24 h TTL) by the trial process.
- Daily run cap per account: `NOVA_DAILY_RUNS_PER_ACCOUNT`; exemptions `NOVA_UNLIMITED_OWNERS`.
- Health: `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4187/` → `301` (HTTPS redirect) locally, `200` on the public origin.

## 5. Governance flags (data, not code) — `trial.env` + dated decision JSON in `$DATA`
| Flag | Effect | Decision record |
|---|---|---|
| `NOVA_JOBS_SUBITO_AUTOMATED_ACCESS=owner-accepted` | Subito on-demand list reader (1 page) | `subito-policy-decision.json` (2026-09-30) |
| `NOVA_JOBS_SUBITO_PAGINATION=owner-accepted` | up to 3 Subito pages on explicit "altre offerte" — **TEMPORARY**, review 2026-12-01 | `subito-pagination-decision.json` + `docs/decisions/2026-10-01-subito-pagination.md` |
| `NOVA_ADZUNA_APP_ID/KEY` | Adzuna official API source (legitimate path) | `evidence/adzuna/REPORT.md` |
Revert any of them by removing the line and restarting.

## 6. Public exposure (optional)
Production uses a Cloudflare **quick tunnel** (no account, no domain) wrapped by `deploy/systemd/nova-community-tunnel.service`, binary at `~/.local/bin/cloudflared-nova-trial` (download `cloudflared` for linux-amd64 and rename). `ExecStartPost` records the verified URL. For a stable domain, replace with a named tunnel or a reverse proxy; the app only listens on loopback and sets strict CSP/HSTS-style headers itself.

## 7. Evidence & verification culture
Every feature slice has `evidence/<slice>/{REPORT.md,test-full.log,typecheck.log,SHA256SUMS,…}` with what the user can do now, live proofs on the public origin, and an explicit "not implemented / limits" list. Read those before changing a subsystem. Skills/workflow notes used by the maintainers' agent live outside the repo.
