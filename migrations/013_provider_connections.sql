ALTER TABLE agent_runs ADD COLUMN provider_binding jsonb;
CREATE TABLE provider_connections (
 owner_id uuid NOT NULL REFERENCES users(id), provider text NOT NULL CHECK(provider IN ('foundry','aws')),
 endpoint text NOT NULL, secret_cipher text NOT NULL, generation uuid NOT NULL, updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(owner_id,provider)
);
CREATE TABLE provider_preferences (
 owner_id uuid PRIMARY KEY REFERENCES users(id), provider text NOT NULL CHECK(provider IN ('nova','foundry','aws')),
 model text NOT NULL, updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER active_owner BEFORE INSERT OR UPDATE ON provider_connections FOR EACH ROW EXECUTE FUNCTION active_owner_write();
CREATE TRIGGER active_owner BEFORE INSERT OR UPDATE ON provider_preferences FOR EACH ROW EXECUTE FUNCTION active_owner_write();
