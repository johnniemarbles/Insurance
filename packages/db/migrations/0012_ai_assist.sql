-- Consent-gated AI assistance. Off until a tenant administrator switches it on.

CREATE TABLE tenant_ai (
  tenant_id  uuid PRIMARY KEY REFERENCES tenants(id),
  enabled    boolean NOT NULL DEFAULT false,
  include_email boolean NOT NULL DEFAULT false,   -- may linked email text be sent to the AI service
  changed_by uuid REFERENCES app_users(id),
  changed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE tenant_ai ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_ai FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_wall ON tenant_ai AS RESTRICTIVE USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
CREATE POLICY tenant_rows ON tenant_ai FOR SELECT USING (true);
CREATE POLICY tenant_ins ON tenant_ai FOR INSERT WITH CHECK (app_can_write());
CREATE POLICY tenant_upd ON tenant_ai FOR UPDATE USING (app_can_write()) WITH CHECK (app_can_write());

CREATE TABLE ai_insights (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  box_id        uuid NOT NULL REFERENCES boxes(id) ON DELETE CASCADE,
  owner_node_id uuid NOT NULL REFERENCES org_nodes(id),
  context_node_id uuid REFERENCES org_nodes(id),
  kind          text NOT NULL CHECK (kind IN ('summary', 'next_action', 'reply_draft')),
  body          text NOT NULL CHECK (length(body) <= 8000),
  used_email    boolean NOT NULL DEFAULT false,
  model         text NOT NULL,
  created_by    uuid NOT NULL REFERENCES app_users(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON ai_insights (box_id, kind, created_at DESC);
ALTER TABLE ai_insights ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_insights FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_wall ON ai_insights AS RESTRICTIVE USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
CALL apply_visibility_policies('ai_insights', 'crm_row_visible(tenant_id, owner_node_id, context_node_id)');
