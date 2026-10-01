#!/usr/bin/env bash
# NOVA Community Agent — one-shot server setup (idempotent). Tested shape: Ubuntu VM, non-root user, no sudo needed.
# What it does: checks node/uv, installs npm deps + Chromium for Playwright, creates the Python worker venv,
# creates the data dir, installs the systemd --user units, and (optionally) starts the service.
# It never writes secrets: you create/complete trial.env yourself from .env.example.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
DATA="${NOVA_TRIAL_DIR:-$HOME/.local/share/nova-community-trial}"
step(){ printf '\n\033[1;32m▶ %s\033[0m\n' "$*"; }

step "1/7 Toolchain"
command -v node >/dev/null || { echo "node >=22 required (production uses v26, e.g. via https://github.com/nvm-sh/nvm or a tarball into ~/.local/bin)"; exit 1; }
node -e 'const [m]=process.versions.node.split(".");if(+m<22){console.error("node >=22 required, found "+process.version);process.exit(1)}'
command -v uv >/dev/null || { echo "uv required for the Python venv (curl -LsSf https://astral.sh/uv/install.sh | sh)"; exit 1; }
command -v python3 >/dev/null || { echo "python3 required"; exit 1; }

step "2/7 Node dependencies + Chromium (Playwright) into $REPO/.playwright"
cd "$REPO"; npm ci
PLAYWRIGHT_BROWSERS_PATH="$REPO/.playwright" npx playwright install chromium

step "3/7 Python worker venv (.venv-docs) — PDF/DOCX/XLSX rendering, Bengali shaping"
[ -d .venv-docs ] || python3 -m venv .venv-docs
uv pip install --python .venv-docs/bin/python -r requirements-docs.txt
fc-list 2>/dev/null | grep -qi dejavu || echo "WARN: DejaVu fonts not found (apt install fonts-dejavu-core) — Latin PDF rendering needs them"

step "4/7 Data directory $DATA (DB, encrypted files, secrets) — mode 700"
mkdir -p "$DATA"; chmod 700 "$DATA"
if [ ! -f "$DATA/trial.env" ]; then cp .env.example "$DATA/trial.env"; chmod 600 "$DATA/trial.env"; echo "Created $DATA/trial.env from .env.example — EDIT IT (Adzuna keys, flags) before starting."; fi

step "5/7 systemd --user units"
mkdir -p "$HOME/.config/systemd/user"
cp deploy/systemd/nova-community-trial.service "$HOME/.config/systemd/user/"
if command -v "$HOME/.local/bin/cloudflared-nova-trial" >/dev/null 2>&1 || [ -x "$HOME/.local/bin/cloudflared-nova-trial" ]; then
  cp deploy/systemd/nova-community-tunnel.service "$HOME/.config/systemd/user/"
else
  echo "NOTE: tunnel unit not installed — no $HOME/.local/bin/cloudflared-nova-trial. See docs/DEPLOYMENT.md §Public exposure (optional)."
fi
chmod +x scripts/nova-public-url.sh
systemctl --user daemon-reload
loginctl enable-linger "$USER" 2>/dev/null || echo "NOTE: run 'sudo loginctl enable-linger $USER' once so the service survives logout."

step "6/7 Verification suite (optional, ~8 min). Skip with NOVA_SKIP_TESTS=1"
if [ -z "${NOVA_SKIP_TESTS:-}" ]; then npx tsc --noEmit && PLAYWRIGHT_BROWSERS_PATH="$REPO/.playwright" npm test; fi

step "7/7 Start"
if [ -n "${NOVA_START:-}" ]; then
  systemctl --user enable --now nova-community-trial
  [ -f "$HOME/.config/systemd/user/nova-community-tunnel.service" ] && systemctl --user enable --now nova-community-tunnel || true
  sleep 6; systemctl --user is-active nova-community-trial
  echo "Local: http://127.0.0.1:4187  (redirects to https on the public origin; use the tunnel URL from: scripts/nova-public-url.sh show)"
else
  echo "Not started (set NOVA_START=1 to start). Manual: systemctl --user enable --now nova-community-trial nova-community-tunnel"
fi
echo "Done. Next: docs/DEPLOYMENT.md §First run (owner bootstrap + invite)."
