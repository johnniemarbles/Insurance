-- Families (Gate A): a Family groups separate client records (contacts) for servicing, letters and totals.
-- It never owns a member's personal data and gives no one authority over another person.
--   * Additive only: new tables and optional contact columns. No family is created for existing clients
--     (they are shown as a family of one until someone builds a family), and no existing row changes.
--   * Privacy: a family uses the same CRM wall as contacts (owner partner, its managers above, the location the
--     Head's record is marked for, tenant admin; sibling partners never). Member and relationship rows are visible
--     only when every client in them is.
--   * One servicing partner per family: every member, and both people in a relationship, belong to the
--     family's (or each other's) owning partner. Enforced here, not only in the API.
--   * History is kept: memberships and relationships are ended, never rewritten.

-- 1. Optional person details used by families (age shown on the family card; never decides capacity on its own).
ALTER TABLE contacts
  ADD COLUMN date_of_birth      date CHECK (date_of_birth IS NULL OR date_of_birth >= DATE '1900-01-01'),
  ADD COLUMN preferred_language text CHECK (preferred_language IS NULL OR char_length(preferred_language) BETWEEN 2 AND 20),
  ADD COLUMN deceased_on        date CHECK (deceased_on IS NULL OR deceased_on >= DATE '1900-01-01');

-- 2. Families
CREATE TABLE families (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES tenants(id),
  owner_node_id      uuid NOT NULL REFERENCES org_nodes(id),
  -- The location the Head's client record is marked for (the API keeps it in step when the Head changes), so a
  -- location manager who sees the Head sees the family, exactly as for the clients themselves.
  context_node_id    uuid REFERENCES org_nodes(id),
  display_name       text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 120),
  salutation         text CHECK (salutation IS NULL OR char_length(salutation) BETWEEN 1 AND 200),
  mailing_address    text CHECK (mailing_address IS NULL OR char_length(mailing_address) BETWEEN 1 AND 500),
  mailing_preference text NOT NULL DEFAULT 'head' CHECK (mailing_preference IN ('head', 'each_adult')),
  status             text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  version            integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_by         uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  archived_at        timestamptz,
  CHECK ((status = 'archived') = (archived_at IS NOT NULL))
);
CREATE INDEX families_owner ON families (tenant_id, owner_node_id, status);
CREATE INDEX families_name_trgm ON families USING gin (display_name gin_trgm_ops);
ALTER TABLE families ENABLE ROW LEVEL SECURITY;
ALTER TABLE families FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_wall ON families AS RESTRICTIVE USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
CALL apply_visibility_policies('families', 'crm_row_visible(tenant_id, owner_node_id, context_node_id)');

-- 3. Memberships: who is in which family, in what role, from when to when.
CREATE TABLE family_memberships (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  family_id   uuid NOT NULL REFERENCES families(id) ON DELETE RESTRICT,
  contact_id  uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  role        text NOT NULL CHECK (role IN ('head', 'spouse_partner', 'child', 'dependent', 'other')),
  started_at  timestamptz NOT NULL DEFAULT now(),
  ended_at    timestamptz,
  end_reason  text CHECK (end_reason IN ('left', 'moved', 'separated', 'deceased', 'entered_in_error', 'family_archived')),
  created_by  uuid REFERENCES app_users(id) ON DELETE SET NULL,
  ended_by    uuid REFERENCES app_users(id) ON DELETE SET NULL,
  CHECK (ended_at IS NULL OR ended_at >= started_at),
  CHECK ((ended_at IS NULL) = (end_reason IS NULL))
);
-- One active family per person, and one active Head per family: held by the database, so two requests at once cannot break them.
CREATE UNIQUE INDEX family_memberships_one_active_family ON family_memberships (contact_id) WHERE ended_at IS NULL;
CREATE UNIQUE INDEX family_memberships_one_head ON family_memberships (family_id) WHERE role = 'head' AND ended_at IS NULL;
CREATE INDEX family_memberships_family ON family_memberships (tenant_id, family_id, ended_at);
CREATE INDEX family_memberships_contact ON family_memberships (tenant_id, contact_id, started_at DESC);
ALTER TABLE family_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE family_memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_wall ON family_memberships AS RESTRICTIVE USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
CALL apply_visibility_policies('family_memberships',
  'EXISTS (SELECT 1 FROM families f WHERE f.id = family_id) AND EXISTS (SELECT 1 FROM contacts c WHERE c.id = contact_id)');

