-- Needs analysis, done properly (audit of 20 Oct 2026; PIA Compliance Manual Feb 2026).
--
--  * advice_records gains the structured fact-find (answers), the link from a recommendation to the needs analysis it answers, the flags a
--    reviewer should look at, and the day a needs analysis stops being current. Signed rows stay locked by the existing trigger.
--  * Two more kinds of paperwork can be required by a stage: recommendation and replacement disclosure.
--  * An upload typed as advice paperwork counts toward a gate only once a compliance person has verified it (paper signed in person).
--  * advice_reviews: the compliance review of signed advice (Manual §8 and §14). Decided reviews can never change; none can be deleted.
--  * The country life templates require privacy consent, a signed needs analysis and a signed recommendation before an application is
--    submitted, and pipelines already made from them get the same rule.

ALTER TABLE advice_records
  ADD COLUMN answers          jsonb CHECK (answers IS NULL OR jsonb_typeof(answers) = 'object'),
  ADD COLUMN linked_advice_id uuid REFERENCES advice_records(id) ON DELETE SET NULL,
  ADD COLUMN flags            text[] NOT NULL DEFAULT '{}',
  ADD COLUMN valid_until      date;
CREATE INDEX advice_records_linked ON advice_records (linked_advice_id) WHERE linked_advice_id IS NOT NULL;
CREATE INDEX advice_records_box_kind ON advice_records (box_id, kind, status);

-- Needs analyses signed before today were valid for the default twelve months.
ALTER TABLE advice_records DISABLE TRIGGER advice_records_lock;
UPDATE advice_records SET valid_until = ((signed_at AT TIME ZONE 'UTC')::date + interval '12 months')::date
 WHERE kind = 'needs_analysis' AND status = 'signed' AND valid_until IS NULL AND signed_at IS NOT NULL;
ALTER TABLE advice_records ENABLE TRIGGER advice_records_lock;

ALTER TABLE box_documents DROP CONSTRAINT box_documents_doc_type_check;
ALTER TABLE box_documents ADD CONSTRAINT box_documents_doc_type_check CHECK (doc_type IS NULL OR doc_type IN
  ('privacy_consent', 'brokerage_agreement', 'needs_analysis', 'id_record', 'pink_slip_optin', 'beneficiary_designation', 'recommendation', 'replacement_disclosure'));
ALTER TABLE stage_doc_requirements DROP CONSTRAINT stage_doc_requirements_doc_type_check;
ALTER TABLE stage_doc_requirements ADD CONSTRAINT stage_doc_requirements_doc_type_check CHECK (doc_type IN
  ('privacy_consent', 'brokerage_agreement', 'needs_analysis', 'id_record', 'pink_slip_optin', 'beneficiary_designation', 'recommendation', 'replacement_disclosure'));

ALTER TABLE box_documents
  ADD COLUMN verified_by   uuid REFERENCES app_users(id),
  ADD COLUMN verified_name text,
  ADD COLUMN verified_note text CHECK (verified_note IS NULL OR length(verified_note) BETWEEN 10 AND 500),
  ADD COLUMN verified_at   timestamptz,
  ADD COLUMN client_signed_on date;   -- for paper advice: the day the client signed it, which is when a needs analysis starts to age

-- A verification, once made, is permanent: it can be neither changed nor taken back, and a verified document cannot be removed.
CREATE FUNCTION box_documents_verify_lock() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.verified_at IS NOT NULL THEN RAISE EXCEPTION 'A verified document cannot be removed' USING ERRCODE = '42501'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.verified_at IS NOT NULL AND (NEW.verified_at IS DISTINCT FROM OLD.verified_at OR NEW.verified_by IS DISTINCT FROM OLD.verified_by
     OR NEW.verified_name IS DISTINCT FROM OLD.verified_name OR NEW.verified_note IS DISTINCT FROM OLD.verified_note
     OR NEW.client_signed_on IS DISTINCT FROM OLD.client_signed_on OR NEW.doc_type IS DISTINCT FROM OLD.doc_type) THEN
    RAISE EXCEPTION 'A verified document cannot have its verification or type changed' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER box_documents_verify_lock BEFORE UPDATE OR DELETE ON box_documents FOR EACH ROW EXECUTE FUNCTION box_documents_verify_lock();

