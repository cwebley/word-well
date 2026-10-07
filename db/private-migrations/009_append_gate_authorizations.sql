-- Current permission can change while a run is paused. Append its assessment,
-- promotion and upstream identities rather than discarding the new permission.
ALTER TABLE private.reuse_authorizations DROP CONSTRAINT reuse_authorizations_pkey;
ALTER TABLE private.reuse_authorizations ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE private.reuse_authorizations ADD PRIMARY KEY(id);
ALTER TABLE private.reuse_authorizations ADD UNIQUE NULLS NOT DISTINCT
  (run_id,result_id,assessment_id,promotion_id,appropriateness_result_id);
