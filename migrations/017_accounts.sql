-- Self-service accounts: username/password credentials bound to an existing users row,
-- plus a per-account daily run counter used as a cost guard.
CREATE TABLE account_credentials (
  owner_id uuid PRIMARY KEY REFERENCES users(id),
  username text UNIQUE NOT NULL CHECK (username ~ '^[a-z0-9_.-]{3,32}$'),
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);
CREATE TABLE account_usage (
  owner_id uuid NOT NULL REFERENCES users(id),
  day date NOT NULL,
  runs integer NOT NULL DEFAULT 0 CHECK (runs >= 0),
  PRIMARY KEY (owner_id, day)
);
