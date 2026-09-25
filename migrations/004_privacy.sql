CREATE FUNCTION active_owner_write() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM id FROM users WHERE id=NEW.owner_id AND status='active' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'owner inactive'; END IF;
 IF TG_OP='UPDATE' AND NEW.owner_id<>OLD.owner_id THEN RAISE EXCEPTION 'owner immutable'; END IF;
 RETURN NEW;
END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['sessions','conversations','tasks','outbox','idempotency','artifacts','artifact_revisions','action_intents','approvals','receipts','audit_events'] LOOP
 EXECUTE format('CREATE TRIGGER active_owner BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION active_owner_write()',t);
 END LOOP;
END $$;
CREATE FUNCTION preserve_tombstone() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR OLD.status='purged' OR NEW.id<>OLD.id THEN RAISE EXCEPTION 'tombstone immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER preserve_tombstone BEFORE UPDATE OR DELETE ON users FOR EACH ROW EXECUTE FUNCTION preserve_tombstone();
