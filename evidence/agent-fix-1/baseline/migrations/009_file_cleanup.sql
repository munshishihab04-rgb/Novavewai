-- Opaque durable work survives cascades and owner tombstone; no personal metadata.
CREATE TABLE file_cleanup (
 id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
