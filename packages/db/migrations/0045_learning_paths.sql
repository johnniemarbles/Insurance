-- Learning paths: an ordered set of courses that are taken (and assigned) together.
CREATE TABLE learning_paths (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  owner_node_id uuid NOT NULL REFERENCES org_nodes(id),
  name          text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  description   text CHECK (description IS NULL OR length(description) <= 2000),
  created_by    uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON learning_paths (tenant_id, owner_node_id);
ALTER TABLE learning_paths ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning_paths FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_wall ON learning_paths AS RESTRICTIVE USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
CALL apply_visibility_policies('learning_paths', 'shared_down_visible(tenant_id, owner_node_id, true)');

CREATE TABLE learning_path_courses (
  path_id   uuid NOT NULL REFERENCES learning_paths(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  course_id uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  position  int NOT NULL,
  PRIMARY KEY (path_id, course_id)
);
CREATE INDEX ON learning_path_courses (tenant_id, course_id);
ALTER TABLE learning_path_courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning_path_courses FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_wall ON learning_path_courses AS RESTRICTIVE USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
CALL apply_visibility_policies('learning_path_courses', 'EXISTS (SELECT 1 FROM learning_paths p WHERE p.id = path_id)');
