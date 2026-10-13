-- Public consumer storage only. Generation, approval and durable lesson publication
-- are owned by the pipeline publisher, not by the learner API.
CREATE TABLE published_practice_items (
  item_id text NOT NULL,
  publication_version integer NOT NULL CHECK (publication_version > 0),
  lesson_id text NOT NULL REFERENCES published_lessons(id) ON DELETE CASCADE,
  record jsonb NOT NULL,
  available boolean NOT NULL DEFAULT true,
  PRIMARY KEY (item_id, publication_version),
  CHECK (record->>'schemaVersion' = 'wordwell-practice-v1'),
  CHECK (record->>'itemId' = item_id),
  CHECK ((record->>'publicationVersion')::integer = publication_version),
  CHECK (record->>'lessonId' = lesson_id)
);
CREATE UNIQUE INDEX published_practice_current_item ON published_practice_items(item_id) WHERE available;
