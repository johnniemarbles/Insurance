-- Families, Gate C (regulated compliance): a per-person consent ledger, legal authority with evidence and independent
-- verification, person-level ID references, dated capacity rules per jurisdiction, and review queues for coming of age
-- and life events.
--
-- Ships switched off (FAMILIES_COMPLIANCE_ENABLED). Adds tables, functions and one optional client column; changes no
-- existing row. Existing deal-level consents and ID records stay exactly as they are and are never relabelled.
--
-- Principles held here, not only in the API:
--   * Consent is per person and per purpose. Someone else may give it only under a verified, in-date legal authority
--     whose scope covers that purpose.
--   * Authority is recorded by one person and verified by another (compliance at or above the client's partner, or a
--     tenant admin). Unverified, rejected, ended or out-of-date authority enables nothing.
--   * No raw ID numbers or images: an ID reference stores the method, document types seen, outcome and who checked.
--   * Reviews (coming of age, life events, withdrawals) open work for a person to do; they change nothing on their own.

ALTER TABLE contacts
  ADD COLUMN residence_jurisdiction text CHECK (residence_jurisdiction IS NULL OR residence_jurisdiction ~ '^(CA|US)-[A-Z]{2}$');

-- ---------------------------------------------------------------- capacity rules
-- A dated rules table per jurisdiction and activity. The seeded age-of-majority rows are public statute ages and are
-- marked unconfirmed until counsel confirms them; other activities are added by compliance with counsel.
CREATE TABLE capacity_rules (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid NOT NULL REFERENCES tenants(id),
  jurisdiction           text NOT NULL CHECK (jurisdiction ~ '^(CA|US)-[A-Z]{2}$'),
  activity               text NOT NULL CHECK (activity IN ('age_of_majority', 'privacy_consent', 'apply_for_insurance', 'own_policy', 'receive_benefit')),
  min_age                integer NOT NULL CHECK (min_age BETWEEN 0 AND 25),
  effective_from         date NOT NULL,
  effective_to           date,
  source_note            text NOT NULL CHECK (char_length(source_note) BETWEEN 3 AND 300),
  counsel_confirmed_at   timestamptz,
  counsel_confirmed_by   text CHECK (counsel_confirmed_by IS NULL OR char_length(counsel_confirmed_by) BETWEEN 2 AND 200),
  created_by_name        text NOT NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CHECK ((counsel_confirmed_at IS NULL) = (counsel_confirmed_by IS NULL))
);
CREATE UNIQUE INDEX capacity_rules_one_open ON capacity_rules (tenant_id, jurisdiction, activity, effective_from);
ALTER TABLE capacity_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE capacity_rules FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_wall ON capacity_rules AS RESTRICTIVE USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
CREATE POLICY read_all ON capacity_rules FOR SELECT USING (true);
-- Compliance or a tenant admin add rules. Anyone else may only add the unconfirmed statute default for a jurisdiction
-- that has no age-of-majority rule yet (the first read seeds these for the company).
CREATE POLICY seed_or_compliance ON capacity_rules FOR INSERT WITH CHECK (app_can_write() AND (
  app_is_tenant_admin() OR app_is_compliance_role()
  OR (activity = 'age_of_majority' AND min_age IN (18, 19) AND counsel_confirmed_at IS NULL AND effective_to IS NULL
      AND created_by_name = 'PII default (provincial statute)'
      AND NOT EXISTS (SELECT 1 FROM capacity_rules x WHERE x.tenant_id = app_tenant_id() AND x.jurisdiction = capacity_rules.jurisdiction
                         AND x.activity = 'age_of_majority'))));
CREATE POLICY compliance_update ON capacity_rules FOR UPDATE
  USING ((app_is_tenant_admin() OR app_is_compliance_role()) AND app_can_write())
  WITH CHECK ((app_is_tenant_admin() OR app_is_compliance_role()) AND app_can_write());
