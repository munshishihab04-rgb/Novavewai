-- Temporary ("chat temporanea") conversations: hidden from the workspace list, deletable by the owner,
-- swept automatically after 24 hours. Existing rows default to false (unchanged behaviour).
ALTER TABLE conversations ADD COLUMN ephemeral boolean NOT NULL DEFAULT false;
CREATE INDEX conversations_ephemeral_idx ON conversations(created_at) WHERE ephemeral;
-- The flag itself cannot be flipped later (a saved chat can never silently become deletable).
CREATE FUNCTION ephemeral_flag_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.ephemeral<>OLD.ephemeral THEN RAISE EXCEPTION 'ephemeral immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ephemeral_flag_immutable BEFORE UPDATE ON conversations FOR EACH ROW EXECUTE FUNCTION ephemeral_flag_immutable();
-- Immutability triggers (revisions, messages, sources, events, receipts, files) keep protecting ordinary history.
-- The ONLY extra case where rows may disappear is the cascade of an ephemeral conversation, signalled by a
-- transaction-local setting that deleteEphemeral/sweepEphemeral set right before DELETE FROM conversations
-- (SET LOCAL dies with the transaction, so it can never leak into another request).
CREATE OR REPLACE FUNCTION immutable_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' AND EXISTS(SELECT 1 FROM users WHERE id=OLD.owner_id AND status='purged') THEN RETURN OLD; END IF;
 IF TG_OP='DELETE' AND current_setting('nova.ephemeral_cascade',true)='on' THEN RETURN OLD; END IF;
 RAISE EXCEPTION 'immutable revision';
END $$;
CREATE OR REPLACE FUNCTION immutable_file() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN
   IF OLD.state='pending' OR EXISTS(SELECT 1 FROM users WHERE id=OLD.owner_id AND status='purged') THEN RETURN OLD; END IF;
   IF current_setting('nova.ephemeral_cascade',true)='on' THEN RETURN OLD; END IF;
 ELSE
   IF OLD.state='pending' AND NEW.state='ready' AND (to_jsonb(NEW)-'state')=(to_jsonb(OLD)-'state') THEN RETURN NEW; END IF;
 END IF;
 RAISE EXCEPTION 'immutable file';
END $$;
