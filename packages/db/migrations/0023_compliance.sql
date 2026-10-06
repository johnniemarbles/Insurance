-- Partner compliance: business profile, licences, errors and omissions (E&O) insurance, agreement status,
-- carrier appointments and the documents that prove them. Everything is stored in PII (no outside vendor).
--
-- Who sees what:
--  * A partner sees their own record and the records of everyone beneath them (a producer under an agency).
--    Never the people above them or beside them: an agency's tax details are not for its producers.
--  * A company administrator sees everything in their company.
--  * Head office compliance staff see every company in the same country (this deployment) through a few narrow,
--    read-and-review-only functions. They have no access to CRM records.

-- 1. Roles, notices, residency -------------------------------------------------------------------------
ALTER TYPE org_role ADD VALUE IF NOT EXISTS 'compliance';

ALTER TABLE tenants ADD COLUMN is_head_office boolean NOT NULL DEFAULT false;
-- Only bootstrap (the database owner) may mark a company as head office; a company administrator must not be able to.
REVOKE UPDATE ON tenants FROM app_runtime;
GRANT UPDATE (name, default_locale) ON tenants TO app_runtime;

ALTER TABLE notifications DROP CONSTRAINT notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check CHECK (kind IN
  ('assigned', 'task_assigned', 'mention', 'note', 'stage_change', 'capture', 'merge_done', 'unsubscribed', 'invite_accepted', 'invite_stale',
   'compliance_expiry', 'compliance_review', 'appointment_request'));

-- A deployment may be hosted outside the region its companies belong to (for example Canadian companies on a US host)
-- only when that has been decided and recorded. The privacy page says where data is kept.
ALTER TABLE deployment_info
  ADD COLUMN residency_acknowledged boolean NOT NULL DEFAULT false,
  ADD COLUMN hosted_in text CHECK (hosted_in IS NULL OR hosted_in IN ('ca', 'us'));

CREATE OR REPLACE FUNCTION tenants_region_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.region IS DISTINCT FROM (SELECT region FROM deployment_info) THEN
    RAISE EXCEPTION 'Residency violation: tenant region % does not match this deployment', NEW.region;
  END IF;
  IF EXISTS (SELECT 1 FROM deployment_info WHERE environment = 'prod' AND NOT physical_region_verified AND NOT residency_acknowledged) THEN
    RAISE EXCEPTION 'Residency violation: production deployment is not verified as physically in region %', NEW.region;
  END IF;
  RETURN NEW;
END $$;

-- 2. Who is at or below a node (no ancestors, no siblings) ------------------------------------------------
CREATE FUNCTION org_node_at_or_below(p_tenant uuid, p_node uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT p_tenant = app_tenant_id() AND (
       app_is_tenant_admin()
    OR p_node = ANY (app_node_ids())
    OR EXISTS (SELECT 1 FROM org_partner_closure c WHERE c.descendant_id = p_node AND c.ancestor_id = ANY (app_node_ids()))
    OR EXISTS (SELECT 1 FROM org_links l JOIN org_partner_closure c ON c.ancestor_id = l.child_id
               WHERE l.kind = 'location_link' AND l.parent_id = ANY (app_node_ids()) AND c.descendant_id = p_node))
$$;

-- 3. Tables ------------------------------------------------------------------------------------------------
CREATE TABLE compliance_profiles (
  node_id           uuid PRIMARY KEY,
  tenant_id         uuid NOT NULL REFERENCES tenants(id),
  entity_type       text CHECK (entity_type IS NULL OR entity_type IN ('sole_proprietor', 'partnership', 'corporation', 'llc', 's_corp', 'other')),
  legal_name        text CHECK (legal_name IS NULL OR length(legal_name) <= 200),
  business_number   text CHECK (business_number IS NULL OR length(business_number) <= 40),
  fields            jsonb NOT NULL DEFAULT '{}' CHECK (pg_column_size(fields) <= 8000),
  agreement_status  text NOT NULL DEFAULT 'not_sent' CHECK (agreement_status IN ('not_sent', 'sent', 'signed')),
  agreement_signed_on date,
  attested_at       timestamptz,
  attested_by       uuid REFERENCES app_users(id) ON DELETE SET NULL,
  status            text NOT NULL DEFAULT 'incomplete' CHECK (status IN ('incomplete', 'submitted', 'approved', 'rejected')),
  submitted_at      timestamptz,
  reviewed_by       uuid,                       -- a head office person: a different company, so no foreign key
  reviewed_by_name  text,
  reviewed_at       timestamptz,
  review_note       text CHECK (review_note IS NULL OR length(review_note) <= 500),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (node_id, tenant_id) REFERENCES org_nodes (id, tenant_id)
);

CREATE TABLE compliance_items (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id),
  node_id      uuid NOT NULL,
  kind         text NOT NULL CHECK (kind IN ('licence', 'eo')),
  label        text NOT NULL CHECK (length(label) BETWEEN 1 AND 120),   -- licence type, or the E&O carrier
  number       text CHECK (number IS NULL OR length(number) <= 60),
  jurisdiction text CHECK (jurisdiction IS NULL OR length(jurisdiction) <= 40),   -- province or state
  lines        text[] NOT NULL DEFAULT '{}' CHECK (cardinality(lines) <= 12),     -- lines of authority
  limit_amount numeric(14, 2) CHECK (limit_amount IS NULL OR limit_amount >= 0), -- E&O coverage limit
  expires_on   date,
  notes        text CHECK (notes IS NULL OR length(notes) <= 500),
  created_by   uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (node_id, tenant_id) REFERENCES org_nodes (id, tenant_id)
);
CREATE INDEX ON compliance_items (node_id);
CREATE INDEX ON compliance_items (expires_on) WHERE expires_on IS NOT NULL;

