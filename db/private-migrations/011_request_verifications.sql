-- Metadata-only verification rounds never overwrite the original charged reply.
CREATE TABLE private.request_verifications (
  id uuid PRIMARY KEY,
  request_id uuid NOT NULL REFERENCES private.requests(id),
  sequence integer NOT NULL CHECK(sequence > 0),
  key_id private.key_id NOT NULL,
  payload bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(request_id, sequence)
);
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON private.request_verifications
  FOR EACH ROW EXECUTE FUNCTION private.production_immutable();
