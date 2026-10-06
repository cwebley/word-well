-- Add production ownership to the shared encrypted attempt/request store.
-- Existing evaluation rows, payloads and receipt identities are unchanged.
CREATE TABLE private.production_runs (
  id uuid PRIMARY KEY,
  candidate_id uuid NOT NULL REFERENCES private.intake_candidates(id),
  cap_nano_usd private.nano_usd NOT NULL CHECK (cap_nano_usd > 0),
  status private.code NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','paused','accepted','rejected','failed')),
  outcome_code private.code,
  key_id private.key_id NOT NULL,
  payload bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE private.attempts ALTER COLUMN experiment_id DROP NOT NULL;
ALTER TABLE private.attempts ADD COLUMN run_id uuid REFERENCES private.production_runs(id);
ALTER TABLE private.attempts ADD CONSTRAINT attempt_owner CHECK ((experiment_id IS NULL) <> (run_id IS NULL));

CREATE TABLE private.candidate_claims (
  candidate_id uuid PRIMARY KEY REFERENCES private.intake_candidates(id),
  run_id uuid REFERENCES private.production_runs(id),
  token uuid,
  CHECK ((run_id IS NULL) = (token IS NULL))
);
CREATE TABLE private.production_trials (
  run_id uuid NOT NULL REFERENCES private.production_runs(id),
  trial_index smallint NOT NULL CHECK (trial_index BETWEEN 1 AND 3),
  attempt_id uuid NOT NULL UNIQUE,
  PRIMARY KEY (run_id, trial_index)
);
CREATE TABLE private.production_results (
  id uuid PRIMARY KEY,
  run_id uuid NOT NULL UNIQUE REFERENCES private.production_runs(id),
  candidate_id uuid NOT NULL REFERENCES private.intake_candidates(id),
  stage private.code NOT NULL CHECK (stage = 'appropriateness'),
  reuse_identity private.sha256 NOT NULL,
  key_id private.key_id NOT NULL,
  payload bytea NOT NULL
);
CREATE TABLE private.stage_selections (
  candidate_id uuid NOT NULL REFERENCES private.intake_candidates(id),
  stage private.code NOT NULL,
  result_id uuid NOT NULL REFERENCES private.production_results(id),
  PRIMARY KEY (candidate_id, stage)
);
CREATE TABLE private.selection_history (
  id uuid PRIMARY KEY,
  candidate_id uuid NOT NULL REFERENCES private.intake_candidates(id),
  stage private.code NOT NULL,
  result_id uuid NOT NULL REFERENCES private.production_results(id),
  run_id uuid NOT NULL REFERENCES private.production_runs(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE private.reuse_authorizations (
  run_id uuid PRIMARY KEY REFERENCES private.production_runs(id),
  result_id uuid NOT NULL REFERENCES private.production_results(id),
  assessment_id text NOT NULL REFERENCES private.intake_assessments(id),
  promotion_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE private.promotion_assessments (
  id private.sha256 PRIMARY KEY,
  experiment_id uuid NOT NULL REFERENCES private.experiments(id),
  configuration_fingerprint private.sha256 NOT NULL,
  rule_identity private.sha256 NOT NULL,
  evidence_identity private.sha256 NOT NULL,
  qualifies boolean NOT NULL,
  key_id private.key_id NOT NULL,
  payload bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE private.stage_promotions (
  id uuid PRIMARY KEY,
  configuration_fingerprint private.sha256 NOT NULL,
  assessment_id private.sha256 NOT NULL REFERENCES private.promotion_assessments(id),
  decision private.code NOT NULL CHECK (decision IN ('promote','do_not_promote')),
  key_id private.key_id NOT NULL,
  payload bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE private.reuse_authorizations ADD FOREIGN KEY (promotion_id) REFERENCES private.stage_promotions(id);

CREATE FUNCTION private.production_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'immutable production record' USING ERRCODE='55000'; END $$;
DO $$ DECLARE name text; BEGIN
  FOREACH name IN ARRAY ARRAY['production_results','selection_history','reuse_authorizations','promotion_assessments','stage_promotions'] LOOP
    EXECUTE format('CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON private.%I FOR EACH ROW EXECUTE FUNCTION private.production_immutable()', name);
  END LOOP;
END $$;
CREATE FUNCTION private.production_run_instructions() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id <> OLD.id OR NEW.candidate_id <> OLD.candidate_id OR NEW.cap_nano_usd <> OLD.cap_nano_usd
    OR NEW.key_id <> OLD.key_id OR NEW.payload <> OLD.payload OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'immutable run instructions' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER fixed_instructions BEFORE UPDATE ON private.production_runs FOR EACH ROW EXECUTE FUNCTION private.production_run_instructions();
CREATE FUNCTION private.production_terminal_attempt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.run_id IS NOT NULL AND OLD.status <> 'pending' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'immutable terminal attempt' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER immutable_production_attempt BEFORE UPDATE ON private.attempts FOR EACH ROW EXECUTE FUNCTION private.production_terminal_attempt();
