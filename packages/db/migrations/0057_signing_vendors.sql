-- Which e-signature vendors a company uses for paperwork that needs a certified third party.
CREATE TABLE signing_vendors (
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  vendor      text NOT NULL CHECK (vendor IN ('docusign','onespan','adobe_sign','notarius','carrier_eapp','dropbox_sign','signnow','other')),
  enabled     boolean NOT NULL DEFAULT true,
  note        text CHECK (note IS NULL OR char_length(note) <= 200),
  set_by_name text NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, vendor)
);
ALTER TABLE signing_vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE signing_vendors FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_wall ON signing_vendors AS RESTRICTIVE USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
CALL apply_visibility_policies('signing_vendors', 'true');
REVOKE DELETE ON signing_vendors FROM app_runtime;
ALTER TABLE advice_records ADD COLUMN vendor_id text CHECK (vendor_id IS NULL OR vendor_id IN ('docusign','onespan','adobe_sign','notarius','carrier_eapp','dropbox_sign','signnow','other'));