REVOKE ALL ON capacity_rules FROM app_runtime;
GRANT SELECT, INSERT, UPDATE (effective_to, counsel_confirmed_at, counsel_confirmed_by) ON capacity_rules TO app_runtime;
CREATE FUNCTION capacity_rules_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.counsel_confirmed_at IS NOT NULL AND NEW.counsel_confirmed_at IS DISTINCT FROM OLD.counsel_confirmed_at THEN
    RAISE EXCEPTION 'Counsel''s confirmation is kept; close the rule and add a new one instead' USING ERRCODE = '22023';
  END IF;
  IF OLD.effective_to IS NOT NULL AND NEW.effective_to IS DISTINCT FROM OLD.effective_to THEN
    RAISE EXCEPTION 'A closed rule stays closed' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER capacity_rules_guard BEFORE UPDATE ON capacity_rules FOR EACH ROW EXECUTE FUNCTION capacity_rules_guard();

-- The rule in force for a jurisdiction and activity on a date (NULL when none is set).
CREATE FUNCTION capacity_rule_on(p_jurisdiction text, p_activity text, p_on date)
RETURNS capacity_rules LANGUAGE sql STABLE AS $$
  SELECT r.* FROM capacity_rules r
   WHERE r.jurisdiction = p_jurisdiction AND r.activity = p_activity
     AND r.effective_from <= p_on AND (r.effective_to IS NULL OR r.effective_to >= p_on)
   ORDER BY r.effective_from DESC LIMIT 1
$$;

