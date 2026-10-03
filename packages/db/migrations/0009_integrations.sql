-- Ways data comes in from outside: hosted web forms and an inbound webhook (Zapier, Calendly, any site).
CREATE TABLE intake_endpoints (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  pipeline_id     uuid NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
  stage_id        uuid NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
  kind            text NOT NULL CHECK (kind IN ('form', 'webhook')),
  name            text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  title           text CHECK (title IS NULL OR length(title) <= 200),
  intro           text CHECK (intro IS NULL OR length(intro) <= 1000),
  owner_node_id   uuid NOT NULL REFERENCES org_nodes(id),
  context_node_id uuid REFERENCES org_nodes(id),
  owner_user_id   uuid REFERENCES app_users(id) ON DELETE SET NULL,
  token_hash      text NOT NULL UNIQUE,
  token_prefix    text NOT NULL,
  active          boolean NOT NULL DEFAULT true,
  uses            integer NOT NULL DEFAULT 0,
  last_used_at    timestamptz,
  created_by      uuid NOT NULL REFERENCES app_users(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON intake_endpoints (pipeline_id);

-- Where we tell other systems when something happens. The signing secret is stored encrypted.
CREATE TABLE webhook_subscriptions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  pipeline_id   uuid NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
  url           text NOT NULL CHECK (length(url) <= 500),
  events        text[] NOT NULL CHECK (events <@ ARRAY['box.created', 'box.stage_changed']::text[] AND cardinality(events) > 0),
  secret_enc    bytea NOT NULL,
  key_id        text NOT NULL,
  active        boolean NOT NULL DEFAULT true,
  last_status   integer,
  last_at       timestamptz,
  failures      integer NOT NULL DEFAULT 0,
  created_by    uuid NOT NULL REFERENCES app_users(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON webhook_subscriptions (pipeline_id) WHERE active;

ALTER TABLE intake_endpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE intake_endpoints FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_wall ON intake_endpoints AS RESTRICTIVE USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
CALL apply_visibility_policies('intake_endpoints', 'EXISTS (SELECT 1 FROM pipelines p WHERE p.id = pipeline_id)');
ALTER TABLE webhook_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_subscriptions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_wall ON webhook_subscriptions AS RESTRICTIVE USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
CALL apply_visibility_policies('webhook_subscriptions', 'EXISTS (SELECT 1 FROM pipelines p WHERE p.id = pipeline_id)');

-- The public form and webhook entry points look the token up before any user is known.
GRANT SELECT ON intake_endpoints, webhook_subscriptions, pipelines, stages TO app_auth;
GRANT UPDATE (uses, last_used_at) ON intake_endpoints TO app_auth;
GRANT UPDATE (last_status, last_at, failures, active) ON webhook_subscriptions TO app_auth;
