CREATE TABLE action_intents (
 id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES users(id), artifact_id uuid NOT NULL, revision integer NOT NULL,
 operation text NOT NULL CHECK(operation='simulate.send'), account text NOT NULL CHECK(account='synthetic-account'),
 recipient text NOT NULL CHECK(recipient LIKE '%@example.invalid'), payload jsonb NOT NULL,
 binding_hash text NOT NULL, expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(owner_id,id), FOREIGN KEY(owner_id,artifact_id,revision) REFERENCES artifact_revisions(owner_id,artifact_id,revision) ON DELETE CASCADE
);
CREATE TRIGGER immutable_intent BEFORE UPDATE OR DELETE ON action_intents FOR EACH ROW EXECUTE FUNCTION immutable_revision();
CREATE TABLE approvals (
 id uuid PRIMARY KEY, owner_id uuid NOT NULL, intent_id uuid NOT NULL UNIQUE,
 binding_hash text NOT NULL, expires_at timestamptz NOT NULL,
 status text NOT NULL DEFAULT 'approved' CHECK(status IN ('approved','consumed','revoked')),
 consumed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(owner_id,id),
 FOREIGN KEY(owner_id,intent_id) REFERENCES action_intents(owner_id,id) ON DELETE CASCADE
);
CREATE TABLE receipts (
 id uuid PRIMARY KEY, owner_id uuid NOT NULL, intent_id uuid NOT NULL UNIQUE, approval_id uuid NOT NULL UNIQUE,
 status text NOT NULL CHECK(status IN ('queued','executing','succeeded','outcome_unknown','cancelled')),
 reference text, session_hash text NOT NULL, started_at timestamptz, finished_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(owner_id,id),
 FOREIGN KEY(owner_id,intent_id) REFERENCES action_intents(owner_id,id) ON DELETE CASCADE,
 FOREIGN KEY(owner_id,approval_id) REFERENCES approvals(owner_id,id) ON DELETE CASCADE
);
CREATE TABLE audit_events (
 id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES users(id), action text NOT NULL,
 resource_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX outbox_claim ON outbox(state,lease_until,created_at);