-- ---------------------------------------------------------------- legal authority
CREATE TABLE legal_authorities (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES tenants(id),
  owner_node_id         uuid NOT NULL REFERENCES org_nodes(id),
  context_node_id       uuid REFERENCES org_nodes(id),
  subject_contact_id    uuid NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,   -- the person acted for
  holder_contact_id     uuid REFERENCES contacts(id) ON DELETE RESTRICT,            -- a client who holds the authority
  holder_name           text CHECK (holder_name IS NULL OR char_length(holder_name) BETWEEN 2 AND 200), -- or someone outside PII
  kind                  text NOT NULL CHECK (kind IN ('guardian_of_minor', 'poa_property', 'poa_personal_care', 'court_appointed', 'other_representative')),
  -- What the holder may do: give these consents, and (policy_changes) act on the person's policies and deals.
  purposes              text[] NOT NULL CHECK (cardinality(purposes) BETWEEN 1 AND 6
                          AND purposes <@ ARRAY['collection_use', 'carrier_sharing', 'electronic_comms', 'pink_slip_optin', 'marketing', 'policy_changes']::text[]),
  starts_on             date NOT NULL,
  ends_on               date,
  evidence_description  text NOT NULL CHECK (char_length(evidence_description) BETWEEN 10 AND 500),
  evidence_document_id  uuid REFERENCES box_documents(id) ON DELETE SET NULL,
  status                text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'rejected')),
  recorded_by           uuid NOT NULL REFERENCES app_users(id),
  recorded_by_name      text NOT NULL,
  recorded_at           timestamptz NOT NULL DEFAULT now(),
  decided_by            uuid REFERENCES app_users(id),
  decided_by_name       text,
  decided_at            timestamptz,
  decision_note         text CHECK (decision_note IS NULL OR char_length(decision_note) <= 500),
  ended_at              timestamptz,
  ended_by_name         text,
  end_reason            text CHECK (end_reason IN ('expired', 'revoked', 'subject_came_of_age', 'subject_deceased', 'holder_deceased', 'entered_in_error', 'replaced')),
  CHECK ((holder_contact_id IS NULL) <> (holder_name IS NULL)),
  CHECK (holder_contact_id IS NULL OR holder_contact_id <> subject_contact_id),
  CHECK (ends_on IS NULL OR ends_on >= starts_on),
  CHECK ((status = 'pending') = (decided_at IS NULL)),
  CHECK (decided_by IS NULL OR decided_by <> recorded_by),
  CHECK ((ended_at IS NULL) = (end_reason IS NULL))
);
CREATE INDEX legal_authorities_subject ON legal_authorities (tenant_id, subject_contact_id);
CREATE INDEX legal_authorities_holder ON legal_authorities (tenant_id, holder_contact_id) WHERE holder_contact_id IS NOT NULL;
CREATE INDEX legal_authorities_pending ON legal_authorities (tenant_id, recorded_at) WHERE status = 'pending' AND ended_at IS NULL;
ALTER TABLE legal_authorities ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_authorities FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_wall ON legal_authorities AS RESTRICTIVE USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
CALL apply_visibility_policies('legal_authorities',
  'crm_row_visible(tenant_id, owner_node_id, context_node_id)
   AND EXISTS (SELECT 1 FROM contacts c WHERE c.id = subject_contact_id)
   AND (holder_contact_id IS NULL OR EXISTS (SELECT 1 FROM contacts c WHERE c.id = holder_contact_id))');
REVOKE ALL ON legal_authorities FROM app_runtime;
GRANT SELECT, INSERT, UPDATE (status, decided_by, decided_by_name, decided_at, decision_note, ended_at, ended_by_name, end_reason)
  ON legal_authorities TO app_runtime;

CREATE FUNCTION legal_authorities_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE subj contacts%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.ended_at IS NOT NULL THEN
      RAISE EXCEPTION 'An ended authority cannot be changed' USING ERRCODE = '22023';
    END IF;
    IF OLD.status <> 'pending' AND (NEW.status <> OLD.status OR NEW.decided_at IS DISTINCT FROM OLD.decided_at) THEN
      RAISE EXCEPTION 'This authority has already been decided' USING ERRCODE = '22023';
    END IF;
    IF OLD.status = 'pending' AND NEW.status <> 'pending' THEN
      IF NEW.decided_by IS DISTINCT FROM app_user_id() THEN
        RAISE EXCEPTION 'The decision is recorded as the person making it' USING ERRCODE = '42501';
      END IF;
      IF NEW.decided_by = OLD.recorded_by THEN
        RAISE EXCEPTION 'The person who recorded an authority cannot verify it' USING ERRCODE = '42501';
      END IF;
      IF NOT app_is_compliance_at_or_above(NEW.tenant_id, NEW.owner_node_id) THEN
        RAISE EXCEPTION 'Only compliance for this partner, or a tenant admin, can verify an authority' USING ERRCODE = '42501';
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO subj FROM contacts WHERE id = NEW.subject_contact_id AND tenant_id = NEW.tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'That client was not found' USING ERRCODE = '22023'; END IF;
  IF NEW.owner_node_id <> subj.owner_node_id THEN
    RAISE EXCEPTION 'An authority belongs to the partner who serves the client' USING ERRCODE = '22023';
  END IF;
  IF NEW.holder_contact_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM contacts h WHERE h.id = NEW.holder_contact_id AND h.tenant_id = NEW.tenant_id AND h.owner_node_id = subj.owner_node_id) THEN
    RAISE EXCEPTION 'The holder must be a client of the same partner, or entered by name' USING ERRCODE = '22023';
  END IF;
  IF NEW.status <> 'pending' OR NEW.ended_at IS NOT NULL THEN
    RAISE EXCEPTION 'A new authority starts pending verification' USING ERRCODE = '22023';
  END IF;
  IF NEW.recorded_by IS DISTINCT FROM app_user_id() THEN
    RAISE EXCEPTION 'An authority is recorded as the person entering it' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER legal_authorities_guard BEFORE INSERT OR UPDATE ON legal_authorities
  FOR EACH ROW EXECUTE FUNCTION legal_authorities_guard();

-- Whether an authority lets its holder act for this purpose on this date.
CREATE FUNCTION authority_in_effect(p_authority uuid, p_purpose text, p_on date) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM legal_authorities a
                  WHERE a.id = p_authority AND a.status = 'verified' AND a.ended_at IS NULL
                    AND a.starts_on <= p_on AND (a.ends_on IS NULL OR a.ends_on >= p_on)
                    AND p_purpose = ANY (a.purposes))
$$;

