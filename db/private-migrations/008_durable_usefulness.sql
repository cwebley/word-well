-- Both gates share the existing attempts, requests, results and accounting.
ALTER TABLE private.production_trials ADD COLUMN stage private.code NOT NULL DEFAULT 'appropriateness';
ALTER TABLE private.production_trials DROP CONSTRAINT production_trials_pkey;
ALTER TABLE private.production_trials ADD PRIMARY KEY(run_id,stage,trial_index);
ALTER TABLE private.production_trials ADD CHECK(stage IN ('appropriateness','usefulness'));
ALTER TABLE private.production_results DROP CONSTRAINT production_results_run_id_key;
ALTER TABLE private.production_results DROP CONSTRAINT production_results_stage_check;
ALTER TABLE private.production_results ADD UNIQUE(run_id,stage);
ALTER TABLE private.production_results ADD CHECK(stage IN ('appropriateness','usefulness'));
ALTER TABLE private.reuse_authorizations DROP CONSTRAINT reuse_authorizations_pkey;
ALTER TABLE private.reuse_authorizations ADD PRIMARY KEY(run_id,result_id);
ALTER TABLE private.reuse_authorizations ADD COLUMN appropriateness_result_id uuid REFERENCES private.production_results(id);
-- The already approved usefulness configuration has external reviewed evidence,
-- not an appropriateness assessment. Keep both authorities distinct.
ALTER TABLE private.stage_promotions ADD COLUMN stage private.code NOT NULL DEFAULT 'appropriateness';
ALTER TABLE private.stage_promotions ALTER COLUMN assessment_id DROP NOT NULL;
ALTER TABLE private.stage_promotions ADD CHECK(
  (stage='appropriateness' AND assessment_id IS NOT NULL) OR
  (stage='usefulness' AND assessment_id IS NULL));
