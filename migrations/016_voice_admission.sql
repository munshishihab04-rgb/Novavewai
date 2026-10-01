-- Durable voice admission handshake: the client idempotency key reserves the
-- session row before the provider call, so a lost acknowledgement can be
-- recovered read-only and replayed without a second provider connection.
-- Completed answers live in the shared idempotency table (same as mutate()).
ALTER TABLE voice_sessions ADD COLUMN request_key text CHECK(request_key ~ '^[A-Za-z0-9_-]{1,100}$');
ALTER TABLE voice_sessions ADD COLUMN request_fingerprint text;
CREATE UNIQUE INDEX voice_request_key ON voice_sessions(owner_id,request_key);