-- ---------------------------------------------------------------- person consent ledger
CREATE TABLE person_consents (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES tenants(id),
  owner_node_id         uuid NOT NULL REFERENCES org_nodes(id),
  context_node_id       uuid REFERENCES org_nodes(id),
  contact_id            uuid NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
  purpose               text NOT NULL CHECK (purpose IN ('collection_use', 'carrier_sharing', 'electronic_comms', 'pink_slip_optin', 'marketing')),
  -- all_dealings: every deal with this partner; deal: the one deal named.
  scope                 text NOT NULL CHECK (scope IN ('all_dealings', 'deal')),
  box_id                uuid REFERENCES boxes(id) ON DELETE RESTRICT,
  notice_version        text NOT NULL CHECK (char_length(notice_version) BETWEEN 1 AND 40),
  channel               text NOT NULL CHECK (channel IN ('in_person', 'phone', 'email', 'esign')),
  granted_on            date NOT NULL,
  given_by              text NOT NULL CHECK (given_by IN ('self', 'authority')),
  authority_id          uuid REFERENCES legal_authorities(id) ON DELETE RESTRICT,
  -- Set when the person is under a capacity rule's age and consented themselves after a partner's review.
  capacity_reviewed_note text CHECK (capacity_reviewed_note IS NULL OR char_length(capacity_reviewed_note) BETWEEN 10 AND 500),
  evidence_document_id  uuid REFERENCES box_documents(id) ON DELETE SET NULL,
  note                  text CHECK (note IS NULL OR char_length(note) <= 500),
  recorded_by           uuid NOT NULL REFERENCES app_users(id),
  recorded_by_name      text NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  withdrawn_at          timestamptz,
  withdrawn_on          date,
  withdrawn_by_name     text,
  withdrawal_channel    text CHECK (withdrawal_channel IN ('in_person', 'phone', 'email', 'esign', 'letter')),
  withdrawn_note        text CHECK (withdrawn_note IS NULL OR char_length(withdrawn_note) <= 500),
  CHECK ((scope = 'deal') = (box_id IS NOT NULL)),
  CHECK ((given_by = 'authority') = (authority_id IS NOT NULL)),
  CHECK ((withdrawn_at IS NULL) = (withdrawn_on IS NULL)),
  CHECK (withdrawn_on IS NULL OR withdrawn_on >= granted_on)
);
CREATE INDEX person_consents_contact ON person_consents (tenant_id, contact_id, purpose, created_at DESC);
ALTER TABLE person_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE person_consents FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_wall ON person_consents AS RESTRICTIVE USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
CALL apply_visibility_policies('person_consents',
  'crm_row_visible(tenant_id, owner_node_id, context_node_id) AND EXISTS (SELECT 1 FROM contacts c WHERE c.id = contact_id)');
REVOKE ALL ON person_consents FROM app_runtime;
GRANT SELECT, INSERT, UPDATE (withdrawn_at, withdrawn_on, withdrawn_by_name, withdrawal_channel, withdrawn_note) ON person_consents TO app_runtime;

CREATE FUNCTION person_consents_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE subj contacts%ROWTYPE; auth legal_authorities%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.withdrawn_at IS NOT NULL THEN
      RAISE EXCEPTION 'This consent has already been withdrawn' USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO subj FROM contacts WHERE id = NEW.contact_id AND tenant_id = NEW.tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'That client was not found' USING ERRCODE = '22023'; END IF;
  IF NEW.owner_node_id <> subj.owner_node_id THEN
    RAISE EXCEPTION 'A consent belongs to the partner who serves the client' USING ERRCODE = '22023';
  END IF;
  IF NEW.box_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM box_contacts bc WHERE bc.box_id = NEW.box_id AND bc.contact_id = NEW.contact_id
       UNION ALL
       SELECT 1 FROM deal_parties dp WHERE dp.box_id = NEW.box_id AND dp.contact_id = NEW.contact_id AND dp.ended_at IS NULL) THEN
    RAISE EXCEPTION 'A deal consent needs this person on that deal' USING ERRCODE = '22023';
  END IF;
  IF NEW.authority_id IS NOT NULL THEN
    SELECT * INTO auth FROM legal_authorities WHERE id = NEW.authority_id AND tenant_id = NEW.tenant_id;
    IF NOT FOUND OR auth.subject_contact_id <> NEW.contact_id THEN
      RAISE EXCEPTION 'That authority is not for this person' USING ERRCODE = '22023';
    END IF;
    IF NOT authority_in_effect(NEW.authority_id, NEW.purpose, NEW.granted_on) THEN
      RAISE EXCEPTION 'Consent for someone else needs a verified, in-date authority that covers this purpose' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF NEW.withdrawn_at IS NOT NULL THEN
    RAISE EXCEPTION 'A new consent starts in force' USING ERRCODE = '22023';
  END IF;
  IF NEW.recorded_by IS DISTINCT FROM app_user_id() THEN
    RAISE EXCEPTION 'A consent is recorded as the person entering it' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER person_consents_guard BEFORE INSERT OR UPDATE ON person_consents
  FOR EACH ROW EXECUTE FUNCTION person_consents_guard();

