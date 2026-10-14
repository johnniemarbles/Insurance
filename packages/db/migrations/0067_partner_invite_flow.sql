-- Partner invite flow: one invitation creates the partner's PII login and asks them to install the Gmail extension.
-- The invitation is linked to the onboarding case, so accepting it marks the case "login created".
-- Reminders go out at 24, 48 and 72 hours while the link is unopened (counted here, sent by the background sweep).
-- The extension reports its install once it signs in (extension_installs), and the case records the first install.

-- Invitations sent by email through Resend (the case invite flow). The older gmail/link deliveries are unchanged.
ALTER TABLE invitations DROP CONSTRAINT IF EXISTS invitations_delivery_method_check;
ALTER TABLE invitations ADD CONSTRAINT invitations_delivery_method_check CHECK (delivery_method IS NULL OR delivery_method IN ('gmail', 'link', 'resend'));
ALTER TABLE invitations
  ADD COLUMN onboarding_case_id uuid REFERENCES onboarding_cases(id) ON DELETE SET NULL,
  ADD COLUMN reminders_sent     integer NOT NULL DEFAULT 0 CHECK (reminders_sent BETWEEN 0 AND 3),
  ADD COLUMN last_reminder_at   timestamptz;
CREATE INDEX invitations_onboarding_case ON invitations (onboarding_case_id);
GRANT UPDATE (reminders_sent, last_reminder_at, token_hash) ON invitations TO app_auth;

ALTER TABLE onboarding_cases
  ADD COLUMN login_created_at       timestamptz,
  ADD COLUMN extension_installed_at timestamptz;
-- The sign-in callback (auth pool) records the login; the extension check-in records the install.
GRANT SELECT ON onboarding_cases TO app_auth;
GRANT UPDATE (login_created_at, extension_installed_at) ON onboarding_cases TO app_auth;

-- One row per person and extension ID. The extension ID is the Chrome Web Store ID, or the fixed ID of the zip copy.
CREATE TABLE extension_installs (
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  user_id       uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  extension_id  text NOT NULL CHECK (extension_id ~ '^[a-p]{32}$'),
  version       text NOT NULL CHECK (length(version) <= 20),
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, extension_id)
);
ALTER TABLE extension_installs ENABLE ROW LEVEL SECURITY;
ALTER TABLE extension_installs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_wall ON extension_installs AS RESTRICTIVE USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
CREATE POLICY own_row ON extension_installs FOR ALL USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
