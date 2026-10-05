-- Private pipeline records (#8, #15). Every column that could hold case text,
-- prompts, replies, expectations or error detail is age ciphertext (bytea).
-- Plain columns are opaque identities, fixed codes, counts, amounts and times.

CREATE SCHEMA private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;

-- Restricted learner role: public learner records only, never the private schema.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wordwell_learner') THEN
    CREATE ROLE wordwell_learner NOLOGIN;
  END IF;
END
$$;
GRANT USAGE ON SCHEMA public TO wordwell_learner;
GRANT SELECT ON public.published_lessons TO wordwell_learner;
REVOKE ALL ON SCHEMA private FROM wordwell_learner;

CREATE DOMAIN private.key_id AS text CHECK (VALUE ~ '^ww-(dataset|storage)-v[1-9][0-9]*$');
CREATE DOMAIN private.code AS text CHECK (VALUE ~ '^[a-z][a-z0-9_]{0,63}$');
CREATE DOMAIN private.sha256 AS text CHECK (VALUE ~ '^[a-f0-9]{64}$');
CREATE DOMAIN private.nano_usd AS bigint CHECK (VALUE >= 0);

-- One run under fixed instructions and cap. Payload: configuration material,
-- execution settings, pricing evidence, dataset content identity, revisions.
CREATE TABLE private.experiments (
  id uuid PRIMARY KEY,
  stage private.code NOT NULL,
  dataset_id uuid NOT NULL,
  dataset_version integer NOT NULL CHECK (dataset_version > 0),
  dataset_ciphertext_sha256 private.sha256 NOT NULL,
  configuration_fingerprint private.sha256 NOT NULL,
  implementation_fingerprint private.sha256 NOT NULL,
  cap_nano_usd private.nano_usd NOT NULL CHECK (cap_nano_usd > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  key_id private.key_id NOT NULL,
  payload bytea NOT NULL
);

-- Frozen case material copied in at start. The stage input uses the storage
-- key. The owner expectation and split use the dataset key, so stage
-- execution, which holds only the storage key, cannot read held-out labels.
CREATE TABLE private.cases (
  experiment_id uuid NOT NULL REFERENCES private.experiments(id),
  case_id uuid NOT NULL,
  position integer NOT NULL CHECK (position >= 0),
  key_id private.key_id NOT NULL CHECK (key_id LIKE 'ww-storage-%'),
  input_payload bytea NOT NULL,
  expectation_key_id private.key_id NOT NULL CHECK (expectation_key_id LIKE 'ww-dataset-%'),
  expectation_payload bytea NOT NULL,
  PRIMARY KEY (experiment_id, case_id),
  UNIQUE (experiment_id, position)
);

-- One deliberate judgment of a frozen input.
CREATE TABLE private.attempts (
  id uuid PRIMARY KEY,
  experiment_id uuid NOT NULL REFERENCES private.experiments(id),
  stage private.code NOT NULL,
  status private.code NOT NULL CHECK (status IN ('pending', 'valid', 'invalid', 'failed', 'uncertain', 'response_lost')),
  outcome_code private.code,
  next_eligible_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  key_id private.key_id NOT NULL,
  input_payload bytea NOT NULL,
  result_payload bytea
);

CREATE TABLE private.trials (
  experiment_id uuid NOT NULL,
  case_id uuid NOT NULL,
  trial_index smallint NOT NULL CHECK (trial_index BETWEEN 1 AND 3),
  -- Assigned before the executor creates the attempt row.
  attempt_id uuid NOT NULL UNIQUE,
  PRIMARY KEY (experiment_id, case_id, trial_index),
  FOREIGN KEY (experiment_id, case_id) REFERENCES private.cases(experiment_id, case_id)
);

-- One physical request, including transport retries. A reserved row without a
-- durable ledger dispatch intent was never sent.
CREATE TABLE private.requests (
  id uuid PRIMARY KEY,
  attempt_id uuid NOT NULL REFERENCES private.attempts(id),
  -- Abandoned (never sent) rows also take a sequence number.
  sequence smallint NOT NULL CHECK (sequence >= 1),
  status private.code NOT NULL CHECK (status IN ('reserved', 'abandoned', 'responded', 'no_response')),
  reserved_nano_usd private.nano_usd NOT NULL,
  charge_status private.code NOT NULL CHECK (charge_status IN ('pending', 'known', 'unknown', 'none')),
  charge_nano_usd private.nano_usd,
  http_status smallint CHECK (http_status BETWEEN 100 AND 599),
  retryable boolean,
  retry_after_ms integer CHECK (retry_after_ms >= 0),
  generation_id text CHECK (generation_id ~ '^[A-Za-z0-9_-]{1,128}$'),
  input_tokens integer CHECK (input_tokens >= 0),
  output_tokens integer CHECK (output_tokens >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  key_id private.key_id,
  response_payload bytea,
  UNIQUE (attempt_id, sequence),
  CHECK ((charge_status = 'known') = (charge_nano_usd IS NOT NULL))
);

-- Per-case scores reveal the expected finding, so they use the dataset key.
CREATE TABLE private.case_scores (
  experiment_id uuid NOT NULL,
  case_id uuid NOT NULL,
  key_id private.key_id NOT NULL CHECK (key_id LIKE 'ww-dataset-%'),
  payload bytea NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (experiment_id, case_id),
  FOREIGN KEY (experiment_id, case_id) REFERENCES private.cases(experiment_id, case_id)
);
