# Private connected trial

User approved the design and temporary Cloudflare exposure. This slice connects real chat + text artifacts, not the entire master-spec product.

## Working
- Approved responsive visual direction, private one-use invite exchange, HttpOnly Secure SameSite cookie.
- Azure gpt-5.4-mini through VM managed identity; tokens remain server-side and refresh in memory.
- Conversations, tool-created text artifacts, edit with revision CAS, history, text download, browser print/PDF, owner data export.
- UTF-8 .txt uploads only, 16 KiB limit. No voice, PDF ingestion, web search, external actions, purpose-built structured CV templates, or localized interface yet. Capability notices are explicit.
- Durable private PostgreSQL directory and encrypted file store under ~/.local/share/nova-community-trial. No old-product service touched.

## Verified
- Full suite: 108 tests, 108 pass, zero skipped/cancelled; typecheck pass.
- Browser through actual public Cloudflare URL: invite consumed, URL fragment cleared, real model creates canonical artifact, edit saved as v2, reload restores it, mobile Studio works with no horizontal overflow.
- Application + PostgreSQL restart followed by same browser session restores v2; downloaded text verified.
- Held preview response cannot hide/overwrite an editor opened after it; editor frozen during save, navigation blocked during save.
- Public anonymous workspace HTTP401. Web tests cover CSRF rejection, cross-owner denial, expired/replayed invite, logout revocation and secure cookie flags.
- Sources use textContent for model/user output; CSP excludes inline script/eval and external connections; no bearer credential in public assets.

## Runtime
- Public base: https://loving-say-than-seemed.trycloudflare.com
- User services: nova-community-trial.service and nova-community-tunnel.service.
- Loopback app 4187, PostgreSQL 55439. Cloudflare exposes only app 4187.
- Tunnel lifetime 24h from 2026-09-25 13:56:17 UTC, deadline 2026-09-26 13:56:17 UTC (15:56:17 Italy).
- One-use invitation expires separately; browser session lasts at most 24h. Invite URL excluded from evidence. Account-less Quick Tunnel has no uptime guarantee and hostname may change on restart. Polling is used, not SSE.
- Cloudflared 2026.9.3 binary SHA256 verified against GitHub release asset digest: 77e26d8d900e0b8469f416239d14b5f296525fdf79fee6f511ef55609e3fbac2.

## Incidents and limits
Initial launch needed creation of the separate file root. Browser harness string-eval polling was blocked by CSP and changed to locator assertions, not weaker CSP. A real preview/editor response race surfaced in live testing and was fenced. Synthetic cleanup initially hit immutable revision/tombstone guards, transactions rolled back; corrected owner-tombstone-first cleanup verified separately. Historical review/fix reports were not overwritten.

This is a usable private initial trial, not full A–K completion or production release. No voice, automatic professional CV PDF engine or broad file parsing is claimed. User data survives tunnel expiry locally. Keep the invitation private and use synthetic/non-sensitive data during this trial.