-- Which deals rely on which person consent. A consent is used for a deal only when purpose, scope, notice version and
-- authority all still match (checked by the API and again here).
CREATE TABLE consent_uses (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id),
  consent_id   uuid NOT NULL REFERENCES person_consents(id) ON DELETE RESTRICT,
  box_id       uuid NOT NULL REFERENCES boxes(id) ON DELETE CASCADE,
  used_by      uuid NOT NULL REFERENCES app_users(id),
  used_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (consent_id, box_id)
);
CREATE INDEX consent_uses_box ON consent_uses (tenant_id, box_id);
ALTER TABLE consent_uses ENABLE ROW LEVEL SECURITY;
ALTER TABLE consent_uses FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_wall ON consent_uses AS RESTRICTIVE USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
CALL apply_visibility_policies('consent_uses',
  'EXISTS (SELECT 1 FROM boxes b WHERE b.id = box_id) AND EXISTS (SELECT 1 FROM person_consents p WHERE p.id = consent_id)');
REVOKE ALL ON consent_uses FROM app_runtime;
GRANT SELECT, INSERT ON consent_uses TO app_runtime;

-- Whether a person consent is in force for a purpose on a deal today: not withdrawn, covering that deal, and (when
-- given under authority) the authority still in effect.
CREATE FUNCTION person_consent_in_force(p_consent uuid, p_box uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM person_consents c
                  WHERE c.id = p_consent AND c.withdrawn_at IS NULL
                    AND (c.scope = 'all_dealings' OR c.box_id = p_box)
                    AND (c.authority_id IS NULL OR authority_in_effect(c.authority_id, c.purpose, current_date)))
$$;

CREATE FUNCTION consent_uses_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c person_consents%ROWTYPE;
BEGIN
  SELECT * INTO c FROM person_consents WHERE id = NEW.consent_id AND tenant_id = NEW.tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'That consent was not found' USING ERRCODE = '22023'; END IF;
  IF NOT person_consent_in_force(NEW.consent_id, NEW.box_id) THEN
    RAISE EXCEPTION 'That consent is withdrawn, does not cover this deal, or its authority is no longer in effect' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM box_contacts bc WHERE bc.box_id = NEW.box_id AND bc.contact_id = c.contact_id
                 UNION ALL
                 SELECT 1 FROM deal_parties dp WHERE dp.box_id = NEW.box_id AND dp.contact_id = c.contact_id AND dp.ended_at IS NULL) THEN
    RAISE EXCEPTION 'That person is not on this deal' USING ERRCODE = '22023';
  END IF;
  IF NEW.used_by IS DISTINCT FROM app_user_id() THEN
    RAISE EXCEPTION 'A consent use is recorded as the person making it' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER consent_uses_guard BEFORE INSERT ON consent_uses FOR EACH ROW EXECUTE FUNCTION consent_uses_guard();

-- ---------------------------------------------------------------- ID references
-- What was checked for a person, how, by whom and with what result. Never the number on the document, never an image.
CREATE TABLE identity_references (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES tenants(id),
  owner_node_id         uuid NOT NULL REFERENCES org_nodes(id),
  context_node_id       uuid REFERENCES org_nodes(id),
  contact_id            uuid NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
  method                text NOT NULL CHECK (method IN ('in_person', 'credit_file', 'dual_process')),
  documents_seen        text[] NOT NULL DEFAULT '{}' CHECK (cardinality(documents_seen) <= 5
                          AND documents_seen <@ ARRAY['passport', 'drivers_licence', 'provincial_id', 'permanent_resident_card', 'citizenship_card',
                                                     'birth_certificate', 'credit_file', 'utility_bill', 'bank_statement', 'government_letter', 'other']::text[]),
  result                text NOT NULL CHECK (result IN ('verified', 'failed', 'referred')),
  checked_on            date NOT NULL,
  checked_by            uuid NOT NULL REFERENCES app_users(id),
  checked_by_name       text NOT NULL,
  evidence_document_id  uuid REFERENCES box_documents(id) ON DELETE SET NULL,
  note                  text CHECK (note IS NULL OR char_length(note) <= 300),
  created_at            timestamptz NOT NULL DEFAULT now(),
  -- A note is not the place for a document number: reject anything with a run of 6 or more digits.
  CHECK (note IS NULL OR note !~ '[0-9]{6,}')
);
CREATE INDEX identity_references_contact ON identity_references (tenant_id, contact_id, checked_on DESC);
ALTER TABLE identity_references ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity_references FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_wall ON identity_references AS RESTRICTIVE USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
CALL apply_visibility_policies('identity_references',
  'crm_row_visible(tenant_id, owner_node_id, context_node_id) AND EXISTS (SELECT 1 FROM contacts c WHERE c.id = contact_id)');
