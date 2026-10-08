-- A charged completion without sufficient routing proof is terminal, distinct
-- from rejected routing, invalid content and uncertain request accounting.
ALTER TABLE private.attempts DROP CONSTRAINT attempts_status_check;
ALTER TABLE private.attempts ADD CONSTRAINT attempts_status_check
  CHECK (status IN ('pending', 'valid', 'invalid', 'failed', 'uncertain', 'response_lost', 'verification_unresolved'));
