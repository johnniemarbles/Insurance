-- Supervision rules and escalation (roadmap Phase 2, feature 9). Compliance writes rules without code: "when a deal
-- (in this pipeline, of this product line, in this province, of at least this value or cover) enters this stage (or any
-- won stage), it needs this extra paperwork and/or a compliance review". A review request goes to compliance's queue
-- with a deadline; an overdue one escalates to a named person (or every compliance officer). The deal cannot enter the
-- stage until the paperwork is on file (or waived) and the review is approved.
-- Ships switched off (SUPERVISION_ENABLED); changes no existing row.

CREATE TABLE supervision_rules (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id),
  name             text NOT NULL CHECK (char_length(name) BETWEEN 3 AND 120),
  active           boolean NOT NULL DEFAULT true,
  risk             text NOT NULL DEFAULT 'medium' CHECK (risk IN ('low', 'medium', 'high')),
  -- When: a pipeline (or any), a stage in it (or any won stage), and optional facts about the deal.
  pipeline_id      uuid REFERENCES pipelines(id) ON DELETE CASCADE,
  stage_id         uuid REFERENCES stages(id) ON DELETE CASCADE,
  min_deal_value   numeric(14,2) CHECK (min_deal_value IS NULL OR min_deal_value >= 0),
  min_coverage     numeric(14,2) CHECK (min_coverage IS NULL OR min_coverage >= 0),
  product_line     text CHECK (product_line IS NULL OR product_line IN ('life_health', 'annuity')),
  province         text CHECK (province IS NULL OR province ~ '^[A-Z]{2}$'),
  replacing_only   boolean NOT NULL DEFAULT false,
  -- Then: extra paperwork, and/or a compliance review with a deadline and an escalation.
  required_docs    text[] NOT NULL DEFAULT '{}' CHECK (cardinality(required_docs) <= 10 AND required_docs <@ ARRAY['privacy_consent', 'brokerage_agreement', 'needs_analysis', 'id_record',
                     'pink_slip_optin', 'beneficiary_designation', 'recommendation', 'replacement_disclosure', 'suitability_review']::text[]),
  review_required  boolean NOT NULL DEFAULT false,
  review_hours     int NOT NULL DEFAULT 48 CHECK (review_hours BETWEEN 1 AND 720),
  escalate_to      uuid REFERENCES app_users(id),
  updated_by_name  text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (stage_id IS NULL OR pipeline_id IS NOT NULL),
  CHECK (review_required OR cardinality(required_docs) > 0)
);
CREATE INDEX supervision_rules_tenant ON supervision_rules (tenant_id) WHERE active;
ALTER TABLE supervision_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE supervision_rules FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_wall ON supervision_rules AS RESTRICTIVE USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
CREATE POLICY read_all ON supervision_rules FOR SELECT USING (true);
CREATE POLICY compliance_insert ON supervision_rules FOR INSERT WITH CHECK ((app_is_tenant_admin() OR app_is_compliance_role()) AND app_can_write());
CREATE POLICY compliance_update ON supervision_rules FOR UPDATE
  USING ((app_is_tenant_admin() OR app_is_compliance_role()) AND app_can_write())
  WITH CHECK ((app_is_tenant_admin() OR app_is_compliance_role()) AND app_can_write());
REVOKE ALL ON supervision_rules FROM app_runtime;
GRANT SELECT, INSERT, UPDATE ON supervision_rules TO app_runtime;

CREATE TABLE supervision_reviews (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES tenants(id),
  box_id             uuid NOT NULL REFERENCES boxes(id) ON DELETE CASCADE,
  rule_id            uuid NOT NULL REFERENCES supervision_rules(id),
  status             text NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
  requested_by       uuid NOT NULL REFERENCES app_users(id),
  requested_by_name  text NOT NULL,
  request_note       text CHECK (request_note IS NULL OR char_length(request_note) <= 1000),
  due_at             timestamptz NOT NULL,
  escalated_at       timestamptz,
  decided_by         uuid REFERENCES app_users(id),
  decided_by_name    text,
  decision_note      text CHECK (decision_note IS NULL OR char_length(decision_note) BETWEEN 10 AND 1000),
  decided_at         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX supervision_reviews_one_pending ON supervision_reviews (box_id, rule_id) WHERE status = 'pending';
CREATE INDEX supervision_reviews_queue ON supervision_reviews (tenant_id, status, due_at);
ALTER TABLE supervision_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE supervision_reviews FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_wall ON supervision_reviews AS RESTRICTIVE USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
CALL apply_visibility_policies('supervision_reviews', 'EXISTS (SELECT 1 FROM boxes b WHERE b.id = box_id)');
REVOKE ALL ON supervision_reviews FROM app_runtime;
GRANT SELECT, INSERT, UPDATE (status, escalated_at, decided_by, decided_by_name, decision_note, decided_at) ON supervision_reviews TO app_runtime;

CREATE FUNCTION supervision_reviews_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.requested_by IS DISTINCT FROM app_user_id() THEN
      RAISE EXCEPTION 'A review is requested as the person asking for it' USING ERRCODE = '42501';
    END IF;
    IF NEW.status <> 'pending' THEN RAISE EXCEPTION 'A new review starts pending' USING ERRCODE = '22023'; END IF;
    RETURN NEW;
  END IF;
  IF OLD.status <> 'pending' AND (NEW.status, NEW.decided_by, NEW.decision_note) IS DISTINCT FROM (OLD.status, OLD.decided_by, OLD.decision_note) THEN
    RAISE EXCEPTION 'A decided review cannot be changed' USING ERRCODE = '42501';
  END IF;
  IF NEW.status <> OLD.status THEN
    IF NEW.decided_by IS DISTINCT FROM app_user_id() THEN
      RAISE EXCEPTION 'A review decision is recorded as the person making it' USING ERRCODE = '42501';
    END IF;
    IF NEW.decided_by = OLD.requested_by THEN
      RAISE EXCEPTION 'The person who asked for a review cannot decide it' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER supervision_reviews_guard BEFORE INSERT OR UPDATE ON supervision_reviews FOR EACH ROW EXECUTE FUNCTION supervision_reviews_guard();

-- The background sweep finds overdue reviews across companies with the sign-in role: these columns only.
GRANT SELECT (id, tenant_id, box_id, rule_id, status, requested_by, due_at, escalated_at) ON supervision_reviews TO app_auth;
GRANT SELECT (id, name, escalate_to) ON supervision_rules TO app_auth;
