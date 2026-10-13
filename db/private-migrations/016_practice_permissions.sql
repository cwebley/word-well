GRANT SELECT ON public.published_practice_items TO wordwell_learner;
GRANT USAGE ON SCHEMA public TO wordwell_pipeline;
GRANT SELECT, INSERT ON public.published_practice_items TO wordwell_pipeline;
GRANT UPDATE (available) ON public.published_practice_items TO wordwell_pipeline;

-- Preserve the served version even when an item is withdrawn or replaced.
CREATE FUNCTION preserve_practice_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.item_id IS DISTINCT FROM OLD.item_id OR NEW.publication_version IS DISTINCT FROM OLD.publication_version
    OR NEW.lesson_id IS DISTINCT FROM OLD.lesson_id OR NEW.record IS DISTINCT FROM OLD.record THEN
    RAISE EXCEPTION 'Practice revisions are immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER preserve_practice_revision BEFORE UPDATE ON public.published_practice_items
  FOR EACH ROW EXECUTE FUNCTION preserve_practice_revision();
