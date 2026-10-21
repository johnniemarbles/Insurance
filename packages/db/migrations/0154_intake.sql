-- Client self-intake (roadmap Phase 2, feature 6). The advisor sends one client on a deal a private link. On their own
-- phone or computer the client fills in who they are, their situation and goals, gives consents, uploads documents and,
-- if the company uses it, starts the electronic ID check. They submit with a code sent to the email on file and their
-- typed name. Nothing the client typed changes the file until the advisor reviews it and applies it: contact details
-- are updated and a draft needs analysis is prefilled for the advisor to finish and have signed. Consents the client
-- gives are the client's own act and are recorded when they submit. Each family member gets their own link.
-- Ships switched off (INTAKE_ENABLED); changes no existing row.

-- The link itself: looked up before any tenant context exists, so only the auth role touches it (like signing_links).
CREATE TABLE intake_links (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id),
  intake_id      uuid NOT NULL,
  created_by     uuid NOT NULL,
  node_id        uuid NOT NULL,
  token_hash     bytea NOT NULL UNIQUE,
  expires_at     timestamptz NOT NULL,
  otp_hash       text,
  otp_expires_at timestamptz,
  otp_attempts   int NOT NULL DEFAULT 0,
  sends          int NOT NULL DEFAULT 0,
  used_at        timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX intake_links_intake ON intake_links (intake_id);
ALTER TABLE intake_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE intake_links FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_wall ON intake_links AS RESTRICTIVE USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
REVOKE ALL ON intake_links FROM app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON intake_links TO app_auth;

-- What the client is asked and what they answered. Same privacy wall as the deal.
CREATE TABLE client_intakes (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id),
  box_id           uuid NOT NULL REFERENCES boxes(id) ON DELETE CASCADE,
  contact_id       uuid NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
  sections         text[] NOT NULL CHECK (cardinality(sections) BETWEEN 1 AND 5
                     AND sections <@ ARRAY['about', 'situation', 'consents', 'documents', 'id_check']::text[] AND 'about' = ANY (sections)),
  status           text NOT NULL CHECK (status IN ('sent', 'in_progress', 'submitted', 'applied', 'canceled')),
  answers          jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(answers) = 'object' AND octet_length(answers::text) <= 20000),
  document_ids     uuid[] NOT NULL DEFAULT '{}' CHECK (cardinality(document_ids) <= 8),
  consents         text[] NOT NULL DEFAULT '{}' CHECK (consents <@ ARRAY['collection_use', 'carrier_sharing', 'electronic_comms']::text[]),
  typed_name       text CHECK (typed_name IS NULL OR char_length(typed_name) BETWEEN 2 AND 200),
  signer_ip        text,
  signer_agent     text CHECK (signer_agent IS NULL OR char_length(signer_agent) <= 400),
  sent_by          uuid NOT NULL REFERENCES app_users(id),
  sent_by_name     text NOT NULL,
  expires_at       timestamptz NOT NULL,
  opened_at        timestamptz,
  submitted_at     timestamptz,
  applied_at       timestamptz,
  applied_by_name  text,
  needs_analysis_id uuid REFERENCES advice_records(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CHECK ((status IN ('submitted', 'applied')) = (submitted_at IS NOT NULL AND typed_name IS NOT NULL))
);
CREATE INDEX client_intakes_box ON client_intakes (box_id, created_at DESC);
ALTER TABLE client_intakes ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_intakes FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_wall ON client_intakes AS RESTRICTIVE USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
CALL apply_visibility_policies('client_intakes', 'EXISTS (SELECT 1 FROM boxes b WHERE b.id = box_id)');
REVOKE ALL ON client_intakes FROM app_runtime;
GRANT SELECT, INSERT, UPDATE (status, answers, document_ids, consents, typed_name, signer_ip, signer_agent, opened_at, submitted_at, applied_at, applied_by_name, needs_analysis_id, updated_at)
  ON client_intakes TO app_runtime;

-- A submitted intake is the client's record: their answers cannot change. Applied and cancelled are final.
CREATE FUNCTION client_intakes_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.sent_by IS DISTINCT FROM app_user_id() THEN
      RAISE EXCEPTION 'An intake is sent as the person sending it' USING ERRCODE = '42501';
    END IF;
    IF NEW.status <> 'sent' THEN RAISE EXCEPTION 'A new intake starts as sent' USING ERRCODE = '22023'; END IF;
    IF NOT EXISTS (SELECT 1 FROM box_contacts bc WHERE bc.box_id = NEW.box_id AND bc.contact_id = NEW.contact_id) THEN
      RAISE EXCEPTION 'The client must be on this deal' USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status IN ('applied', 'canceled') THEN
    RAISE EXCEPTION 'A finished intake cannot be changed' USING ERRCODE = '42501';
  END IF;
  IF OLD.status = 'submitted' AND ((NEW.answers, NEW.document_ids, NEW.consents, NEW.typed_name, NEW.submitted_at)
       IS DISTINCT FROM (OLD.answers, OLD.document_ids, OLD.consents, OLD.typed_name, OLD.submitted_at) OR NEW.status NOT IN ('submitted', 'applied')) THEN
    RAISE EXCEPTION 'A submitted intake is the client''s record and cannot be changed' USING ERRCODE = '42501';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER client_intakes_guard BEFORE INSERT OR UPDATE ON client_intakes FOR EACH ROW EXECUTE FUNCTION client_intakes_guard();
