-- Electronic ID verification (roadmap Phase 2, feature 7). A client's driver's licence and a selfie are checked one of
-- two ways, chosen by the company: Stripe Identity (the client opens a link on their phone), or PII's own check (Google
-- Gemini reads the licence photo and compares the selfie; the advisor who has the photos confirms, and compliance
-- decides anything that does not match).
--
-- What PII keeps: who was checked, how, the outcome, and yes/no answers for each check (name, date of birth, not expired,
-- selfie, genuine-looking). Never the licence number, never the photos, never the name or birth date as read: those
-- are compared and dropped. A verified check adds an ID record (method 'electronic') that the deal's paperwork gates
-- already count. Ships switched off (EID_ENABLED); changes no existing row.

-- 1. Which routes a company uses. Set by a tenant admin or compliance; everyone in the company may read it.
CREATE TABLE tenant_eid (
  tenant_id          uuid PRIMARY KEY REFERENCES tenants(id),
  stripe_enabled     boolean NOT NULL DEFAULT false,
  own_check_enabled  boolean NOT NULL DEFAULT false,
  -- Ask Stripe to delete the photos and personal data on its side once PII has the outcome.
  redact_at_stripe   boolean NOT NULL DEFAULT true,
  updated_by_name    text NOT NULL,
  updated_at         timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE tenant_eid ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_eid FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_wall ON tenant_eid AS RESTRICTIVE USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
CREATE POLICY read_all ON tenant_eid FOR SELECT USING (true);
CREATE POLICY admin_insert ON tenant_eid FOR INSERT WITH CHECK ((app_is_tenant_admin() OR app_is_compliance_role()) AND app_can_write());
CREATE POLICY admin_update ON tenant_eid FOR UPDATE
  USING ((app_is_tenant_admin() OR app_is_compliance_role()) AND app_can_write())
  WITH CHECK ((app_is_tenant_admin() OR app_is_compliance_role()) AND app_can_write());
REVOKE ALL ON tenant_eid FROM app_runtime;
GRANT SELECT, INSERT, UPDATE ON tenant_eid TO app_runtime;

-- 2. One electronic check of one client on one deal.
CREATE TABLE id_verifications (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES tenants(id),
  box_id             uuid NOT NULL REFERENCES boxes(id) ON DELETE CASCADE,
  contact_id         uuid NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
  route              text NOT NULL CHECK (route IN ('stripe', 'own_check')),
  status             text NOT NULL CHECK (status IN ('link_sent', 'processing', 'needs_input', 'needs_confirmation', 'needs_review', 'verified', 'failed', 'canceled')),
  stripe_session_id  text UNIQUE CHECK (stripe_session_id IS NULL OR stripe_session_id ~ '^vs_[A-Za-z0-9_]{6,100}$'),
  document_type      text CHECK (document_type IS NULL OR document_type IN ('drivers_licence', 'other')),
  issuing_region     text CHECK (issuing_region IS NULL OR issuing_region ~ '^[A-Z]{2}(-[A-Z]{2})?$'),
  -- Yes/no answers only (name_matches, dob_matches, not_expired, selfie_matches, looks_genuine). Checked by the trigger.
  checks             jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Short codes explaining a "no" (name_mismatch, dob_missing_on_record, stripe:document_expired, ...). No free text.
  reasons            text[] NOT NULL DEFAULT '{}' CHECK (cardinality(reasons) <= 12),
  requested_by       uuid NOT NULL REFERENCES app_users(id),
  requested_by_name  text NOT NULL,
  decided_by         uuid REFERENCES app_users(id),
  decided_by_name    text,
  decided_at         timestamptz,
  decision_note      text CHECK (decision_note IS NULL OR (char_length(decision_note) <= 300 AND decision_note !~ '[0-9]{6,}')),
  redacted_at_stripe timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CHECK ((route = 'stripe') = (stripe_session_id IS NOT NULL))
);
CREATE INDEX id_verifications_box ON id_verifications (box_id, created_at DESC);
CREATE INDEX id_verifications_review ON id_verifications (tenant_id, status) WHERE status = 'needs_review';
ALTER TABLE id_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE id_verifications FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_wall ON id_verifications AS RESTRICTIVE USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
CALL apply_visibility_policies('id_verifications', 'EXISTS (SELECT 1 FROM boxes b WHERE b.id = box_id)');
REVOKE ALL ON id_verifications FROM app_runtime;
GRANT SELECT, INSERT, UPDATE (status, document_type, issuing_region, checks, reasons, decided_by, decided_by_name, decided_at, decision_note, redacted_at_stripe, updated_at)
  ON id_verifications TO app_runtime;

CREATE FUNCTION id_verifications_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF jsonb_typeof(NEW.checks) <> 'object'
     OR EXISTS (SELECT 1 FROM jsonb_each(NEW.checks) e
                WHERE e.key NOT IN ('name_matches', 'dob_matches', 'not_expired', 'selfie_matches', 'looks_genuine')
                   OR jsonb_typeof(e.value) NOT IN ('boolean', 'null')) THEN
    RAISE EXCEPTION 'ID checks keep yes/no answers only' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(NEW.reasons) r WHERE r !~ '^[a-z][a-z0-9_:]{1,60}$') THEN
    RAISE EXCEPTION 'ID check reasons are short codes only' USING ERRCODE = '22023';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.requested_by IS DISTINCT FROM app_user_id() THEN
      RAISE EXCEPTION 'An ID check is requested as the person asking for it' USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM box_contacts bc WHERE bc.box_id = NEW.box_id AND bc.contact_id = NEW.contact_id) THEN
      RAISE EXCEPTION 'The person checked must be a client on this deal' USING ERRCODE = '22023';
    END IF;
  ELSE
    IF OLD.status IN ('verified', 'failed', 'canceled') AND (NEW.status, NEW.checks, NEW.reasons, NEW.decided_by, NEW.decision_note)
         IS DISTINCT FROM (OLD.status, OLD.checks, OLD.reasons, OLD.decided_by, OLD.decision_note) THEN
      RAISE EXCEPTION 'A finished ID check cannot be changed' USING ERRCODE = '42501';
    END IF;
    IF NEW.decided_by IS DISTINCT FROM OLD.decided_by AND NEW.decided_by IS DISTINCT FROM app_user_id() THEN
      RAISE EXCEPTION 'An ID decision is recorded as the person making it' USING ERRCODE = '42501';
    END IF;
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER id_verifications_guard BEFORE INSERT OR UPDATE ON id_verifications FOR EACH ROW EXECUTE FUNCTION id_verifications_guard();

-- 3. A verified electronic check becomes an ID record the deal's gates count. Only a check can make one.
DO $$ DECLARE c text; BEGIN
  SELECT conname INTO c FROM pg_constraint WHERE conrelid = 'client_id_records'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%in_person%';
  EXECUTE format('ALTER TABLE client_id_records DROP CONSTRAINT %I', c);
END $$;
ALTER TABLE client_id_records
  ADD CONSTRAINT client_id_records_method_check CHECK (method IN ('in_person', 'credit_file', 'dual_process', 'electronic')),
  ADD COLUMN verification_id uuid UNIQUE REFERENCES id_verifications(id),
  ADD CONSTRAINT client_id_records_electronic_has_check CHECK ((method = 'electronic') = (verification_id IS NOT NULL));
CREATE FUNCTION client_id_records_electronic_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.verification_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM id_verifications v WHERE v.id = NEW.verification_id AND v.box_id = NEW.box_id AND v.status = 'verified') THEN
    RAISE EXCEPTION 'An electronic ID record needs a verified check on the same deal' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER client_id_records_electronic_guard BEFORE INSERT ON client_id_records FOR EACH ROW EXECUTE FUNCTION client_id_records_electronic_guard();
