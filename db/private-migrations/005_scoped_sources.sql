-- Public source evidence is unencrypted; derived intake payloads use the existing
-- storage-key envelopes. Every table remains behind the private-schema grants.
CREATE TABLE private.source_artifacts (
  id text PRIMARY KEY,
  source text NOT NULL,
  sha256 private.sha256 NOT NULL,
  byte_size bigint NOT NULL CHECK (byte_size >= 0),
  metadata jsonb NOT NULL
);
CREATE TABLE private.source_locations (
  artifact_id text NOT NULL REFERENCES private.source_artifacts(id),
  path text NOT NULL,
  PRIMARY KEY (artifact_id, path)
);
CREATE TABLE private.source_bundles (
  id private.sha256 PRIMARY KEY,
  status text NOT NULL CHECK (status IN ('loading', 'failed', 'ready')),
  checkpoint integer NOT NULL DEFAULT 0 CHECK (checkpoint >= 0),
  unit_count integer CHECK (unit_count >= checkpoint),
  evidence_sha256 private.sha256,
  key_id private.key_id NOT NULL,
  payload bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status != 'ready' OR (unit_count IS NOT NULL AND checkpoint = unit_count AND evidence_sha256 IS NOT NULL))
);
CREATE TABLE private.source_import_attempts (
  id uuid PRIMARY KEY,
  bundle_id text NOT NULL REFERENCES private.source_bundles(id),
  status text NOT NULL CHECK (status IN ('loading', 'failed', 'interrupted', 'ready')),
  error_code text,
  elapsed_ms integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE private.source_entries (
  bundle_id text NOT NULL REFERENCES private.source_bundles(id),
  source text NOT NULL,
  source_id text NOT NULL,
  source_order integer NOT NULL,
  headword text NOT NULL,
  original_pos text NOT NULL,
  role text NOT NULL CHECK (role IN ('candidate', 'linked')),
  raw_record text NOT NULL,
  raw_sha256 text NOT NULL,
  locator jsonb NOT NULL,
  data jsonb NOT NULL,
  PRIMARY KEY (bundle_id, source, source_id)
);
CREATE TABLE private.source_meanings (
  bundle_id text NOT NULL,
  source text NOT NULL,
  source_id text NOT NULL,
  entry_id text NOT NULL,
  source_order integer NOT NULL,
  concept_id text,
  data jsonb NOT NULL,
  PRIMARY KEY (bundle_id, source, source_id),
  FOREIGN KEY (bundle_id, source, entry_id) REFERENCES private.source_entries(bundle_id, source, source_id)
);
CREATE TABLE private.source_concepts (
  bundle_id text NOT NULL REFERENCES private.source_bundles(id),
  source_id text NOT NULL,
  source_order integer NOT NULL,
  raw_record text NOT NULL,
  raw_sha256 text NOT NULL,
  data jsonb NOT NULL,
  PRIMARY KEY (bundle_id, source_id)
);
CREATE TABLE private.source_relations (
  bundle_id text NOT NULL REFERENCES private.source_bundles(id),
  source_order integer NOT NULL,
  data jsonb NOT NULL,
  PRIMARY KEY (bundle_id, source_order)
);
CREATE TABLE private.source_supplements (
  bundle_id text PRIMARY KEY REFERENCES private.source_bundles(id),
  data jsonb NOT NULL
);
CREATE TABLE private.source_frequency (
  bundle_id text PRIMARY KEY REFERENCES private.source_bundles(id),
  source_order integer NOT NULL,
  data jsonb NOT NULL
);
CREATE TABLE private.intake_candidates (
  id uuid PRIMARY KEY,
  key_id private.key_id NOT NULL,
  payload bytea NOT NULL
);
CREATE TABLE private.intake_resolutions (
  bundle_id text NOT NULL REFERENCES private.source_bundles(id),
  candidate_id uuid NOT NULL REFERENCES private.intake_candidates(id),
  key_id private.key_id NOT NULL,
  payload bytea NOT NULL,
  PRIMARY KEY (bundle_id, candidate_id)
);
CREATE TABLE private.intake_assessments (
  id text PRIMARY KEY,
  bundle_id text NOT NULL REFERENCES private.source_bundles(id),
  candidate_id uuid NOT NULL REFERENCES private.intake_candidates(id),
  config_fingerprint private.sha256 NOT NULL,
  disposition text NOT NULL CHECK (disposition IN ('pass', 'exclude', 'unresolved')),
  key_id private.key_id NOT NULL,
  payload bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bundle_id, candidate_id, config_fingerprint)
);

CREATE FUNCTION private.immutable_record() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'immutable_record' USING ERRCODE = '55000';
END $$;
CREATE FUNCTION private.protect_source_bundle() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'ready' THEN
    RAISE EXCEPTION 'ready_bundle_immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER source_bundle_immutable BEFORE UPDATE OR DELETE ON private.source_bundles
  FOR EACH ROW EXECUTE FUNCTION private.protect_source_bundle();
CREATE FUNCTION private.protect_bundle_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP != 'INSERT' OR EXISTS (SELECT 1 FROM private.source_bundles WHERE id = NEW.bundle_id AND status = 'ready') THEN
    RAISE EXCEPTION 'bundle_evidence_immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;
DO $$
DECLARE name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['source_entries', 'source_meanings', 'source_concepts', 'source_relations', 'source_supplements', 'source_frequency'] LOOP
    EXECUTE format('CREATE TRIGGER evidence_immutable BEFORE INSERT OR UPDATE OR DELETE ON private.%I FOR EACH ROW EXECUTE FUNCTION private.protect_bundle_evidence()', name);
  END LOOP;
  FOREACH name IN ARRAY ARRAY['source_artifacts', 'intake_candidates', 'intake_resolutions', 'intake_assessments'] LOOP
    EXECUTE format('CREATE TRIGGER record_immutable BEFORE UPDATE OR DELETE ON private.%I FOR EACH ROW EXECUTE FUNCTION private.immutable_record()', name);
  END LOOP;
END $$;
CREATE FUNCTION private.protect_import_attempt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status != 'loading' THEN
    RAISE EXCEPTION 'import_attempt_immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER import_attempt_immutable BEFORE UPDATE OR DELETE ON private.source_import_attempts
  FOR EACH ROW EXECUTE FUNCTION private.protect_import_attempt();
