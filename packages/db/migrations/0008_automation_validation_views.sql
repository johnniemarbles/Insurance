-- Rules a record must meet before it can enter a stage.
ALTER TABLE stages ADD COLUMN required_fields text[] NOT NULL DEFAULT '{}';

-- "When a record enters this stage, do this."
CREATE TABLE automations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id),
  pipeline_id      uuid NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
  stage_id         uuid NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
  action           text NOT NULL CHECK (action IN ('create_task', 'assign_owner')),
  title            text CHECK (title IS NULL OR length(title) BETWEEN 1 AND 300),
  due_in_days      integer CHECK (due_in_days IS NULL OR due_in_days BETWEEN 0 AND 3650),
  assignee_user_id uuid REFERENCES app_users(id) ON DELETE CASCADE,
  active           boolean NOT NULL DEFAULT true,
  created_by       uuid REFERENCES app_users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  CHECK ((action = 'create_task' AND title IS NOT NULL) OR (action = 'assign_owner' AND assignee_user_id IS NOT NULL))
);
CREATE INDEX ON automations (stage_id) WHERE active;
CREATE INDEX ON automations (pipeline_id);

-- Saved list views. Private to their author unless shared with everyone who can see the pipeline.
CREATE TABLE saved_views (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  pipeline_id uuid NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  config      jsonb NOT NULL,
  is_shared   boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pipeline_id, user_id, name)
);

ALTER TABLE automations ENABLE ROW LEVEL SECURITY;
ALTER TABLE automations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_wall ON automations AS RESTRICTIVE USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
CALL apply_visibility_policies('automations', 'EXISTS (SELECT 1 FROM pipelines p WHERE p.id = pipeline_id)');

ALTER TABLE saved_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_views FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_wall ON saved_views AS RESTRICTIVE USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
CREATE POLICY vis_select ON saved_views FOR SELECT
  USING (EXISTS (SELECT 1 FROM pipelines p WHERE p.id = pipeline_id) AND (user_id = app_user_id() OR is_shared));
CREATE POLICY own_write ON saved_views FOR ALL
  USING (user_id = app_user_id() AND app_can_write()) WITH CHECK (user_id = app_user_id() AND app_can_write());
