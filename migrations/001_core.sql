CREATE TABLE users (
  id uuid PRIMARY KEY, status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','purged')),
  created_at timestamptz NOT NULL DEFAULT now(), purged_at timestamptz
);
CREATE TABLE sessions (
  token_hash text PRIMARY KEY CHECK (length(token_hash)=64), owner_id uuid NOT NULL REFERENCES users(id),
  expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE conversations (
  id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES users(id), title text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(owner_id,id)
);
CREATE TABLE tasks (
  id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES users(id), conversation_id uuid NOT NULL,
  goal text NOT NULL, status text NOT NULL DEFAULT 'created', version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(owner_id,id),
  FOREIGN KEY(owner_id,conversation_id) REFERENCES conversations(owner_id,id) ON DELETE CASCADE
);
CREATE TABLE outbox (
  id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES users(id), kind text NOT NULL,
  resource_id uuid NOT NULL, state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','leased','done')),
  lease_token uuid, lease_until timestamptz, attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(owner_id,id)
);
CREATE TABLE idempotency (
  owner_id uuid NOT NULL REFERENCES users(id), key text NOT NULL, fingerprint text NOT NULL,
  response jsonb NOT NULL, status integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(owner_id,key)
);
