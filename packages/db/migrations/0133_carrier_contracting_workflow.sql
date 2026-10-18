-- Operational carrier contracting workflow: document checklist, submissions, and response tracking.
ALTER TABLE carrier_contract_cases ADD COLUMN IF NOT EXISTS carrier_id text REFERENCES carrier_directory(id);

CREATE TABLE IF NOT EXISTS carrier_contract_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  contract_id uuid NOT NULL REFERENCES carrier_contract_cases(id) ON DELETE CASCADE,
  document_type text NOT NULL CHECK (document_type IN ('licence', 'eo_insurance', 'banking_void_cheque', 'aml_cert', 'carrier_app_schedule', 'signed_agreement', 'other')),
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
  file_name text NOT NULL CHECK (char_length(btrim(file_name)) BETWEEN 1 AND 255),
  content_hash text NOT NULL CHECK (char_length(btrim(content_hash)) = 64),
  file_size_bytes integer NOT NULL CHECK (file_size_bytes > 0 AND file_size_bytes <= 26214400),
  mime_type text NOT NULL DEFAULT 'application/pdf',
  status text NOT NULL DEFAULT 'attached' CHECK (status IN ('pending', 'attached', 'verified', 'rejected')),
  verified_by uuid REFERENCES app_users(id),
  verified_at timestamptz,
  notes text,
  uploaded_by uuid NOT NULL REFERENCES app_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS carrier_contract_documents_contract_idx ON carrier_contract_documents(tenant_id, contract_id);
ALTER TABLE carrier_contract_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE carrier_contract_documents FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_wall ON carrier_contract_documents
  FOR ALL TO app_runtime USING (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON carrier_contract_documents TO app_runtime;
REVOKE ALL ON carrier_contract_documents FROM PUBLIC, app_auth;
COMMENT ON TABLE carrier_contract_documents IS 'Supporting application documents and checklist evidence for direct carrier contracting.';

CREATE TABLE IF NOT EXISTS carrier_contract_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  contract_id uuid NOT NULL REFERENCES carrier_contract_cases(id) ON DELETE CASCADE,
  carrier_id text NOT NULL REFERENCES carrier_directory(id),
  submission_mode text NOT NULL CHECK (submission_mode IN ('manual', 'email', 'api')),
  recipient_to text,
  recipient_cc text[] NOT NULL DEFAULT '{}',
  subject text NOT NULL,
  body_preview text NOT NULL,
  package_hash text NOT NULL CHECK (char_length(btrim(package_hash)) = 64),
  document_ids uuid[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'delivered', 'failed', 'acknowledged', 'additional_info_requested', 'carrier_approved', 'declined')),
  response_reference text,
  response_notes text,
  idempotency_key text NOT NULL UNIQUE,
  submitted_by uuid NOT NULL REFERENCES app_users(id),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS carrier_contract_submissions_contract_idx ON carrier_contract_submissions(tenant_id, contract_id);
CREATE INDEX IF NOT EXISTS carrier_contract_submissions_carrier_idx ON carrier_contract_submissions(tenant_id, carrier_id);
ALTER TABLE carrier_contract_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE carrier_contract_submissions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_wall ON carrier_contract_submissions
  FOR ALL TO app_runtime USING (tenant_id = app_tenant_id())
  WITH CHECK (tenant_id = app_tenant_id());
GRANT SELECT, INSERT, UPDATE ON carrier_contract_submissions TO app_runtime;
REVOKE ALL ON carrier_contract_submissions FROM PUBLIC, app_auth;
COMMENT ON TABLE carrier_contract_submissions IS 'Immutable audit record of direct carrier contracting submissions and insurer responses.';
