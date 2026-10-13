-- Definition/POS changes, removals and new split/merge identities retire the old
-- bank permanently. Reordering and teaching-text edits keep the bank intact.
CREATE FUNCTION invalidate_changed_meaning_practice() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.published_practice_items p SET available = false
    WHERE p.lesson_id = NEW.id AND p.available AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(NEW.record->'meanings') meaning
        WHERE meaning->>'id' = p.record->>'meaningId'
          AND meaning->>'definition' = p.record->>'definition'
          AND meaning->>'partOfSpeech' = p.record->>'partOfSpeech'
    );
  RETURN NEW;
END;
$$;
CREATE TRIGGER invalidate_changed_meaning_practice AFTER UPDATE OF record ON public.published_lessons
  FOR EACH ROW EXECUTE FUNCTION invalidate_changed_meaning_practice();
