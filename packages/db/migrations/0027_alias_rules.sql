-- "Mail sent to this address belongs in this pipeline."
-- A company's website forms email an alias (travel@, auto@ ...); each alias maps to one pipeline (and optionally a starting stage).
-- The extension reads these rules and matches them in the person's own browser. Nothing is linked until the person accepts the notice.
CREATE TABLE alias_rules (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  pipeline_id uuid NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
  stage_id    uuid REFERENCES stages(id) ON DELETE SET NULL,
  alias       text NOT NULL CHECK (alias = lower(alias) AND length(alias) BETWEEN 3 AND 254 AND alias LIKE '_%@_%._%' AND alias !~ '[[:space:]]'),
  created_by  uuid REFERENCES app_users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, alias)
);
CREATE INDEX ON alias_rules (pipeline_id);

ALTER TABLE alias_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE alias_rules FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_wall ON alias_rules AS RESTRICTIVE USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
CALL apply_visibility_policies('alias_rules', 'EXISTS (SELECT 1 FROM pipelines p WHERE p.id = pipeline_id)');
