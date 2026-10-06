-- These serial counters belong to learner writes, not lesson publication.
GRANT USAGE, SELECT ON SEQUENCE public.product_signals_id_seq,
  public.profile_access_events_id_seq TO wordwell_learner;
