ALTER TABLE skipped_upcoming_words
  ADD COLUMN upcoming_id uuid;

CREATE UNIQUE INDEX skipped_upcoming_words_profile_upcoming_idx
  ON skipped_upcoming_words(profile_id, upcoming_id);
