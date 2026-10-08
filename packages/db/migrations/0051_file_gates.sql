-- File-completeness gates. A stage can require certain kinds of document on the record before it may be entered.
-- A person with authority can waive the requirement for one record; the waiver is permanent, named and explained.
--
--  * box_documents.doc_type: what kind of paperwork a file is (privacy consent, needs analysis, ...). Free files stay untyped.
--  * stage_doc_requirements: the document types a stage requires. Same visibility as the stage itself (everyone in the company).
--  * gate_overrides: append-only. Nobody can edit or delete a waiver, so the audit trail cannot be tidied afterwards.

ALTER TABLE box_documents ADD COLUMN doc_type text CHECK (doc_type IS NULL OR doc_type IN
  ('privacy_consent', 'brokerage_agreement', 'needs_analysis', 'id_record', 'pink_slip_optin', 'beneficiary_designation'));
CREATE INDEX ON box_documents (box_id, doc_type) WHERE doc_type IS NOT NULL;

CREATE TABLE stage_doc_requirements (
  stage_id  uuid NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
  doc_type  text NOT NULL CHECK (doc_type IN ('privacy_consent', 'brokerage_agreement', 'needs_analysis', 'id_record', 'pink_slip_optin', 'beneficiary_designation')),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  PRIMARY KEY (stage_id, doc_type)
);
CREATE INDEX ON stage_doc_requirements (tenant_id);
ALTER TABLE stage_doc_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE stage_doc_requirements FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_wall ON stage_doc_requirements AS RESTRICTIVE USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
CALL apply_visibility_policies('stage_doc_requirements', 'EXISTS (SELECT 1 FROM stages s WHERE s.id = stage_id)');
GRANT SELECT, INSERT, DELETE ON stage_doc_requirements TO app_runtime;

CREATE TABLE gate_overrides (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  box_id      uuid NOT NULL REFERENCES boxes(id) ON DELETE CASCADE,
  stage_id    uuid NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
  doc_types   text[] NOT NULL CHECK (cardinality(doc_types) BETWEEN 1 AND 10),
  reason      text NOT NULL CHECK (length(reason) BETWEEN 10 AND 500),
  approved_by uuid NOT NULL REFERENCES app_users(id),
  approver_name text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON gate_overrides (box_id, stage_id);
ALTER TABLE gate_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE gate_overrides FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_wall ON gate_overrides AS RESTRICTIVE USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
CALL apply_visibility_policies('gate_overrides', 'EXISTS (SELECT 1 FROM boxes b WHERE b.id = box_id)');
REVOKE ALL ON gate_overrides FROM app_runtime;
GRANT SELECT, INSERT ON gate_overrides TO app_runtime;   -- no UPDATE, no DELETE: waivers are permanent
