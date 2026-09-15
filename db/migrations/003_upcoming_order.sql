ALTER TABLE reserved_upcoming_words
  ADD COLUMN queue_position integer;

WITH ranked AS (
  SELECT id, row_number() OVER (PARTITION BY profile_id ORDER BY reserved_at, id) AS position
  FROM reserved_upcoming_words
)
UPDATE reserved_upcoming_words
   SET queue_position = ranked.position
  FROM ranked
 WHERE reserved_upcoming_words.id = ranked.id;

ALTER TABLE reserved_upcoming_words
  ALTER COLUMN queue_position SET NOT NULL;

ALTER TABLE reserved_upcoming_words
  ADD CONSTRAINT reserved_upcoming_words_profile_position_key UNIQUE (profile_id, queue_position);
