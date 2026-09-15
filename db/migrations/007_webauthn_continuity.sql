ALTER TABLE passkeys
  ADD COLUMN counter bigint NOT NULL DEFAULT 0,
  ADD COLUMN transports text[] NOT NULL DEFAULT '{}',
  ADD COLUMN device_type text,
  ADD COLUMN backed_up boolean;

ALTER TABLE passkey_challenges ALTER COLUMN profile_id DROP NOT NULL;

CREATE TABLE profile_handoffs (
  id uuid PRIMARY KEY,
  profile_id uuid NOT NULL REFERENCES profiles(id),
  source_session_id uuid NOT NULL REFERENCES sessions(id),
  code_digest text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz
);

CREATE INDEX profile_handoffs_profile_id_idx ON profile_handoffs(profile_id);
