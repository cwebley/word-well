-- New finalizations retain the exact aggregate so filesystem retry cannot
-- rescore or reprice a frozen summary. Historical rows remain untouched.
ALTER TABLE private.experiments ADD COLUMN finalized_summary_key_id private.key_id
  CHECK (finalized_summary_key_id LIKE 'ww-storage-%');
ALTER TABLE private.experiments ADD COLUMN finalized_summary_payload bytea;
ALTER TABLE private.experiments ADD CONSTRAINT frozen_summary_envelope
  CHECK ((finalized_summary_key_id IS NULL) = (finalized_summary_payload IS NULL));
CREATE FUNCTION private.protect_finalized_experiment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.finalized_at IS NOT NULL THEN
    RAISE EXCEPTION 'finalized_experiment_immutable' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER finalized_experiment_immutable BEFORE UPDATE OR DELETE ON private.experiments
  FOR EACH ROW EXECUTE FUNCTION private.protect_finalized_experiment();
