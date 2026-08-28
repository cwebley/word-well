CREATE TABLE profiles (
  id uuid PRIMARY KEY,
  state text NOT NULL CHECK (state IN ('anonymous', 'protected', 'tombstoned')),
  created_at timestamptz NOT NULL,
  tombstoned_at timestamptz
);

CREATE TABLE sessions (
  id uuid PRIMARY KEY,
  profile_id uuid NOT NULL REFERENCES profiles(id),
  client_context_id text NOT NULL,
  grant_digest text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL,
  last_contact_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);

CREATE INDEX sessions_profile_id_idx ON sessions(profile_id);

CREATE TABLE published_lessons (
  id text PRIMARY KEY,
  normalized_headword text NOT NULL,
  record jsonb NOT NULL,
  available boolean NOT NULL DEFAULT true,
  withdrawal_reason text
);

CREATE TABLE deliveries (
  id text PRIMARY KEY,
  profile_id uuid NOT NULL REFERENCES profiles(id),
  local_date date NOT NULL,
  lesson_id text NOT NULL REFERENCES published_lessons(id),
  normalized_headword text NOT NULL,
  UNIQUE (profile_id, local_date),
  UNIQUE (profile_id, normalized_headword)
);

CREATE TABLE accepted_operations (
  profile_id uuid NOT NULL REFERENCES profiles(id),
  operation_id text NOT NULL,
  client_context_id text NOT NULL,
  operation_hash text NOT NULL,
  kind text NOT NULL,
  delivery_id text NOT NULL,
  details jsonb NOT NULL,
  accepted_at timestamptz NOT NULL,
  accepted_order bigint GENERATED ALWAYS AS IDENTITY,
  PRIMARY KEY (profile_id, operation_id),
  FOREIGN KEY (delivery_id) REFERENCES deliveries(id)
);

CREATE TABLE learner_evidence (
  profile_id uuid NOT NULL REFERENCES profiles(id),
  operation_id text NOT NULL,
  delivery_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('practice', 'utility', 'content-quality')),
  details jsonb NOT NULL,
  accepted_at timestamptz NOT NULL,
  accepted_order bigint NOT NULL UNIQUE,
  PRIMARY KEY (profile_id, operation_id),
  FOREIGN KEY (profile_id, operation_id)
    REFERENCES accepted_operations(profile_id, operation_id)
);

CREATE TABLE learner_choices (
  profile_id uuid NOT NULL REFERENCES profiles(id),
  delivery_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('familiarity', 'active-use')),
  operation_id text NOT NULL,
  details jsonb NOT NULL,
  accepted_at timestamptz NOT NULL,
  accepted_order bigint NOT NULL,
  PRIMARY KEY (profile_id, delivery_id, kind),
  FOREIGN KEY (profile_id, operation_id)
    REFERENCES accepted_operations(profile_id, operation_id)
);

CREATE INDEX accepted_operations_profile_order_idx
  ON accepted_operations(profile_id, accepted_order);
CREATE INDEX learner_evidence_profile_order_idx
  ON learner_evidence(profile_id, accepted_order);
