-- Immutable encrypted review artifacts and publication history. Public content
-- is written only by the restricted pipeline role, never the learner role.
CREATE TABLE private.publication_candidates (
  id text PRIMARY KEY,
  lesson_id text NOT NULL,
  key_id text NOT NULL,
  payload bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE private.publication_reviews (
  id uuid PRIMARY KEY,
  candidate_id text NOT NULL REFERENCES private.publication_candidates(id),
  key_id text NOT NULL,
  payload bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE private.publication_revisions (
  candidate_id text PRIMARY KEY REFERENCES private.publication_candidates(id),
  lesson_id text NOT NULL,
  publication_version integer NOT NULL CHECK (publication_version > 0),
  review_id uuid NOT NULL REFERENCES private.publication_reviews(id),
  key_id text NOT NULL,
  payload bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (lesson_id, publication_version)
);
DO $$
DECLARE name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['publication_candidates','publication_reviews','publication_revisions'] LOOP
    EXECUTE format('CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON private.%I FOR EACH ROW EXECUTE FUNCTION private.production_immutable()', name);
  END LOOP;
END
$$;
GRANT SELECT, INSERT ON private.publication_candidates, private.publication_reviews, private.publication_revisions TO wordwell_pipeline;
REVOKE UPDATE ON private.publication_candidates, private.publication_reviews, private.publication_revisions FROM wordwell_pipeline;
GRANT SELECT, INSERT ON public.published_lessons TO wordwell_pipeline;
GRANT UPDATE (record, available, withdrawal_reason) ON public.published_lessons TO wordwell_pipeline;
