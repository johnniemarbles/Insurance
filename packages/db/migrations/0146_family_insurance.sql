-- Families, Gate B (insurance): people on policies and deals by role, carrier rule profiles, evidence-based coverage.
--   * Additive only. No existing row changes; no party is ever filled in from family membership.
--   * Policy privacy: a policy is reachable through these tables only on the CRM wall, with the producer as owner and
--     the branch as location (producing partner, its managers above, the branch, tenant admin). policy_records itself
--     keeps its existing tenant wall; nothing here widens it.
--   * History is kept: party rows are ended, never rewritten.
--   * Beneficiary shares are checked per designation group (policy, insured life, primary or contingent) when a policy
--     is checked for submission, not while someone is drafting.

-- 1. Who may see a policy through family and party screens (same rule as clients and deals).
CREATE FUNCTION policy_visible(p_policy uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM policy_records p
                  WHERE p.id = p_policy AND crm_row_visible(p.tenant_id, p.producer_node_id, p.branch_node_id))
$$;

-- 2. Carrier rule profiles: what each carrier accepts on a policy. A tenant row overrides the default.
--    "confirmed_with_carrier" stays false until operations confirm the rules with the carrier (plan decision 6).
CREATE TABLE carrier_party_profiles (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                  uuid NOT NULL REFERENCES tenants(id),
  carrier_id                 text REFERENCES carrier_directory(id) ON DELETE CASCADE,   -- NULL = the tenant's default
  requires_owner             boolean NOT NULL DEFAULT true,
  requires_insured           boolean NOT NULL DEFAULT true,
  allows_joint_owner         boolean NOT NULL DEFAULT true,
  allows_joint_insured       boolean NOT NULL DEFAULT true,
  allows_estate_beneficiary  boolean NOT NULL DEFAULT true,
  allows_outside_beneficiary boolean NOT NULL DEFAULT true,
  allows_equal_shares        boolean NOT NULL DEFAULT true,
  allows_trustee             boolean NOT NULL DEFAULT true,
  confirmed_with_carrier     boolean NOT NULL DEFAULT false,
  notes                      text CHECK (notes IS NULL OR char_length(notes) <= 1000),
  updated_by                 uuid REFERENCES app_users(id) ON DELETE SET NULL,
  updated_at                 timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX carrier_party_profiles_one ON carrier_party_profiles (tenant_id, coalesce(carrier_id, ''));
ALTER TABLE carrier_party_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE carrier_party_profiles FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_wall ON carrier_party_profiles AS RESTRICTIVE USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
-- Everyone in the tenant may read the rules; only a tenant admin may change them.
CREATE POLICY read_all ON carrier_party_profiles FOR SELECT USING (true);
CREATE POLICY admin_write ON carrier_party_profiles FOR INSERT WITH CHECK (app_is_tenant_admin() AND app_can_write());
CREATE POLICY admin_update ON carrier_party_profiles FOR UPDATE USING (app_is_tenant_admin() AND app_can_write()) WITH CHECK (app_is_tenant_admin() AND app_can_write());
CREATE POLICY admin_delete ON carrier_party_profiles FOR DELETE USING (app_is_tenant_admin() AND app_can_write());

-- 3. People on policies.
CREATE TABLE policy_parties (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES tenants(id),
  policy_id             uuid NOT NULL REFERENCES policy_records(id) ON DELETE CASCADE,
  contact_id            uuid REFERENCES contacts(id) ON DELETE RESTRICT,
  -- Someone not kept as a client in PII (an outside beneficiary or trustee). Never used for the estate.
  outside_name          text CHECK (outside_name IS NULL OR char_length(outside_name) BETWEEN 1 AND 200),
  role                  text NOT NULL CHECK (role IN ('owner', 'joint_owner', 'insured', 'joint_insured', 'payor', 'beneficiary', 'trustee')),
  -- Beneficiaries only: which class, for whose life, and how the benefit is split inside that group.
  beneficiary_class     text CHECK (beneficiary_class IN ('primary', 'contingent')),
  insured_contact_id    uuid REFERENCES contacts(id) ON DELETE RESTRICT,
  allocation_method     text CHECK (allocation_method IN ('percentage', 'equal', 'estate')),
  share_basis_points    integer CHECK (share_basis_points BETWEEN 1 AND 10000),
  relationship_to_insured text CHECK (relationship_to_insured IS NULL OR char_length(relationship_to_insured) <= 60),
  source                text NOT NULL DEFAULT 'entered' CHECK (source IN ('entered', 'carrier_document', 'import')),
  source_note           text CHECK (source_note IS NULL OR char_length(source_note) <= 300),
  carrier_confirmed_at  timestamptz,
  started_at            timestamptz NOT NULL DEFAULT now(),
  ended_at              timestamptz,
  created_by            uuid REFERENCES app_users(id) ON DELETE SET NULL,
  ended_by              uuid REFERENCES app_users(id) ON DELETE SET NULL,
  CHECK (ended_at IS NULL OR ended_at >= started_at),
  -- Who: a client, or an outside person by name, or (estate beneficiaries) no one.
  CHECK (CASE WHEN allocation_method = 'estate' THEN contact_id IS NULL AND outside_name IS NULL
              ELSE (contact_id IS NULL) <> (outside_name IS NULL) END),
  -- Outside people may only be beneficiaries or trustees: owners, insureds and payors are clients.
  CHECK (outside_name IS NULL OR role IN ('beneficiary', 'trustee')),
  -- Beneficiary fields belong to beneficiaries only, and a beneficiary always has them.
  CHECK ((role = 'beneficiary') = (beneficiary_class IS NOT NULL)),
  CHECK ((role = 'beneficiary') = (allocation_method IS NOT NULL)),
  CHECK (role = 'beneficiary' OR (insured_contact_id IS NULL AND share_basis_points IS NULL)),
  CHECK ((allocation_method = 'percentage') = (share_basis_points IS NOT NULL))
);
-- The same person once per role per policy while open (a beneficiary once per class and insured life).
CREATE UNIQUE INDEX policy_parties_one_role ON policy_parties
  (policy_id, contact_id, role, coalesce(beneficiary_class, ''), coalesce(insured_contact_id, '00000000-0000-0000-0000-000000000000'))
  WHERE ended_at IS NULL AND contact_id IS NOT NULL;
CREATE INDEX policy_parties_policy ON policy_parties (tenant_id, policy_id, ended_at);
CREATE INDEX policy_parties_contact ON policy_parties (tenant_id, contact_id) WHERE contact_id IS NOT NULL;
ALTER TABLE policy_parties ENABLE ROW LEVEL SECURITY;
ALTER TABLE policy_parties FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_wall ON policy_parties AS RESTRICTIVE USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
CALL apply_visibility_policies('policy_parties',
  'policy_visible(policy_id)
   AND (contact_id IS NULL OR EXISTS (SELECT 1 FROM contacts c WHERE c.id = contact_id))
   AND (insured_contact_id IS NULL OR EXISTS (SELECT 1 FROM contacts c WHERE c.id = insured_contact_id))');

CREATE FUNCTION policy_parties_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE pol_tenant uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.ended_at IS NOT NULL THEN
      RAISE EXCEPTION 'An ended policy role cannot be changed' USING ERRCODE = '22023';
    END IF;
    IF NEW.policy_id <> OLD.policy_id OR NEW.contact_id IS DISTINCT FROM OLD.contact_id OR NEW.outside_name IS DISTINCT FROM OLD.outside_name
       OR NEW.role <> OLD.role OR NEW.beneficiary_class IS DISTINCT FROM OLD.beneficiary_class
       OR NEW.insured_contact_id IS DISTINCT FROM OLD.insured_contact_id OR NEW.started_at <> OLD.started_at OR NEW.tenant_id <> OLD.tenant_id THEN
      RAISE EXCEPTION 'A policy role keeps its policy, person and role; end it and add a new one instead' USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
  END IF;
  SELECT tenant_id INTO pol_tenant FROM policy_records WHERE id = NEW.policy_id;
  IF pol_tenant IS NULL OR pol_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'That policy was not found' USING ERRCODE = '22023';
  END IF;
  IF NEW.contact_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM contacts WHERE id = NEW.contact_id AND tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'That client was not found' USING ERRCODE = '22023';
  END IF;
  IF NEW.insured_contact_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM policy_parties i WHERE i.policy_id = NEW.policy_id AND i.contact_id = NEW.insured_contact_id
          AND i.role IN ('insured', 'joint_insured') AND i.ended_at IS NULL) THEN
    RAISE EXCEPTION 'A beneficiary''s insured life must be an insured person on the same policy' USING ERRCODE = '22023';
  END IF;
  IF NEW.ended_at IS NOT NULL THEN
    RAISE EXCEPTION 'A new policy role starts open' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER policy_parties_guard BEFORE INSERT OR UPDATE ON policy_parties
  FOR EACH ROW EXECUTE FUNCTION policy_parties_guard();

-- 4. People on deals (boxes), by role. Box contacts stay as they are; this adds the role.
CREATE TABLE deal_parties (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  box_id      uuid NOT NULL REFERENCES boxes(id) ON DELETE CASCADE,
  contact_id  uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  role        text NOT NULL CHECK (role IN ('applicant', 'co_applicant', 'insured', 'payor', 'beneficiary', 'representative')),
  started_at  timestamptz NOT NULL DEFAULT now(),
  ended_at    timestamptz,
  created_by  uuid REFERENCES app_users(id) ON DELETE SET NULL,
  ended_by    uuid REFERENCES app_users(id) ON DELETE SET NULL,
  CHECK (ended_at IS NULL OR ended_at >= started_at)
);
CREATE UNIQUE INDEX deal_parties_one_role ON deal_parties (box_id, contact_id, role) WHERE ended_at IS NULL;
CREATE INDEX deal_parties_box ON deal_parties (tenant_id, box_id);
ALTER TABLE deal_parties ENABLE ROW LEVEL SECURITY;
ALTER TABLE deal_parties FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_wall ON deal_parties AS RESTRICTIVE USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
CALL apply_visibility_policies('deal_parties',
  'EXISTS (SELECT 1 FROM boxes b WHERE b.id = box_id) AND EXISTS (SELECT 1 FROM contacts c WHERE c.id = contact_id)');

CREATE FUNCTION deal_parties_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE box_owner uuid; person_owner uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.ended_at IS NOT NULL THEN
      RAISE EXCEPTION 'An ended deal role cannot be changed' USING ERRCODE = '22023';
    END IF;
    IF NEW.box_id <> OLD.box_id OR NEW.contact_id <> OLD.contact_id OR NEW.role <> OLD.role OR NEW.started_at <> OLD.started_at THEN
      RAISE EXCEPTION 'A deal role keeps its deal, person and role; end it and add a new one instead' USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
  END IF;
  SELECT owner_node_id INTO box_owner FROM boxes WHERE id = NEW.box_id AND tenant_id = NEW.tenant_id;
  SELECT owner_node_id INTO person_owner FROM contacts WHERE id = NEW.contact_id AND tenant_id = NEW.tenant_id;
  IF box_owner IS NULL OR person_owner IS NULL THEN
    RAISE EXCEPTION 'That deal or client was not found' USING ERRCODE = '22023';
  END IF;
  IF box_owner <> person_owner THEN
    RAISE EXCEPTION 'A person on a deal must belong to the same partner as the deal' USING ERRCODE = '22023';
  END IF;
  IF NEW.ended_at IS NOT NULL THEN
    RAISE EXCEPTION 'A new deal role starts open' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER deal_parties_guard BEFORE INSERT OR UPDATE ON deal_parties
  FOR EACH ROW EXECUTE FUNCTION deal_parties_guard();

-- 5. Coverage lines: the grid's columns, configurable per tenant. The five defaults are created on first use by the API.
CREATE TABLE coverage_lines (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id),
  key        text NOT NULL CHECK (key ~ '^[a-z][a-z0-9_]{1,39}$'),
  label_en   text NOT NULL CHECK (char_length(label_en) BETWEEN 1 AND 60),
  label_fr   text NOT NULL CHECK (char_length(label_fr) BETWEEN 1 AND 60),
  position   integer NOT NULL DEFAULT 0,
  active     boolean NOT NULL DEFAULT true,
  UNIQUE (tenant_id, key)
);
ALTER TABLE coverage_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE coverage_lines FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_wall ON coverage_lines AS RESTRICTIVE USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
CREATE POLICY read_all ON coverage_lines FOR SELECT USING (true);
-- Any CRM writer may create the five defaults on first use; changing them is for tenant admins.
CREATE POLICY seed_or_admin ON coverage_lines FOR INSERT WITH CHECK (app_can_write());
CREATE POLICY admin_update ON coverage_lines FOR UPDATE USING (app_is_tenant_admin() AND app_can_write()) WITH CHECK (app_is_tenant_admin() AND app_can_write());