REVOKE ALL ON identity_references FROM app_runtime;
GRANT SELECT, INSERT ON identity_references TO app_runtime;
CREATE FUNCTION identity_references_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM contacts c WHERE c.id = NEW.contact_id AND c.tenant_id = NEW.tenant_id AND c.owner_node_id = NEW.owner_node_id) THEN
    RAISE EXCEPTION 'An ID reference belongs to the partner who serves the client' USING ERRCODE = '22023';
  END IF;
  IF NEW.checked_by IS DISTINCT FROM app_user_id() THEN
    RAISE EXCEPTION 'An ID check is recorded as the person who did it' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER identity_references_guard BEFORE INSERT ON identity_references FOR EACH ROW EXECUTE FUNCTION identity_references_guard();

-- Which deal roles need an ID check and how long one stays current. Set by compliance; empty means "no rule set".
CREATE TABLE id_check_rules (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid NOT NULL REFERENCES tenants(id),
  deal_role              text NOT NULL CHECK (deal_role IN ('applicant', 'co_applicant', 'insured', 'payor', 'beneficiary', 'representative')),
  required               boolean NOT NULL,
  valid_months           integer CHECK (valid_months IS NULL OR valid_months BETWEEN 1 AND 120),
  note                   text CHECK (note IS NULL OR char_length(note) <= 300),
  set_by_name            text NOT NULL,
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, deal_role)
);
ALTER TABLE id_check_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE id_check_rules FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_wall ON id_check_rules AS RESTRICTIVE USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
CREATE POLICY read_all ON id_check_rules FOR SELECT USING (true);
CREATE POLICY compliance_insert ON id_check_rules FOR INSERT WITH CHECK ((app_is_tenant_admin() OR app_is_compliance_role()) AND app_can_write());
CREATE POLICY compliance_update ON id_check_rules FOR UPDATE
  USING ((app_is_tenant_admin() OR app_is_compliance_role()) AND app_can_write())
  WITH CHECK ((app_is_tenant_admin() OR app_is_compliance_role()) AND app_can_write());
REVOKE DELETE ON id_check_rules FROM app_runtime;

-- ---------------------------------------------------------------- life events and reviews
CREATE TABLE life_events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id),
  owner_node_id     uuid NOT NULL REFERENCES org_nodes(id),
  context_node_id   uuid REFERENCES org_nodes(id),
  contact_id        uuid NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
  kind              text NOT NULL CHECK (kind IN ('separation', 'death', 'guardianship_change', 'move', 'marriage_partnership', 'birth_adoption', 'other')),
  occurred_on       date NOT NULL,
  note              text CHECK (note IS NULL OR char_length(note) <= 500),
  recorded_by       uuid NOT NULL REFERENCES app_users(id),
  recorded_by_name  text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX life_events_contact ON life_events (tenant_id, contact_id, occurred_on DESC);
ALTER TABLE life_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE life_events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_wall ON life_events AS RESTRICTIVE USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
CALL apply_visibility_policies('life_events',
  'crm_row_visible(tenant_id, owner_node_id, context_node_id) AND EXISTS (SELECT 1 FROM contacts c WHERE c.id = contact_id)');
