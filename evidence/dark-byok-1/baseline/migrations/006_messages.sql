CREATE TABLE messages (
 id uuid PRIMARY KEY, owner_id uuid NOT NULL, conversation_id uuid NOT NULL,
 sequence integer NOT NULL CHECK(sequence>0), text text NOT NULL CHECK(octet_length(text) BETWEEN 1 AND 16384),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(owner_id,conversation_id,id), UNIQUE(owner_id,conversation_id,sequence),
 FOREIGN KEY(owner_id,conversation_id) REFERENCES conversations(owner_id,id) ON DELETE CASCADE
);
CREATE TRIGGER active_owner BEFORE INSERT OR UPDATE ON messages FOR EACH ROW EXECUTE FUNCTION active_owner_write();
CREATE TRIGGER immutable_message BEFORE UPDATE OR DELETE ON messages FOR EACH ROW EXECUTE FUNCTION immutable_revision();