-- 6. Coverage assessments: evidence per person and line. No row means "unknown"; missing data is never a gap.
CREATE TABLE coverage_assessments (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES tenants(id),
  contact_id         uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  line_id            uuid NOT NULL REFERENCES coverage_lines(id) ON DELETE RESTRICT,
  state              text NOT NULL CHECK (state IN ('covered', 'potential_gap', 'unknown', 'declined')),
  -- Evidence: a policy on file, outside coverage the client described, or a signed needs analysis.
  policy_id          uuid REFERENCES policy_records(id) ON DELETE SET NULL,
  outside_coverage   text CHECK (outside_coverage IS NULL OR char_length(outside_coverage) BETWEEN 1 AND 300),
  needs_analysis_id  uuid REFERENCES advice_records(id) ON DELETE RESTRICT,
  note               text CHECK (note IS NULL OR char_length(note) <= 500),
  review_due_on      date,
  assessed_by        uuid REFERENCES app_users(id) ON DELETE SET NULL,
  assessed_at        timestamptz NOT NULL DEFAULT now(),
  superseded_at      timestamptz,
  -- "Covered" needs a policy on file or described outside coverage; a gap needs a signed needs analysis.
  CHECK (state <> 'covered' OR policy_id IS NOT NULL OR outside_coverage IS NOT NULL),
  CHECK (state <> 'potential_gap' OR needs_analysis_id IS NOT NULL)
);
CREATE UNIQUE INDEX coverage_assessments_current ON coverage_assessments (contact_id, line_id) WHERE superseded_at IS NULL;
CREATE INDEX coverage_assessments_contact ON coverage_assessments (tenant_id, contact_id, line_id, assessed_at DESC);
ALTER TABLE coverage_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE coverage_assessments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_wall ON coverage_assessments AS RESTRICTIVE USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
CALL apply_visibility_policies('coverage_assessments',
  'EXISTS (SELECT 1 FROM contacts c WHERE c.id = contact_id) AND (policy_id IS NULL OR policy_visible(policy_id))');

