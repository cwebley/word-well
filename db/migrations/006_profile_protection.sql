ALTER TABLE profiles
  ADD COLUMN protected_at timestamptz,
  ADD COLUMN recovery_email text,
  ADD COLUMN purge_schedule jsonb;

ALTER TABLE sessions
  ADD COLUMN recently_authenticated_at timestamptz;

CREATE TABLE passkeys (
  id uuid PRIMARY KEY,
  profile_id uuid NOT NULL REFERENCES profiles(id),
  credential_id text NOT NULL UNIQUE,
  label text NOT NULL,
  public_key text NOT NULL,
  registered_at timestamptz NOT NULL
);

CREATE INDEX passkeys_profile_id_idx ON passkeys(profile_id);

CREATE TABLE passkey_challenges (
  id uuid PRIMARY KEY,
  profile_id uuid NOT NULL REFERENCES profiles(id),
  session_id uuid REFERENCES sessions(id),
  purpose text NOT NULL CHECK (purpose IN ('register', 'authenticate')),
  challenge text NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz
);

CREATE INDEX passkey_challenges_profile_purpose_idx
  ON passkey_challenges(profile_id, purpose);

CREATE TABLE recovery_tokens (
  id uuid PRIMARY KEY,
  profile_id uuid NOT NULL REFERENCES profiles(id),
  purpose text NOT NULL CHECK (purpose IN ('verify-email', 'recover')),
  token_digest text NOT NULL UNIQUE,
  email text,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  UNIQUE (profile_id, purpose)
);

CREATE INDEX recovery_tokens_profile_purpose_idx
  ON recovery_tokens(profile_id, purpose);

CREATE TABLE profile_access_events (
  id bigserial PRIMARY KEY,
  profile_id uuid NOT NULL REFERENCES profiles(id),
  event text NOT NULL CHECK (event IN ('history-accessed')),
  recorded_at timestamptz NOT NULL,
  UNIQUE (profile_id, event)
);