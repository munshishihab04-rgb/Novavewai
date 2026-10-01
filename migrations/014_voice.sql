ALTER TABLE messages ADD COLUMN channel text NOT NULL DEFAULT 'text' CHECK(channel IN ('text','voice'));
ALTER TABLE messages ADD COLUMN provenance text NOT NULL DEFAULT 'user_submitted' CHECK(provenance IN ('user_submitted','provider_transcribed_audio','agent_generated'));
-- Existing immutable messages remain unchanged: role is still authoritative for authorship.
CREATE TABLE voice_sessions (
 id uuid PRIMARY KEY, owner_id uuid NOT NULL, conversation_id uuid NOT NULL, session_hash text NOT NULL,
 status text NOT NULL CHECK(status IN ('connecting','active','stopped','failed')), expires_at timestamptz NOT NULL,
 error_code text, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(owner_id,id), FOREIGN KEY(owner_id,conversation_id) REFERENCES conversations(owner_id,id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX one_active_voice ON voice_sessions(owner_id) WHERE status IN ('connecting','active');
CREATE TRIGGER active_owner BEFORE INSERT OR UPDATE ON voice_sessions FOR EACH ROW EXECUTE FUNCTION active_owner_write();
CREATE TABLE voice_inputs (
 id uuid PRIMARY KEY, owner_id uuid NOT NULL, voice_session_id uuid NOT NULL, provider_item_id text NOT NULL,
 text text NOT NULL CHECK(octet_length(text) BETWEEN 1 AND 16384), run_id uuid,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(voice_session_id,provider_item_id),
 FOREIGN KEY(owner_id,voice_session_id) REFERENCES voice_sessions(owner_id,id) ON DELETE CASCADE
);
CREATE TRIGGER active_owner BEFORE INSERT OR UPDATE ON voice_inputs FOR EACH ROW EXECUTE FUNCTION active_owner_write();
ALTER TABLE agent_runs ADD COLUMN voice_session_id uuid REFERENCES voice_sessions(id) ON DELETE CASCADE;