REVOKE ALL ON life_events FROM app_runtime;
GRANT SELECT, INSERT ON life_events TO app_runtime;
CREATE FUNCTION life_events_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM contacts c WHERE c.id = NEW.contact_id AND c.tenant_id = NEW.tenant_id AND c.owner_node_id = NEW.owner_node_id) THEN
    RAISE EXCEPTION 'A life event belongs to the partner who serves the client' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER life_events_guard BEFORE INSERT ON life_events FOR EACH ROW EXECUTE FUNCTION life_events_guard();

-- Work for a person to do. Opening a review changes nothing else; resolving one records who decided what.
CREATE TABLE compliance_reviews (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id),
  owner_node_id     uuid NOT NULL REFERENCES org_nodes(id),
  context_node_id   uuid REFERENCES org_nodes(id),
  contact_id        uuid NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
  kind              text NOT NULL CHECK (kind IN ('coming_of_age', 'life_event', 'consent_withdrawn', 'authority_ending')),
  -- What prompted it: one of these, never more than one.
  life_event_id     uuid REFERENCES life_events(id) ON DELETE RESTRICT,
  consent_id        uuid REFERENCES person_consents(id) ON DELETE RESTRICT,
  authority_id      uuid REFERENCES legal_authorities(id) ON DELETE RESTRICT,
  rule_id           uuid REFERENCES capacity_rules(id) ON DELETE RESTRICT,
  -- coming_of_age: the date the rule's age is reached (one review per person, rule and date).
  milestone_on      date,
  -- The records a person should look at: [{type, id, label}]. Labels are what the opener could see.
  items             jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(items) = 'array'),
  due_on            date NOT NULL,
  opened_at         timestamptz NOT NULL DEFAULT now(),
  resolved_at       timestamptz,
  resolved_by_name  text,
  resolution_note   text CHECK (resolution_note IS NULL OR char_length(resolution_note) BETWEEN 5 AND 500),
  CHECK ((resolved_at IS NULL) = (resolution_note IS NULL)),
  CHECK (num_nonnulls(life_event_id, consent_id, authority_id, rule_id) <= 1),
  CHECK (kind <> 'coming_of_age' OR (rule_id IS NOT NULL AND milestone_on IS NOT NULL)),
  CHECK (kind <> 'life_event' OR life_event_id IS NOT NULL),
  CHECK (kind <> 'consent_withdrawn' OR consent_id IS NOT NULL),
  CHECK (kind <> 'authority_ending' OR authority_id IS NOT NULL)
);
CREATE UNIQUE INDEX compliance_reviews_coming_of_age ON compliance_reviews (contact_id, rule_id, milestone_on) WHERE kind = 'coming_of_age';
CREATE UNIQUE INDEX compliance_reviews_authority ON compliance_reviews (authority_id) WHERE kind = 'authority_ending';
CREATE INDEX compliance_reviews_open ON compliance_reviews (tenant_id, due_on) WHERE resolved_at IS NULL;
CREATE INDEX compliance_reviews_contact ON compliance_reviews (tenant_id, contact_id);
ALTER TABLE compliance_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance_reviews FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_wall ON compliance_reviews AS RESTRICTIVE USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
CALL apply_visibility_policies('compliance_reviews',
  'crm_row_visible(tenant_id, owner_node_id, context_node_id) AND EXISTS (SELECT 1 FROM contacts c WHERE c.id = contact_id)');
REVOKE ALL ON compliance_reviews FROM app_runtime;
GRANT SELECT, INSERT, UPDATE (resolved_at, resolved_by_name, resolution_note) ON compliance_reviews TO app_runtime;
CREATE FUNCTION compliance_reviews_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.resolved_at IS NOT NULL THEN
      RAISE EXCEPTION 'This review is already resolved' USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM contacts c WHERE c.id = NEW.contact_id AND c.tenant_id = NEW.tenant_id AND c.owner_node_id = NEW.owner_node_id) THEN
    RAISE EXCEPTION 'A review belongs to the partner who serves the client' USING ERRCODE = '22023';
  END IF;
  IF NEW.resolved_at IS NOT NULL THEN
    RAISE EXCEPTION 'A new review starts open' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER compliance_reviews_guard BEFORE INSERT OR UPDATE ON compliance_reviews
  FOR EACH ROW EXECUTE FUNCTION compliance_reviews_guard();
