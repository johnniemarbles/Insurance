-- One small row of counts per company per day (and one for head office), so pages can say "+2 since last month".
-- Counts only: no names, no records.
CREATE TABLE count_snapshots (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  day       date NOT NULL,
  scope     text NOT NULL CHECK (scope IN ('company', 'ho')),
  data      jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, scope, day)
);
ALTER TABLE count_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE count_snapshots FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_wall ON count_snapshots AS RESTRICTIVE USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
CREATE POLICY tenant_all ON count_snapshots USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
GRANT SELECT, INSERT ON count_snapshots TO app_runtime;