CREATE TABLE carrier_appointments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id),
  node_id      uuid NOT NULL,
  carrier      text NOT NULL CHECK (length(carrier) BETWEEN 1 AND 120),
  status       text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'in_progress', 'appointed', 'declined')),
  note         text CHECK (note IS NULL OR length(note) <= 500),
  requested_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (node_id, tenant_id) REFERENCES org_nodes (id, tenant_id)
);
CREATE INDEX ON carrier_appointments (node_id);

CREATE TABLE compliance_documents (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  node_id     uuid NOT NULL,
  item_id     uuid REFERENCES compliance_items(id) ON DELETE SET NULL,
  kind        text NOT NULL CHECK (kind IN ('eo_certificate', 'licence', 'agreement', 'other')),
  filename    text NOT NULL CHECK (length(filename) BETWEEN 1 AND 160),
  mime        text NOT NULL CHECK (mime IN ('application/pdf', 'image/png', 'image/jpeg')),
  size_bytes  integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 5242880),
  data        bytea NOT NULL CHECK (octet_length(data) <= 5242880),
  uploaded_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (node_id, tenant_id) REFERENCES org_nodes (id, tenant_id)
);
CREATE INDEX ON compliance_documents (node_id);

-- Which expiry reminders were already made, so each item gets each reminder once per expiry date.
CREATE TABLE compliance_marks (
  item_id    uuid NOT NULL REFERENCES compliance_items(id) ON DELETE CASCADE,
  tenant_id  uuid NOT NULL REFERENCES tenants(id),
  threshold  int  NOT NULL CHECK (threshold IN (30, 15, 0)),
  expires_on date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (item_id, threshold, expires_on)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['compliance_profiles', 'compliance_items', 'carrier_appointments', 'compliance_documents', 'compliance_marks'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_wall ON %I AS RESTRICTIVE USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id())', t);
  END LOOP;
END $$;
CALL apply_visibility_policies('compliance_profiles', 'org_node_at_or_below(tenant_id, node_id)');
CALL apply_visibility_policies('compliance_items', 'org_node_at_or_below(tenant_id, node_id)');
CALL apply_visibility_policies('carrier_appointments', 'org_node_at_or_below(tenant_id, node_id)');
CALL apply_visibility_policies('compliance_documents', 'org_node_at_or_below(tenant_id, node_id)');
CALL apply_visibility_policies('compliance_marks', 'EXISTS (SELECT 1 FROM compliance_items i WHERE i.id = item_id)');

-- 4. Head office: narrow functions that see across companies in this country ----------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_headoffice') THEN
    CREATE ROLE app_headoffice NOLOGIN BYPASSRLS;
  END IF;
END $$;
GRANT USAGE ON SCHEMA public TO app_headoffice;
GRANT SELECT ON tenants, org_nodes, org_links, app_users, user_node_roles, setting_values,
                compliance_profiles, compliance_items, carrier_appointments, compliance_documents TO app_headoffice;
GRANT UPDATE (status, reviewed_by, reviewed_by_name, reviewed_at, review_note, updated_at) ON compliance_profiles TO app_headoffice;
GRANT UPDATE (status, note, updated_at) ON carrier_appointments TO app_headoffice;
GRANT INSERT ON notifications TO app_headoffice;
GRANT CREATE ON SCHEMA public TO app_headoffice;   -- only so the functions below can be handed over; withdrawn at the end

-- Is the signed-in person head office compliance staff? Head office is a company flagged by bootstrap;
-- inside it, a Compliance person or its administrator counts.
CREATE FUNCTION app_is_head_office() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM tenants t JOIN user_node_roles r ON r.tenant_id = t.id
     WHERE t.id = app_tenant_id() AND t.is_head_office AND r.user_id = app_user_id() AND r.role::text IN ('compliance', 'admin'))
