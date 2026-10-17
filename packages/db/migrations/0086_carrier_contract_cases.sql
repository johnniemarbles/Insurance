-- Carrier contracting subcases: preparing contracts does not confer authority to transact.
CREATE TABLE carrier_contract_cases (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES tenants(id),
 onboarding_case_id uuid NOT NULL REFERENCES onboarding_cases(id),
 node_id uuid NOT NULL REFERENCES org_nodes(id),
 carrier_name text NOT NULL CHECK (char_length(btrim(carrier_name)) BETWEEN 1 AND 120),
 jurisdiction text NOT NULL CHECK (char_length(btrim(jurisdiction)) BETWEEN 2 AND 40),
 state text NOT NULL DEFAULT 'requested' CHECK (state IN
 ('requested','documents_prepared','broker_signed','submitted','carrier_review','correction_required','approved','appointment_verified','active','declined','withdrawn','suspended','expired','terminated')),
 template_version text,
 appointment_reference text,
 appointment_effective_on date,
 appointment_expires_on date,
 verified_by uuid REFERENCES app_users(id),
 verified_at timestamptz,
 created_by uuid NOT NULL REFERENCES app_users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (onboarding_case_id, carrier_name, jurisdiction),
 CHECK (state NOT IN ('appointment_verified','active') OR
 (appointment_reference IS NOT NULL AND appointment_effective_on IS NOT NULL AND verified_by IS NOT NULL AND verified_at IS NOT NULL))
);
CREATE INDEX carrier_contract_cases_queue ON carrier_contract_cases(tenant_id,state,updated_at);
CREATE TABLE carrier_contract_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES tenants(id),
 contract_id uuid NOT NULL REFERENCES carrier_contract_cases(id),
 node_id uuid NOT NULL REFERENCES org_nodes(id),
 from_state text,
 to_state text NOT NULL,
 actor_id uuid NOT NULL REFERENCES app_users(id),
 reason text,
 recorded_at timestamptz NOT NULL DEFAULT now()
);
DO $$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['carrier_contract_cases','carrier_contract_events'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
  EXECUTE format('CREATE POLICY tenant_wall ON %I AS RESTRICTIVE USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id())',t);
 END LOOP;
END $$;
CALL apply_visibility_policies('carrier_contract_cases','org_node_at_or_below(tenant_id, node_id)');
CREATE POLICY carrier_contract_insert ON carrier_contract_cases FOR INSERT WITH CHECK (
 app_can_write() AND created_by = app_user_id() AND (
 app_is_compliance_at_or_above(tenant_id,node_id) OR
 EXISTS (SELECT 1 FROM user_node_roles WHERE node_id = carrier_contract_cases.node_id AND user_id = app_user_id())
 )
);
CREATE POLICY carrier_contract_update ON carrier_contract_cases FOR UPDATE USING (
 app_can_write() AND app_is_compliance_at_or_above(tenant_id,node_id)
) WITH CHECK (app_can_write() AND app_is_compliance_at_or_above(tenant_id,node_id));
CREATE POLICY carrier_events_read ON carrier_contract_events FOR SELECT USING (org_node_at_or_below(tenant_id,node_id));
CREATE POLICY carrier_events_insert ON carrier_contract_events FOR INSERT WITH CHECK
 (app_can_write() AND app_is_compliance_at_or_above(tenant_id,node_id) AND actor_id = app_user_id());
GRANT SELECT, INSERT, UPDATE ON carrier_contract_cases TO app_runtime;
GRANT SELECT, INSERT ON carrier_contract_events TO app_runtime;
