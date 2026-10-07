-- Add planner selections/reviews without replacing gate or evaluation history.
ALTER TABLE private.production_trials DROP CONSTRAINT production_trials_stage_check;
ALTER TABLE private.production_trials ADD CHECK(stage IN ('appropriateness','usefulness','planner'));
ALTER TABLE private.production_results DROP CONSTRAINT production_results_stage_check;
ALTER TABLE private.production_results ADD CHECK(stage IN ('appropriateness','usefulness','planner'));
ALTER TABLE private.reuse_authorizations ADD COLUMN usefulness_result_id uuid REFERENCES private.production_results(id);

CREATE TABLE private.planner_trial_reviews (
  id uuid PRIMARY KEY,
  experiment_id uuid NOT NULL REFERENCES private.experiments(id),
  attempt_id uuid NOT NULL REFERENCES private.attempts(id),
  configuration_fingerprint private.sha256 NOT NULL,
  key_id private.key_id NOT NULL,
  payload bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE private.planner_promotions (
  id uuid PRIMARY KEY,
  experiment_id uuid NOT NULL REFERENCES private.experiments(id),
  configuration_fingerprint private.sha256 NOT NULL,
  decision private.code NOT NULL CHECK(decision IN ('promote','do_not_promote')),
  key_id private.key_id NOT NULL,
  payload bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON private.planner_trial_reviews
  FOR EACH ROW EXECUTE FUNCTION private.production_immutable();
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON private.planner_promotions
  FOR EACH ROW EXECUTE FUNCTION private.production_immutable();

ALTER TABLE private.reuse_authorizations ADD COLUMN planner_promotion_id uuid REFERENCES private.planner_promotions(id);
DO $$ DECLARE name text; BEGIN
  FOR name IN SELECT conname FROM pg_constraint
    WHERE conrelid='private.reuse_authorizations'::regclass AND contype='u' LOOP
    EXECUTE format('ALTER TABLE private.reuse_authorizations DROP CONSTRAINT %I',name);
  END LOOP;
END $$;
ALTER TABLE private.reuse_authorizations ADD UNIQUE NULLS NOT DISTINCT
  (run_id,result_id,assessment_id,promotion_id,appropriateness_result_id,usefulness_result_id,planner_promotion_id);
