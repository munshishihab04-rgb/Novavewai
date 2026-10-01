ALTER TABLE messages ADD COLUMN role text NOT NULL DEFAULT 'user' CHECK(role IN ('user','assistant'));
ALTER TABLE tasks ADD CONSTRAINT tasks_conversation_identity UNIQUE(owner_id,conversation_id,id);
CREATE TABLE agent_runs (
 id uuid PRIMARY KEY, owner_id uuid NOT NULL, conversation_id uuid NOT NULL, task_id uuid NOT NULL,
 status text NOT NULL CHECK(status IN ('queued','running','completed','waiting_user','failed','cancelled','outcome_unknown')),
 session_hash text NOT NULL CHECK(length(session_hash)=64),
 checkpoint jsonb NOT NULL DEFAULT '{}'::jsonb, context_hash text,
 model_calls integer NOT NULL DEFAULT 0 CHECK(model_calls BETWEEN 0 AND 8),
 tool_calls integer NOT NULL DEFAULT 0 CHECK(tool_calls BETWEEN 0 AND 16),
 error_code text, created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(owner_id,id),
 FOREIGN KEY(owner_id,conversation_id,task_id) REFERENCES tasks(owner_id,conversation_id,id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX agent_one_active ON agent_runs(owner_id,conversation_id) WHERE status IN ('queued','running');
CREATE TABLE agent_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, owner_id uuid NOT NULL, run_id uuid NOT NULL,
 kind text NOT NULL, detail jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(owner_id,run_id) REFERENCES agent_runs(owner_id,id) ON DELETE CASCADE
);
CREATE TABLE agent_tool_receipts (
 owner_id uuid NOT NULL, run_id uuid NOT NULL, call_id text NOT NULL, tool text NOT NULL,
 input_hash text NOT NULL, result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(run_id,call_id), FOREIGN KEY(owner_id,run_id) REFERENCES agent_runs(owner_id,id) ON DELETE CASCADE
);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['agent_runs','agent_events','agent_tool_receipts'] LOOP
 EXECUTE format('CREATE TRIGGER active_owner BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION active_owner_write()',t);
 END LOOP;
END $$;
CREATE TRIGGER immutable_agent_event BEFORE UPDATE OR DELETE ON agent_events FOR EACH ROW EXECUTE FUNCTION immutable_revision();
CREATE TRIGGER immutable_tool_receipt BEFORE UPDATE OR DELETE ON agent_tool_receipts FOR EACH ROW EXECUTE FUNCTION immutable_revision();
CREATE INDEX agent_events_page ON agent_events(owner_id,run_id,id);