CREATE FUNCTION family_memberships_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE fam_owner uuid; fam_status text; fam_tenant uuid; person_owner uuid; person_tenant uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.ended_at IS NOT NULL THEN
      RAISE EXCEPTION 'An ended family membership cannot be changed' USING ERRCODE = '22023';
    END IF;
    IF NEW.family_id <> OLD.family_id OR NEW.contact_id <> OLD.contact_id OR NEW.started_at <> OLD.started_at
       OR NEW.tenant_id <> OLD.tenant_id OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
      RAISE EXCEPTION 'A membership keeps its family, person and start date; end it and add a new one instead' USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
  END IF;
  SELECT owner_node_id, status, tenant_id INTO fam_owner, fam_status, fam_tenant FROM families WHERE id = NEW.family_id;
  SELECT owner_node_id, tenant_id INTO person_owner, person_tenant FROM contacts WHERE id = NEW.contact_id;
  IF fam_owner IS NULL OR person_owner IS NULL THEN
    RAISE EXCEPTION 'That family or client was not found' USING ERRCODE = '22023';
  END IF;
  IF fam_tenant <> NEW.tenant_id OR person_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'That family or client was not found' USING ERRCODE = '22023';
  END IF;
  IF fam_status <> 'active' THEN
    RAISE EXCEPTION 'That family is archived' USING ERRCODE = '22023';
  END IF;
  IF fam_owner <> person_owner THEN
    RAISE EXCEPTION 'A family member must belong to the same partner as the family' USING ERRCODE = '22023';
  END IF;
  IF NEW.ended_at IS NOT NULL THEN
    RAISE EXCEPTION 'A new membership starts open' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER family_memberships_guard BEFORE INSERT OR UPDATE ON family_memberships
  FOR EACH ROW EXECUTE FUNCTION family_memberships_guard();

-- 4. Relationships between two people. Never a source of authority (that is a separate, evidenced record in Gate C).
--    Symmetric kinds are stored once, lower id first; directional kinds read "a is <kind> b" (a parent_of b).
CREATE TABLE person_relationships (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id),
  person_a_id  uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  person_b_id  uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  kind         text NOT NULL CHECK (kind IN ('spouse_partner', 'sibling', 'parent_of', 'grandparent_of', 'other')),
  note         text CHECK (note IS NULL OR char_length(note) BETWEEN 1 AND 200),
  started_at   timestamptz NOT NULL DEFAULT now(),
  ended_at     timestamptz,
  created_by   uuid REFERENCES app_users(id) ON DELETE SET NULL,
  ended_by     uuid REFERENCES app_users(id) ON DELETE SET NULL,
  CHECK (person_a_id <> person_b_id),
  CHECK (kind IN ('parent_of', 'grandparent_of') OR person_a_id < person_b_id),
  CHECK (ended_at IS NULL OR ended_at >= started_at)
);
-- One open link of a kind per pair, whichever way round (so "A parent of B" and "B parent of A" cannot both stand).
CREATE UNIQUE INDEX person_relationships_one_open ON person_relationships
  (LEAST(person_a_id, person_b_id), GREATEST(person_a_id, person_b_id), kind) WHERE ended_at IS NULL;
CREATE INDEX person_relationships_a ON person_relationships (tenant_id, person_a_id);
CREATE INDEX person_relationships_b ON person_relationships (tenant_id, person_b_id);
ALTER TABLE person_relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE person_relationships FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_wall ON person_relationships AS RESTRICTIVE USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
CALL apply_visibility_policies('person_relationships',
  'EXISTS (SELECT 1 FROM contacts c WHERE c.id = person_a_id) AND EXISTS (SELECT 1 FROM contacts c WHERE c.id = person_b_id)');

CREATE FUNCTION person_relationships_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a_owner uuid; b_owner uuid; a_tenant uuid; b_tenant uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.ended_at IS NOT NULL THEN
      RAISE EXCEPTION 'An ended relationship cannot be changed' USING ERRCODE = '22023';
    END IF;
    IF NEW.person_a_id <> OLD.person_a_id OR NEW.person_b_id <> OLD.person_b_id OR NEW.kind <> OLD.kind
       OR NEW.started_at <> OLD.started_at OR NEW.tenant_id <> OLD.tenant_id THEN
      RAISE EXCEPTION 'A relationship keeps its people and kind; end it and add a new one instead' USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
  END IF;
  SELECT owner_node_id, tenant_id INTO a_owner, a_tenant FROM contacts WHERE id = NEW.person_a_id;
  SELECT owner_node_id, tenant_id INTO b_owner, b_tenant FROM contacts WHERE id = NEW.person_b_id;
  IF a_owner IS NULL OR b_owner IS NULL OR a_tenant <> NEW.tenant_id OR b_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'That client was not found' USING ERRCODE = '22023';
  END IF;
  IF a_owner <> b_owner THEN
    RAISE EXCEPTION 'Both people must belong to the same partner' USING ERRCODE = '22023';
  END IF;
  IF NEW.ended_at IS NOT NULL THEN
    RAISE EXCEPTION 'A new relationship starts open' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER person_relationships_guard BEFORE INSERT OR UPDATE ON person_relationships
  FOR EACH ROW EXECUTE FUNCTION person_relationships_guard();
