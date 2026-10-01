# Fix scope and lifecycle study

Baseline and original review copied before running tests; SHA-256 manifest preserves src, scripts/config, migrations, tests and review history. Original review probes were run unmodified first: 9 tests / 5 pass / four expected failures. Their generated JSON was captured separately and original historical files restored byte-for-byte.

Root causes: fileRoutes registers recovery onReady before agentRoutes acquires singleton; the engine checks a session before canonical writer waits but never after receipt/final state writes; sources predates assistant roles and projects all messages as user_supplied; dedicated lease client lacks error/end handling.

Implementation choices:
- Reject non-user message sources (no new generated-origin vocabulary or migrations needed for provenance).
- Final agent transaction validation must be authorization/runtime-only: the current transaction intentionally changes task/run status, context hash, sequence and revision. Reusing the initial full context/running-state fence at the end would reject legitimate completion or compare against obsolete context.
- Singleton ownership must precede file initialization/recovery, including non-agent file mode. Partial startup must relinquish the dedicated client even if later initialization fails.
- Lease invalidation is irreversible for an app instance. Abort jobs synchronously and reject future inference/turns; healthy DB records unknown only for that runtime's own active run IDs, respecting cancel/purge/replacement. Replacement startup and old effect transactions need a transaction-level handover barrier, not only an error listener. No distributed scheduling expansion.

All tests use ephemeral PostgreSQL and loopback controlled HTTP providers; no cloud or credential discovery. Prior foundation tests and original review test source remain immutable.
