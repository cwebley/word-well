ALTER TABLE profiles
  ADD COLUMN starting_band text NOT NULL DEFAULT 'Stretch my vocabulary';

ALTER TABLE sessions
  ADD COLUMN time_zone text NOT NULL DEFAULT 'UTC';

ALTER TABLE published_lessons
  ADD COLUMN starting_band text NOT NULL DEFAULT 'Stretch my vocabulary';

CREATE TABLE skipped_upcoming_words (
  profile_id uuid NOT NULL REFERENCES profiles(id),
  normalized_headword text NOT NULL,
  skipped_at timestamptz NOT NULL,
  PRIMARY KEY (profile_id, normalized_headword)
);

CREATE TABLE reserved_upcoming_words (
  id uuid PRIMARY KEY,
  profile_id uuid NOT NULL REFERENCES profiles(id),
  lesson_id text NOT NULL REFERENCES published_lessons(id),
  normalized_headword text NOT NULL,
  reserved_at timestamptz NOT NULL,
  UNIQUE (profile_id, lesson_id),
  UNIQUE (profile_id, normalized_headword)
);

CREATE INDEX reserved_upcoming_words_profile_order_idx
  ON reserved_upcoming_words(profile_id, reserved_at, id);