$$;

CREATE FUNCTION ho_require() RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT app_is_head_office() THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501'; END IF;
END $$;

-- Every partner in every other company in this country, with the numbers the head office list needs.
CREATE FUNCTION ho_compliance_list() RETURNS TABLE (
  tenant_id uuid, company text, node_id uuid, name text, is_sub boolean, status text, licences int, eo_count int, eo_max numeric,
  next_expiry date, agreement_status text, attested boolean, entity_type text, legal_name text, business_number text, updated_at timestamptz, eo_min numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM ho_require();
  RETURN QUERY
  SELECT n.tenant_id, t.name, n.id, n.name,
         EXISTS (SELECT 1 FROM org_links l WHERE l.child_id = n.id AND l.kind = 'partner_link'),
         coalesce(p.status, 'incomplete'),
         (SELECT count(*)::int FROM compliance_items i WHERE i.node_id = n.id AND i.kind = 'licence'),
         (SELECT count(*)::int FROM compliance_items i WHERE i.node_id = n.id AND i.kind = 'eo'),
         (SELECT max(i.limit_amount) FROM compliance_items i WHERE i.node_id = n.id AND i.kind = 'eo' AND (i.expires_on IS NULL OR i.expires_on >= current_date)),
         (SELECT min(i.expires_on) FROM compliance_items i WHERE i.node_id = n.id),
         coalesce(p.agreement_status, 'not_sent'), (p.attested_at IS NOT NULL), p.entity_type, p.legal_name, p.business_number, p.updated_at,
         (SELECT (sv.value #>> '{}')::numeric FROM setting_values sv WHERE sv.scope_type = 'tenant' AND sv.scope_id = n.tenant_id AND sv.key = 'compliance.eoMinLimit')
    FROM org_nodes n JOIN tenants t ON t.id = n.tenant_id AND NOT t.is_head_office
    LEFT JOIN compliance_profiles p ON p.node_id = n.id
   WHERE n.type = 'partner' AND n.is_active
   ORDER BY t.name, n.name
   LIMIT 2000;
END $$;

-- One partner's whole file, as JSON.
CREATE FUNCTION ho_compliance_detail(p_node uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r jsonb;
BEGIN
  PERFORM ho_require();
  SELECT jsonb_build_object(
    'nodeId', n.id, 'tenantId', n.tenant_id, 'company', t.name, 'name', n.name,
    'isSub', EXISTS (SELECT 1 FROM org_links l WHERE l.child_id = n.id AND l.kind = 'partner_link'),
    'eoMin', (SELECT (sv.value #>> '{}')::numeric FROM setting_values sv WHERE sv.scope_type = 'tenant' AND sv.scope_id = n.tenant_id AND sv.key = 'compliance.eoMinLimit'),
    'profile', (SELECT to_jsonb(p) FROM compliance_profiles p WHERE p.node_id = n.id),
    'items', coalesce((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.kind, i.expires_on NULLS LAST) FROM compliance_items i WHERE i.node_id = n.id), '[]'),
    'appointments', coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.created_at DESC) FROM carrier_appointments a WHERE a.node_id = n.id), '[]'),
    'documents', coalesce((SELECT jsonb_agg(jsonb_build_object('id', d.id, 'itemId', d.item_id, 'kind', d.kind, 'filename', d.filename, 'mime', d.mime, 'sizeBytes', d.size_bytes, 'createdAt', d.created_at) ORDER BY d.created_at DESC)
                            FROM compliance_documents d WHERE d.node_id = n.id), '[]'))
    INTO r
    FROM org_nodes n JOIN tenants t ON t.id = n.tenant_id AND NOT t.is_head_office
   WHERE n.id = p_node AND n.type = 'partner';
  RETURN r;
END $$;

-- Approve or send back a submitted file, and tell the people it belongs to.
CREATE FUNCTION ho_compliance_review(p_node uuid, p_decision text, p_note text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE who text; ten uuid; done int;
BEGIN
  PERFORM ho_require();
  IF p_decision NOT IN ('approved', 'rejected') THEN RAISE EXCEPTION 'Decision must be approved or rejected' USING ERRCODE = '22023'; END IF;
  SELECT coalesce(display_name, email::text) INTO who FROM app_users WHERE id = app_user_id();
  UPDATE compliance_profiles SET status = p_decision, reviewed_by = app_user_id(), reviewed_by_name = who, reviewed_at = now(),
         review_note = nullif(left(coalesce(p_note, ''), 500), ''), updated_at = now()
   WHERE node_id = p_node AND status IN ('submitted', 'approved', 'rejected')
         AND tenant_id IN (SELECT id FROM tenants WHERE NOT is_head_office)
   RETURNING tenant_id INTO ten;
  GET DIAGNOSTICS done = ROW_COUNT;
  IF done = 0 THEN RETURN false; END IF;
  INSERT INTO notifications (tenant_id, user_id, kind, actor_id, data)
  SELECT ten, u.user_id, 'compliance_review', app_user_id(),
         jsonb_build_object('decision', p_decision, 'note', left(coalesce(p_note, ''), 200), 'reviewer', who, 'nodeId', p_node,
                            'name', (SELECT name FROM org_nodes WHERE id = p_node))
    FROM (SELECT user_id FROM user_node_roles WHERE node_id = p_node
          UNION SELECT id FROM app_users WHERE home_node_id = p_node AND status::text <> 'disabled') u;
  RETURN true;
END $$;

-- A document's bytes, for download by head office.
CREATE FUNCTION ho_compliance_document(p_doc uuid) RETURNS TABLE (filename text, mime text, data bytea) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM ho_require();
  RETURN QUERY SELECT d.filename, d.mime, d.data FROM compliance_documents d JOIN tenants t ON t.id = d.tenant_id AND NOT t.is_head_office WHERE d.id = p_doc;
END $$;

-- Move a carrier appointment request along.
CREATE FUNCTION ho_appointment_set(p_id uuid, p_status text, p_note text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE done int;
BEGIN
  PERFORM ho_require();
  IF p_status NOT IN ('requested', 'in_progress', 'appointed', 'declined') THEN RAISE EXCEPTION 'Unknown status' USING ERRCODE = '22023'; END IF;
  UPDATE carrier_appointments SET status = p_status, note = coalesce(nullif(left(p_note, 500), ''), note), updated_at = now()
   WHERE id = p_id AND tenant_id IN (SELECT id FROM tenants WHERE NOT is_head_office);
  GET DIAGNOSTICS done = ROW_COUNT;
  RETURN done > 0;
END $$;

-- Licences and insurance running out soon (or already out), across every company.
CREATE FUNCTION ho_compliance_expiring(p_days int) RETURNS TABLE (
  item_id uuid, tenant_id uuid, company text, node_id uuid, name text, kind text, label text, expires_on date, days_left int)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM ho_require();
  RETURN QUERY
  SELECT i.id, i.tenant_id, t.name, i.node_id, n.name, i.kind, i.label, i.expires_on, (i.expires_on - current_date)::int
    FROM compliance_items i JOIN tenants t ON t.id = i.tenant_id AND NOT t.is_head_office JOIN org_nodes n ON n.id = i.node_id AND n.is_active
   WHERE i.expires_on IS NOT NULL AND i.expires_on <= current_date + greatest(least(p_days, 365), 0)
   ORDER BY i.expires_on, t.name, n.name LIMIT 500;
END $$;

ALTER FUNCTION app_is_head_office() OWNER TO app_headoffice;
ALTER FUNCTION ho_require() OWNER TO app_headoffice;
ALTER FUNCTION ho_compliance_list() OWNER TO app_headoffice;
ALTER FUNCTION ho_compliance_detail(uuid) OWNER TO app_headoffice;
ALTER FUNCTION ho_compliance_review(uuid, text, text) OWNER TO app_headoffice;
ALTER FUNCTION ho_compliance_document(uuid) OWNER TO app_headoffice;
ALTER FUNCTION ho_appointment_set(uuid, text, text) OWNER TO app_headoffice;
ALTER FUNCTION ho_compliance_expiring(int) OWNER TO app_headoffice;
REVOKE CREATE ON SCHEMA public FROM app_headoffice;

REVOKE ALL ON FUNCTION app_is_head_office(), ho_require(), ho_compliance_list(), ho_compliance_detail(uuid), ho_compliance_review(uuid, text, text),
  ho_compliance_document(uuid), ho_appointment_set(uuid, text, text), ho_compliance_expiring(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_is_head_office(), ho_compliance_list(), ho_compliance_detail(uuid), ho_compliance_review(uuid, text, text),
  ho_compliance_document(uuid), ho_appointment_set(uuid, text, text), ho_compliance_expiring(int) TO app_runtime;