CREATE FUNCTION coverage_assessments_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.superseded_at IS NOT NULL THEN
      RAISE EXCEPTION 'A past coverage assessment cannot be changed' USING ERRCODE = '22023';
    END IF;
    IF NEW.state <> OLD.state OR NEW.contact_id <> OLD.contact_id OR NEW.line_id <> OLD.line_id
       OR NEW.policy_id IS DISTINCT FROM OLD.policy_id OR NEW.needs_analysis_id IS DISTINCT FROM OLD.needs_analysis_id THEN
      RAISE EXCEPTION 'Record a new assessment instead of changing one' USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.needs_analysis_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM advice_records a WHERE a.id = NEW.needs_analysis_id AND a.tenant_id = NEW.tenant_id
          AND a.kind = 'needs_analysis' AND a.status = 'signed') THEN
    RAISE EXCEPTION 'A potential gap must point to a signed needs analysis' USING ERRCODE = '22023';
  END IF;
  IF NEW.policy_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM policy_parties pp WHERE pp.policy_id = NEW.policy_id AND pp.contact_id = NEW.contact_id
          AND pp.role IN ('owner', 'joint_owner', 'insured', 'joint_insured') AND pp.ended_at IS NULL) THEN
    RAISE EXCEPTION 'Coverage from a policy needs this person on that policy as owner or insured' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER coverage_assessments_guard BEFORE INSERT OR UPDATE ON coverage_assessments
  FOR EACH ROW EXECUTE FUNCTION coverage_assessments_guard();
