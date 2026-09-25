CREATE TABLE artifacts (
 id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES users(id), task_id uuid NOT NULL,
 title text NOT NULL, current_revision integer NOT NULL CHECK(current_revision>0),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(owner_id,id),
 FOREIGN KEY(owner_id,task_id) REFERENCES tasks(owner_id,id) ON DELETE CASCADE
);
CREATE TABLE artifact_revisions (
 owner_id uuid NOT NULL, artifact_id uuid NOT NULL, revision integer NOT NULL CHECK(revision>0),
 content jsonb NOT NULL, hash text NOT NULL CHECK(length(hash)=64), created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(artifact_id,revision), UNIQUE(owner_id,artifact_id,revision),
 FOREIGN KEY(owner_id,artifact_id) REFERENCES artifacts(owner_id,id) ON DELETE CASCADE
);
CREATE FUNCTION immutable_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' AND EXISTS(SELECT 1 FROM users WHERE id=OLD.owner_id AND status='purged') THEN RETURN OLD; END IF;
 RAISE EXCEPTION 'immutable revision';
END $$;
CREATE TRIGGER immutable_revision BEFORE UPDATE OR DELETE ON artifact_revisions FOR EACH ROW EXECUTE FUNCTION immutable_revision();
