CREATE TABLE sources (
 id uuid PRIMARY KEY, owner_id uuid NOT NULL, conversation_id uuid NOT NULL, message_id uuid NOT NULL,
 snapshot text NOT NULL, hash text NOT NULL CHECK(length(hash)=64),
 trust text NOT NULL DEFAULT 'user_supplied' CHECK(trust='user_supplied'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(owner_id,id),
 FOREIGN KEY(owner_id,conversation_id,message_id) REFERENCES messages(owner_id,conversation_id,id) ON DELETE CASCADE
);
CREATE TABLE evidence (
 id uuid PRIMARY KEY, owner_id uuid NOT NULL, source_id uuid NOT NULL, artifact_id uuid NOT NULL, revision integer NOT NULL,
 target_kind text NOT NULL CHECK(target_kind IN ('field','claim')), target text NOT NULL,
 excerpt text NOT NULL, territory text NOT NULL, valid_from date NOT NULL, valid_until date NOT NULL CHECK(valid_until>=valid_from),
 verification_method text NOT NULL DEFAULT 'literal_excerpt' CHECK(verification_method='literal_excerpt'),
 status text NOT NULL DEFAULT 'unverified' CHECK(status='unverified'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(owner_id,source_id) REFERENCES sources(owner_id,id) ON DELETE CASCADE,
 FOREIGN KEY(owner_id,artifact_id,revision) REFERENCES artifact_revisions(owner_id,artifact_id,revision) ON DELETE CASCADE,
 CHECK(target_kind<>'field' OR target IN ('/text','/language'))
);
CREATE FUNCTION evidence_boundary() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM sources s JOIN artifacts a ON a.owner_id=s.owner_id JOIN tasks t ON t.owner_id=a.owner_id AND t.id=a.task_id
 WHERE s.id=NEW.source_id AND s.owner_id=NEW.owner_id AND a.id=NEW.artifact_id AND t.conversation_id=s.conversation_id
 AND length(NEW.excerpt)>0 AND position(NEW.excerpt IN s.snapshot)>0) THEN RAISE EXCEPTION 'evidence boundary'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER evidence_boundary BEFORE INSERT ON evidence FOR EACH ROW EXECUTE FUNCTION evidence_boundary();
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['sources','evidence'] LOOP
 EXECUTE format('CREATE TRIGGER active_owner BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION active_owner_write()',t);
 EXECUTE format('CREATE TRIGGER immutable_context BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION immutable_revision()',t);
 END LOOP;
END $$;
