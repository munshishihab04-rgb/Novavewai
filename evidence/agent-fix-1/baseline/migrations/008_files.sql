CREATE TABLE files (
 id uuid PRIMARY KEY, owner_id uuid NOT NULL, conversation_id uuid NOT NULL,
 name text NOT NULL, mime text NOT NULL CHECK(mime='text/plain'), size integer NOT NULL CHECK(size BETWEEN 1 AND 16384),
 hash text NOT NULL CHECK(length(hash)=64), state text NOT NULL CHECK(state IN ('pending','ready')),
 request_key text NOT NULL, fingerprint text NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(owner_id,id), UNIQUE(owner_id,conversation_id,id), UNIQUE(owner_id,request_key),
 FOREIGN KEY(owner_id,conversation_id) REFERENCES conversations(owner_id,id) ON DELETE CASCADE
);
CREATE TRIGGER active_owner BEFORE INSERT OR UPDATE ON files FOR EACH ROW EXECUTE FUNCTION active_owner_write();
CREATE FUNCTION immutable_file() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN
   IF OLD.state='pending' OR EXISTS(SELECT 1 FROM users WHERE id=OLD.owner_id AND status='purged') THEN RETURN OLD; END IF;
 ELSE
   IF OLD.state='pending' AND NEW.state='ready' AND (to_jsonb(NEW)-'state')=(to_jsonb(OLD)-'state') THEN RETURN NEW; END IF;
 END IF;
 RAISE EXCEPTION 'immutable file';
END $$;
CREATE TRIGGER immutable_file BEFORE UPDATE OR DELETE ON files FOR EACH ROW EXECUTE FUNCTION immutable_file();
