-- A new interpretation of retained paid evidence never updates the source trials.
CREATE TABLE private.planner_revalidations (
  id private.sha256 PRIMARY KEY,
  source_experiment_id uuid NOT NULL REFERENCES private.experiments(id),
  configuration_fingerprint private.sha256 NOT NULL,
  implementation_fingerprint private.sha256 NOT NULL,
  rule_identity private.sha256 NOT NULL,
  source_evidence_identity private.sha256 NOT NULL,
  key_id private.key_id NOT NULL CHECK (key_id LIKE 'ww-storage-%'),
  payload bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON private.planner_revalidations
  FOR EACH ROW EXECUTE FUNCTION private.production_immutable();
