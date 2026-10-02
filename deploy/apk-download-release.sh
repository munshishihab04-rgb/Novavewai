#!/usr/bin/env bash
# Deploy apk-download (f744bcd) onto /opt/nova-community/app, preserving the live uncommitted UI changes.
# Strategy: the live dirty tree == commit 330cec4 on branch apk-download (verified by sha256 before anything).
# So: snapshot-commit the live dirty tree on a local branch, fetch, hard-check it equals 330cec4's tree, then checkout f744bcd.
set -euo pipefail
APP=/opt/nova-community/app; DATA=/opt/nova-community/data; BK=/opt/nova-community/backups/apk-download-$(date -u +%Y%m%dT%H%M%SZ)
TARGET=f744bcd5daed
cd "$APP"
echo "== preflight"
[ "$(git rev-parse --short=7 HEAD)" = "542da93" ] || { echo "HEAD is not 542da93"; exit 1; }
EXPECTED="c69eed80eec1772c public/app.js
518a74e1d6f26a2e public/dark.css
340debd4607b2721 public/index.html
2fa33145f14798f0 src/web.ts
373952eeffbbf978 src/language.ts
5e0e4e504245829d public/i18n.js"
ACTUAL=$(sha256sum public/app.js public/dark.css public/index.html src/web.ts src/language.ts public/i18n.js | cut -c1-16,66-)
[ "$ACTUAL" = "$EXPECTED" ] || { echo "live hashes changed since review:"; echo "$ACTUAL"; exit 1; }
echo "== backup -> $BK"
mkdir -p "$BK"; git diff > "$BK/live-dirty.patch"; git status --short > "$BK/git-status.txt"; git rev-parse HEAD > "$BK/head.txt"
tar -czf "$BK/app-src.tgz" --exclude=node_modules --exclude=.playwright --exclude=.venv-docs -C /opt/nova-community app
echo "== fetch"
git fetch -q origin apk-download
git rev-parse --verify -q "$TARGET^{commit}" >/dev/null || { echo "target not fetched"; exit 1; }
echo "== snapshot live dirty tree as local commit (rollback point)"
git stash push -q -m "live-before-apk-download"   # keeps the exact live files recoverable with git stash
git stash apply -q
git -c user.name="live" -c user.email="live@localhost" commit -qam "live snapshot before apk-download (equals 330cec4)"
LIVE=$(git rev-parse HEAD); echo "$LIVE" > "$BK/live-snapshot-commit.txt"
# tree equality with 330cec4 (same content, different author/date is fine)
BASE=$(git rev-parse "$TARGET^")
[ "$(git rev-parse "$LIVE^{tree}")" = "$(git rev-parse "$BASE^{tree}")" ] || { echo "live tree != 330cec4 tree"; git diff --stat "$BASE" "$LIVE"; exit 1; }
echo "== checkout target (branch main stays at live snapshot for rollback: git checkout main)"
git checkout -q -B apk-download "$TARGET"
echo "== data backup + restart"
sudo systemctl stop nova-community
tar -czf "$BK/data.tgz" -C /opt/nova-community data
sudo systemctl start nova-community
for i in $(seq 1 30); do sleep 1; curl -fsS -o /dev/null http://127.0.0.1:4187/nova/ && break; done
echo "== readiness"; curl -s -o /dev/null -w "local / %{http_code}\n" http://127.0.0.1:4187/nova/
echo "HEAD now $(git rev-parse --short HEAD); rollback: cd $APP && sudo systemctl stop nova-community && git checkout -q main && sudo systemctl start nova-community (main = $LIVE live snapshot)"
echo "$BK"
