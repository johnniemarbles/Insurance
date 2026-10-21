-- Conduct risk flags (roadmap Phase 3, feature 11). Explainable rules first, a model only once there are outcomes to
-- learn from. PII works the flags out from what it already holds (advice, policies, complaints) every time compliance
-- looks; nothing is scored silently. Each flag says why, with the numbers. Compliance records what it decided about a
-- flag ("no concern" or "action taken", with a note); the flag stays quiet until its numbers change.
-- Complaints are new: a simple log on the deal, recorded by the advisor or compliance, resolved by compliance.
-- Ships switched off (CONDUCT_FLAGS_ENABLED); changes no existing row.

CREATE TABLE client_complaints (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  box_id          uuid NOT NULL REFERENCES boxes(id) ON DELETE CASCADE,
  advisor_id      uuid REFERENCES app_users(id),
  received_on     date NOT NULL,
  channel         text NOT NULL CHECK (channel IN ('email', 'phone', 'letter', 'in_person', 'regulator', 'carrier', 'other')),
  category        text NOT NULL CHECK (category IN ('advice', 'service', 'disclosure', 'claims', 'premium', 'privacy', 'conduct', 'other')),
  summary         text NOT NULL CHECK (char_length(summary) BETWEEN 10 AND 2000),
  recorded_by     uuid NOT NULL REFERENCES app_users(id),
  recorded_by_name text NOT NULL,
  status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  outcome         text CHECK (outcome IS NULL OR char_length(outcome) BETWEEN 10 AND 2000),
  resolved_on     date,
  resolved_by_name text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'resolved') = (outcome IS NOT NULL AND resolved_on IS NOT NULL))
);
CREATE INDEX client_complaints_box ON client_complaints (box_id, received_on DESC);
CREATE INDEX client_complaints_advisor ON client_complaints (tenant_id, advisor_id, received_on);
ALTER TABLE client_complaints ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_complaints FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_wall ON client_complaints AS RESTRICTIVE USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
CALL apply_visibility_policies('client_complaints', 'EXISTS (SELECT 1 FROM boxes b WHERE b.id = box_id)');
REVOKE ALL ON client_complaints FROM app_runtime;
GRANT SELECT, INSERT, UPDATE (status, outcome, resolved_on, resolved_by_name) ON client_complaints TO app_runtime;
CREATE FUNCTION client_complaints_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.recorded_by IS DISTINCT FROM app_user_id() THEN
    RAISE EXCEPTION 'A complaint is recorded as the person recording it' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'resolved' THEN RAISE EXCEPTION 'A resolved complaint cannot be changed' USING ERRCODE = '42501'; END IF;
    IF NOT (app_is_tenant_admin() OR app_is_compliance_role()) THEN RAISE EXCEPTION 'Only compliance resolves a complaint' USING ERRCODE = '42501'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER client_complaints_guard BEFORE INSERT OR UPDATE ON client_complaints FOR EACH ROW EXECUTE FUNCTION client_complaints_guard();

-- What compliance decided about a flag. The fingerprint holds the flag's numbers: when they change, the flag is open again.
CREATE TABLE conduct_flag_reviews (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  subject_type  text NOT NULL CHECK (subject_type IN ('advisor', 'client', 'deal')),
  subject_id    uuid NOT NULL,
  code          text NOT NULL CHECK (code ~ '^[a-z_]{3,40}$'),
  fingerprint   text NOT NULL CHECK (char_length(fingerprint) <= 200),
  decision      text NOT NULL CHECK (decision IN ('no_concern', 'action_taken')),
  note          text NOT NULL CHECK (char_length(note) BETWEEN 10 AND 2000),
  decided_by    uuid NOT NULL REFERENCES app_users(id),
  decided_by_name text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX conduct_flag_reviews_subject ON conduct_flag_reviews (tenant_id, subject_type, subject_id, code, created_at DESC);
ALTER TABLE conduct_flag_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE conduct_flag_reviews FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_wall ON conduct_flag_reviews AS RESTRICTIVE USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
-- Compliance work only: compliance and tenant admins read and write; partners never see flags about themselves here.
CREATE POLICY compliance_read ON conduct_flag_reviews FOR SELECT USING (app_is_tenant_admin() OR app_is_compliance_role());
CREATE POLICY compliance_insert ON conduct_flag_reviews FOR INSERT WITH CHECK ((app_is_tenant_admin() OR app_is_compliance_role()) AND app_can_write() AND decided_by = app_user_id());
REVOKE ALL ON conduct_flag_reviews FROM app_runtime;
GRANT SELECT, INSERT ON conduct_flag_reviews TO app_runtime;
