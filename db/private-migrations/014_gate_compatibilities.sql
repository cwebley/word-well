-- Additive proofs. No historical identity, decision or selection is restamped.
CREATE TABLE private.gate_compatibilities (
  id private.sha256 PRIMARY KEY,
  kind private.code NOT NULL CHECK(kind IN ('promotion','appropriateness','usefulness')),
  subject_id uuid NOT NULL,
  promotion_id uuid REFERENCES private.stage_promotions(id),
  result_id uuid REFERENCES private.production_results(id),
  current_identity private.sha256 NOT NULL,
  policy_identity private.sha256 NOT NULL,
  key_id private.key_id NOT NULL,
  payload bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(kind,subject_id,current_identity,policy_identity),
  CHECK((kind='promotion' AND promotion_id=subject_id AND result_id IS NULL) OR
    (kind<>'promotion' AND result_id=subject_id AND promotion_id IS NULL)),
  CHECK((promotion_id IS NULL) <> (result_id IS NULL))
);
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON private.gate_compatibilities
  FOR EACH ROW EXECUTE FUNCTION private.production_immutable();
