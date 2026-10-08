-- Add writer history without changing earlier encrypted evidence or authorizations.
ALTER TABLE private.production_trials DROP CONSTRAINT production_trials_stage_check;
ALTER TABLE private.production_trials ADD CHECK(stage IN ('appropriateness','usefulness','planner','writer'));
ALTER TABLE private.production_results DROP CONSTRAINT production_results_stage_check;
ALTER TABLE private.production_results ADD CHECK(stage IN ('appropriateness','usefulness','planner','writer'));

CREATE TABLE private.writer_trial_reviews (
  id uuid PRIMARY KEY,
  experiment_id uuid NOT NULL REFERENCES private.experiments(id),
  attempt_id uuid NOT NULL REFERENCES private.attempts(id),
  configuration_fingerprint private.sha256 NOT NULL,
  key_id private.key_id NOT NULL,
  payload bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE private.writer_promotions (
  id uuid PRIMARY KEY,
  experiment_id uuid NOT NULL REFERENCES private.experiments(id),
  configuration_fingerprint private.sha256 NOT NULL,
  decision private.code NOT NULL CHECK(decision IN ('promote','do_not_promote')),
  key_id private.key_id NOT NULL,
  payload bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE private.writer_authorizations (
  run_id uuid NOT NULL REFERENCES private.production_runs(id),
  result_id uuid NOT NULL REFERENCES private.production_results(id),
  assessment_id private.sha256 NOT NULL REFERENCES private.intake_assessments(id),
  appropriateness_result_id uuid NOT NULL REFERENCES private.production_results(id),
  usefulness_result_id uuid NOT NULL REFERENCES private.production_results(id),
  planner_result_id uuid NOT NULL REFERENCES private.production_results(id),
  planner_promotion_id uuid REFERENCES private.planner_promotions(id),
  writer_promotion_id uuid REFERENCES private.writer_promotions(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (run_id,result_id,assessment_id,appropriateness_result_id,usefulness_result_id,planner_result_id,planner_promotion_id,writer_promotion_id)
);
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON private.writer_trial_reviews
  FOR EACH ROW EXECUTE FUNCTION private.production_immutable();
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON private.writer_promotions
  FOR EACH ROW EXECUTE FUNCTION private.production_immutable();
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON private.writer_authorizations
  FOR EACH ROW EXECUTE FUNCTION private.production_immutable();
