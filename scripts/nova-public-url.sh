#!/usr/bin/env bash
# NOVA public URL helper.
#   record  -> wait for the quick tunnel to print its URL, verify it answers 200, save it to public-url.json
#   show    -> print the current recorded URL (exit 1 if none / stale)
set -euo pipefail
STATE_DIR="${NOVA_TRIAL_DIR:-$HOME/.local/share/nova-community-trial}"
OUT="$STATE_DIR/public-url.json"
mode="${1:-show}"

current_url() {
  journalctl --user -u nova-community-tunnel --no-pager -o cat --since "-3 min" 2>/dev/null \
    | grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' | tail -1
}

case "$mode" in
  record)
    url=""
    for _ in $(seq 1 40); do
      url="$(current_url || true)"
      if [ -n "$url" ] && curl -s -o /dev/null -m 10 -w '%{http_code}' "$url/" | grep -q '^200$'; then break; fi
      url=""; sleep 3
    done
    if [ -z "$url" ]; then echo "tunnel url not verified" >&2; exit 0; fi   # never fail the unit; next restart retries
    umask 077
    printf '{"url":"%s","recorded_at":"%s","invocation":"%s"}\n' "$url" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${INVOCATION_ID:-}" > "$OUT.tmp" && mv "$OUT.tmp" "$OUT"
    echo "$url"
    ;;
  show)
    [ -f "$OUT" ] || { echo "no url recorded" >&2; exit 1; }
    url="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["url"])' "$OUT")"
    code="$(curl -s -o /dev/null -m 10 -w '%{http_code}' "$url/" || true)"
    [ "$code" = "200" ] || { echo "recorded url $url not answering ($code)" >&2; exit 1; }
    echo "$url"
    ;;
  *) echo "usage: $0 record|show" >&2; exit 2;;
esac