CREATE TABLE advice_reviews (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  advice_id     uuid NOT NULL REFERENCES advice_records(id) ON DELETE RESTRICT,
  advisor_id    uuid NOT NULL REFERENCES app_users(id),
  reason        text NOT NULL CHECK (reason IN ('flagged', 'new_advisor', 'random', 'requested')),
  flags         text[] NOT NULL DEFAULT '{}',
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'passed', 'needs_action')),
  requested_by  uuid REFERENCES app_users(id),
  reviewer_id   uuid REFERENCES app_users(id),
  reviewer_name text,
  findings      text CHECK (findings IS NULL OR length(findings) BETWEEN 10 AND 4000),
  reviewed_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'pending') = (reviewed_at IS NULL)),
  CHECK (status = 'pending' OR (reviewer_id IS NOT NULL AND findings IS NOT NULL)),
  CHECK (reviewer_id IS NULL OR reviewer_id <> advisor_id),
  CHECK (status <> 'pending' OR (reviewer_id IS NULL AND reviewer_name IS NULL AND findings IS NULL))
);
CREATE UNIQUE INDEX advice_reviews_one_open ON advice_reviews (advice_id) WHERE status = 'pending';
CREATE INDEX advice_reviews_queue ON advice_reviews (tenant_id, status, created_at);
CREATE INDEX advice_reviews_advisor ON advice_reviews (advisor_id, created_at DESC);
ALTER TABLE advice_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE advice_reviews FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_wall ON advice_reviews AS RESTRICTIVE USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
CALL apply_visibility_policies('advice_reviews', 'EXISTS (SELECT 1 FROM advice_records a WHERE a.id = advice_id)');
REVOKE ALL ON advice_reviews FROM app_runtime;
GRANT SELECT, INSERT, UPDATE ON advice_reviews TO app_runtime;   -- no DELETE: the review trail stays whole

CREATE FUNCTION advice_reviews_lock() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'A decided compliance review cannot be changed' USING ERRCODE = '42501';
  END IF;
  IF NEW.advice_id <> OLD.advice_id OR NEW.advisor_id <> OLD.advisor_id OR NEW.reason <> OLD.reason OR NEW.flags <> OLD.flags OR NEW.created_at <> OLD.created_at
     OR NEW.tenant_id <> OLD.tenant_id OR NEW.requested_by IS DISTINCT FROM OLD.requested_by THEN
    RAISE EXCEPTION 'Only the outcome of a review can be recorded' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER advice_reviews_lock BEFORE UPDATE ON advice_reviews FOR EACH ROW EXECUTE FUNCTION advice_reviews_lock();
-- A review is always opened as pending; nobody can insert one already decided.
CREATE FUNCTION advice_reviews_open() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status <> 'pending' THEN RAISE EXCEPTION 'A review starts as pending' USING ERRCODE = '42501'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER advice_reviews_open BEFORE INSERT ON advice_reviews FOR EACH ROW EXECUTE FUNCTION advice_reviews_open();

ALTER TABLE notifications DROP CONSTRAINT notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check CHECK (kind IN
  ('assigned', 'task_assigned', 'mention', 'note', 'stage_change', 'capture', 'merge_done', 'unsubscribed', 'invite_accepted', 'invite_stale',
   'compliance_expiry', 'compliance_review', 'appointment_request', 'thread_shared', 'document_added', 'learning_due', 'ce_reminder',
   'course_request', 'course_decision', 'quiz_attempts', 'team_overdue', 'aml_alert', 'vault_alert', 'first_week_late', 'onboarding_recheck',
   'advice_reviews_waiting', 'needs_review_due', 'advice_review_decided'));

-- The country life templates: paperwork before an application goes in.
UPDATE pipeline_templates t SET version = t.version + 1, stages = (
  SELECT jsonb_agg(CASE WHEN e->>'en' = 'Application submitted' THEN e || '{"docs": ["privacy_consent", "needs_analysis", "recommendation"]}'::jsonb ELSE e END ORDER BY ord)
    FROM jsonb_array_elements(t.stages) WITH ORDINALITY AS x(e, ord))
 WHERE t.code IN ('ca_life_health', 'us_life');

-- The stage is found by name, or, where a partner renamed it, as the third stage (its place in the template).
INSERT INTO stage_doc_requirements (stage_id, doc_type, tenant_id)
SELECT s.id, d, s.tenant_id
  FROM pipelines p JOIN stages s ON s.pipeline_id = p.id
  CROSS JOIN unnest(ARRAY['privacy_consent', 'needs_analysis', 'recommendation']) AS d
 WHERE p.template_code IN ('ca_life_health', 'us_life') AND NOT s.is_won AND NOT s.is_lost
   AND (s.name IN ('Application submitted', 'Proposition soumise')
        OR (s.position = 3 AND NOT EXISTS (SELECT 1 FROM stages x WHERE x.pipeline_id = p.id AND x.name IN ('Application submitted', 'Proposition soumise'))))
ON CONFLICT DO NOTHING;
