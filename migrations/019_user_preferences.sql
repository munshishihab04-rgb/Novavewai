-- Per-user product preferences (language of interface / chat replies / voice replies). Validated server-side.
CREATE TABLE user_preferences (
 owner_id uuid PRIMARY KEY REFERENCES users(id),
 language jsonb NOT NULL DEFAULT '{"ui":"it","chat":"auto","voice":"auto"}',
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER active_owner BEFORE INSERT OR UPDATE ON user_preferences FOR EACH ROW EXECUTE FUNCTION active_owner_write();
