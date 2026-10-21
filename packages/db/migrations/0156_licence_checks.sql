-- Licence checks against the regulators (roadmap Phase 3, feature 12): FSRA (Ontario) and the Insurance Council of
-- British Columbia first. Compliance looks a partner's licence up on the regulator's public register, saves the result
-- (a PDF or a screenshot) and uploads it; Google Gemini reads it and PII compares it with the licence on file. Compliance
-- confirms the outcome. Each check is kept with its evidence and sets the date of the next one. A licence the register
-- shows as suspended, revoked, lapsed or not found stops the partner being "cleared to transact" and tells compliance.
-- Ships switched off (LICENCE_CHECKS_ENABLED); changes no existing row.

CREATE TABLE licence_checks (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id),
  node_id          uuid NOT NULL,
  item_id          uuid NOT NULL REFERENCES compliance_items(id) ON DELETE CASCADE,
  regulator        text NOT NULL CHECK (regulator IN ('fsra_on', 'icbc_bc', 'other')),
  method           text NOT NULL CHECK (method IN ('register_read', 'manual')),
  status           text NOT NULL CHECK (status IN ('active', 'active_conditions', 'suspended', 'revoked', 'lapsed', 'not_found', 'unclear')),
  name_matches     boolean,
  number_matches   boolean,
  expiry_read      date,
  discipline_found boolean,
  evidence_id      uuid REFERENCES compliance_documents(id) ON DELETE SET NULL,
  note             text CHECK (note IS NULL OR char_length(note) <= 500),
  checked_by       uuid NOT NULL REFERENCES app_users(id),
  checked_by_name  text NOT NULL,
  checked_on       date NOT NULL DEFAULT current_date,
  next_due_on      date NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (node_id, tenant_id) REFERENCES org_nodes (id, tenant_id),
  CHECK (next_due_on > checked_on)
);
CREATE INDEX licence_checks_item ON licence_checks (item_id, created_at DESC);
ALTER TABLE licence_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE licence_checks FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_wall ON licence_checks AS RESTRICTIVE USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
-- Seen like the licence itself (the partner and everyone above it); recorded only by compliance or a tenant admin.
CREATE POLICY read_like_licence ON licence_checks FOR SELECT USING (org_node_at_or_below(tenant_id, node_id));
CREATE POLICY compliance_insert ON licence_checks FOR INSERT
  WITH CHECK ((app_is_tenant_admin() OR app_is_compliance_role()) AND app_can_write() AND org_node_at_or_below(tenant_id, node_id) AND checked_by = app_user_id());
REVOKE ALL ON licence_checks FROM app_runtime;
GRANT SELECT, INSERT ON licence_checks TO app_runtime;   -- a check is a record: never changed or deleted

CREATE FUNCTION licence_checks_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM compliance_items i WHERE i.id = NEW.item_id AND i.node_id = NEW.node_id AND i.kind = 'licence') THEN
    RAISE EXCEPTION 'A licence check belongs to a licence on file for that partner' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER licence_checks_guard BEFORE INSERT ON licence_checks FOR EACH ROW EXECUTE FUNCTION licence_checks_guard();

ALTER TABLE notifications DROP CONSTRAINT notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check CHECK (kind IN
  ('assigned', 'task_assigned', 'mention', 'note', 'stage_change', 'capture', 'merge_done', 'unsubscribed', 'invite_accepted', 'invite_stale',
   'compliance_expiry', 'compliance_review', 'appointment_request', 'thread_shared', 'document_added', 'learning_due', 'ce_reminder',
   'course_request', 'course_decision', 'quiz_attempts', 'team_overdue', 'aml_alert', 'vault_alert', 'first_week_late', 'onboarding_recheck',
   'advice_reviews_waiting', 'needs_review_due', 'advice_review_decided', 'licence_check'));
