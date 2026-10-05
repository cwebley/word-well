-- Finalization freezes an experiment's evidence and its aggregate summary
-- (#8). Afterwards run/resume refuse; fresh judgments need a new experiment.
ALTER TABLE private.experiments
  ADD COLUMN finalized_at timestamptz,
  ADD COLUMN summary_sha256 private.sha256,
  ADD CONSTRAINT experiments_finalized_summary CHECK ((finalized_at IS NULL) = (summary_sha256 IS NULL));
