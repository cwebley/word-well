-- CHECK accepts NULL unless we reject it explicitly. Missing identity fields
-- must not turn an incomplete item into available public content.
ALTER TABLE published_practice_items ADD CONSTRAINT practice_identity_required CHECK ((
  record->>'schemaVersion' = 'wordwell-practice-v1'
  AND record->>'itemId' = item_id
  AND (record->>'publicationVersion')::integer = publication_version
  AND record->>'lessonId' = lesson_id
) IS TRUE);
