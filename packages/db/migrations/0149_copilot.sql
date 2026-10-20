-- Co-pilot (roadmap Phase 1): the company chooses which AI provider PII uses (Anthropic, Google Gemini or OpenAI) and
-- whether partners may use their own key instead; a partner's key is stored encrypted, shown back only as its last
-- four characters, and replaced or withdrawn, never read out. A small log of questions keeps who asked, when, through
-- which provider and how many records were cited, never the question or the answer.
-- Ships switched off (COPILOT_ENABLED). Adds columns with defaults and new tables; changes no existing row.

ALTER TABLE tenant_ai
  ADD COLUMN provider text CHECK (provider IS NULL OR provider IN ('anthropic', 'openai', 'gemini')),
  ADD COLUMN allow_partner_keys boolean NOT NULL DEFAULT false;

CREATE TABLE ai_partner_keys (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  node_id     uuid NOT NULL REFERENCES org_nodes(id),
  provider    text NOT NULL CHECK (provider IN ('anthropic', 'openai', 'gemini')),
  key_enc     bytea NOT NULL,
  key_id      text NOT NULL,
  last4       text NOT NULL CHECK (char_length(last4) = 4),
  created_by  uuid NOT NULL REFERENCES app_users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  revoked_at  timestamptz,
  revoked_by  uuid REFERENCES app_users(id)
);
CREATE UNIQUE INDEX ai_partner_keys_one_active ON ai_partner_keys (node_id) WHERE revoked_at IS NULL;
ALTER TABLE ai_partner_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_partner_keys FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_wall ON ai_partner_keys AS RESTRICTIVE USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
-- Only people at the partner the key belongs to (and tenant admins, who may withdraw it) can reach the row at all.
CREATE POLICY own_node ON ai_partner_keys
  USING (node_id = ANY (app_node_ids()) OR app_is_tenant_admin())
  WITH CHECK ((node_id = ANY (app_node_ids()) OR app_is_tenant_admin()) AND app_can_write());
REVOKE ALL ON ai_partner_keys FROM app_runtime;
GRANT SELECT, INSERT, UPDATE (revoked_at, revoked_by) ON ai_partner_keys TO app_runtime;

CREATE TABLE copilot_log (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id),
  user_id        uuid NOT NULL REFERENCES app_users(id),
  kind           text NOT NULL CHECK (kind IN ('ask')),
  provider       text NOT NULL CHECK (provider IN ('anthropic', 'openai', 'gemini', 'default')),
  key_source     text NOT NULL CHECK (key_source IN ('pii', 'partner')),
  model          text NOT NULL,
  question_chars integer NOT NULL,
  records_sent   integer NOT NULL,
  records_cited  integer NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX copilot_log_user ON copilot_log (tenant_id, user_id, created_at DESC);
ALTER TABLE copilot_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE copilot_log FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_wall ON copilot_log AS RESTRICTIVE USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
CREATE POLICY own_or_admin ON copilot_log USING (user_id = app_user_id() OR app_is_tenant_admin()) WITH CHECK (user_id = app_user_id() AND app_can_write());
REVOKE ALL ON copilot_log FROM app_runtime;
GRANT SELECT, INSERT ON copilot_log TO app_runtime;
