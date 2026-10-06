-- Migration-owned permissions. Runtime jobs never own schema objects.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wordwell_pipeline') THEN
    CREATE ROLE wordwell_pipeline NOLOGIN;
  END IF;
END
$$;

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
-- PUBLIC otherwise gives every login temporary-table creation permission.
DO $$
BEGIN
  EXECUTE format('REVOKE CREATE, TEMPORARY ON DATABASE %I FROM PUBLIC', current_database());
END
$$;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM wordwell_learner, wordwell_pipeline;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM wordwell_learner, wordwell_pipeline;
GRANT USAGE ON SCHEMA public TO wordwell_learner;
GRANT SELECT ON public.published_lessons TO wordwell_learner;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.profiles, public.sessions, public.deliveries, public.accepted_operations,
  public.learner_evidence, public.learner_choices, public.skipped_upcoming_words,
  public.reserved_upcoming_words, public.product_signals, public.passkeys,
  public.passkey_challenges, public.recovery_tokens, public.profile_access_events,
  public.profile_handoffs
TO wordwell_learner;
GRANT USAGE, SELECT ON SEQUENCE public.accepted_operations_accepted_order_seq TO wordwell_learner;

REVOKE ALL ON SCHEMA private FROM PUBLIC, wordwell_learner;
REVOKE ALL ON ALL TABLES IN SCHEMA private FROM PUBLIC, wordwell_learner, wordwell_pipeline;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA private FROM PUBLIC, wordwell_learner, wordwell_pipeline;
GRANT USAGE ON SCHEMA private TO wordwell_pipeline;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA private TO wordwell_pipeline;

-- Applies to objects created by the migration login, never by runtime jobs.
-- New public records are denied until their own migration grants access.
ALTER DEFAULT PRIVILEGES IN SCHEMA private GRANT SELECT, INSERT, UPDATE ON TABLES TO wordwell_pipeline;
ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
