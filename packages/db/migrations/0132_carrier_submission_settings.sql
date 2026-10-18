-- Tenant-specific direct carrier contracting email configuration. No outbound transmission is enabled.
CREATE TABLE carrier_submission_settings (
 tenant_id uuid NOT NULL,
 carrier_id text NOT NULL REFERENCES carrier_directory(id),
 mode text NOT NULL DEFAULT 'manual' CHECK (mode IN ('manual','semi_automated')),
 recipient_to text,
 recipient_cc text[] NOT NULL DEFAULT '{}',
 reply_to text,
 subject_template text NOT NULL DEFAULT 'Carrier contracting application — {{caseReference}}',
 body_template text NOT NULL DEFAULT 'Please review the attached contracting application.',
 recipient_verified_at timestamptz,
 recipient_verified_by uuid,
 recipient_verification_evidence text,
 sending_enabled boolean NOT NULL DEFAULT false,
 revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
 updated_by uuid NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (tenant_id, carrier_id),
 CHECK (NOT sending_enabled OR (recipient_to IS NOT NULL AND recipient_verified_at IS NOT NULL AND recipient_verification_evidence IS NOT NULL)),
 CHECK (recipient_to IS NULL OR length(recipient_to) <= 254),
 CHECK (reply_to IS NULL OR length(reply_to) <= 254),
 CHECK (cardinality(recipient_cc) <= 10)
);
ALTER TABLE carrier_submission_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE carrier_submission_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY carrier_submission_settings_tenant_read ON carrier_submission_settings
 FOR SELECT TO app_runtime USING (tenant_id = app_tenant_id());
CREATE POLICY carrier_submission_settings_tenant_insert ON carrier_submission_settings
 FOR INSERT TO app_runtime WITH CHECK (tenant_id = app_tenant_id());
CREATE POLICY carrier_submission_settings_tenant_update ON carrier_submission_settings
 FOR UPDATE TO app_runtime USING (tenant_id = app_tenant_id())
 WITH CHECK (tenant_id = app_tenant_id());
GRANT SELECT,INSERT,UPDATE ON carrier_submission_settings TO app_runtime;
REVOKE ALL ON carrier_submission_settings FROM PUBLIC,app_auth;
COMMENT ON TABLE carrier_submission_settings IS 'Editable tenant carrier recipient settings; verified recipient is separate from carrier appointment or API integration. No email sending is implemented by this table.';
