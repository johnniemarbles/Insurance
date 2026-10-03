-- Layered settings: a person, a branch (applies to everyone beneath it) and the company can each set a value.
-- A higher level may lock a value; the database refuses a lower-level write for a locked key.

CREATE TABLE setting_values (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id),
  scope_type text NOT NULL CHECK (scope_type IN ('tenant', 'node', 'user')),
  scope_id   uuid NOT NULL,                       -- the tenant, the org node or the user
  key        text NOT NULL CHECK (length(key) BETWEEN 1 AND 80),
  value      jsonb NOT NULL,
  locked     boolean NOT NULL DEFAULT false,
  updated_by uuid REFERENCES app_users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scope_type, scope_id, key),
  CHECK (NOT locked OR scope_type <> 'user'),     -- a person cannot lock anything
  CHECK (pg_column_size(value) <= 20000)
);
CREATE INDEX ON setting_values (tenant_id, key);

CREATE TABLE setting_history (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id),
  scope_type text NOT NULL,
  scope_id   uuid NOT NULL,
  key        text NOT NULL,
  old_value  jsonb,
  new_value  jsonb,                               -- null: the value was removed
  old_locked boolean,
  new_locked boolean,
  changed_by uuid REFERENCES app_users(id),
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON setting_history (scope_type, scope_id, changed_at DESC);

-- Who may see a row: your own, any node row at or above one of your branches, and the company's.
CREATE FUNCTION setting_row_visible(p_type text, p_scope uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT CASE p_type
    WHEN 'tenant' THEN true
    WHEN 'user'   THEN p_scope = app_user_id()
    WHEN 'node'   THEN EXISTS (SELECT 1 FROM org_reach r WHERE r.ancestor_id = p_scope AND r.descendant_id = ANY (app_node_ids()))
    ELSE false END
$$;

-- Who may write a row (the API also checks the manager or administrator role).
CREATE FUNCTION setting_row_writable(p_type text, p_scope uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT app_can_write() AND CASE p_type
    WHEN 'tenant' THEN p_scope = app_tenant_id()
    WHEN 'user'   THEN p_scope = app_user_id()
    WHEN 'node'   THEN p_scope = ANY (app_node_ids())
    ELSE false END
$$;

ALTER TABLE setting_values ENABLE ROW LEVEL SECURITY;
ALTER TABLE setting_values FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_wall ON setting_values AS RESTRICTIVE USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
CREATE POLICY sv_select ON setting_values FOR SELECT USING (setting_row_visible(scope_type, scope_id));
CREATE POLICY sv_insert ON setting_values FOR INSERT WITH CHECK (setting_row_writable(scope_type, scope_id));
CREATE POLICY sv_update ON setting_values FOR UPDATE USING (setting_row_writable(scope_type, scope_id)) WITH CHECK (setting_row_writable(scope_type, scope_id));
CREATE POLICY sv_delete ON setting_values FOR DELETE USING (setting_row_writable(scope_type, scope_id));

ALTER TABLE setting_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE setting_history FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_wall ON setting_history AS RESTRICTIVE USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
CREATE POLICY sh_select ON setting_history FOR SELECT USING (setting_row_visible(scope_type, scope_id));
CREATE POLICY sh_insert ON setting_history FOR INSERT WITH CHECK (setting_row_writable(scope_type, scope_id));

-- A locked value above you cannot be overridden below you.
CREATE FUNCTION setting_lock_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.scope_type = 'tenant' THEN RETURN NEW; END IF;
  IF EXISTS (
    SELECT 1 FROM setting_values h
     WHERE h.key = NEW.key AND h.locked AND h.id IS DISTINCT FROM NEW.id
       AND (h.scope_type = 'tenant'
            OR (h.scope_type = 'node' AND NOT (NEW.scope_type = 'node' AND h.scope_id = NEW.scope_id)
                AND ((NEW.scope_type = 'user' AND EXISTS (SELECT 1 FROM org_reach r WHERE r.ancestor_id = h.scope_id AND r.descendant_id = ANY (app_node_ids())))
                  OR (NEW.scope_type = 'node' AND EXISTS (SELECT 1 FROM org_reach r WHERE r.ancestor_id = h.scope_id AND r.descendant_id = NEW.scope_id)))))
  ) THEN
    RAISE EXCEPTION 'setting_locked' USING ERRCODE = 'P0001', HINT = 'A higher level has locked this setting';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER setting_lock_guard BEFORE INSERT OR UPDATE ON setting_values FOR EACH ROW EXECUTE FUNCTION setting_lock_guard();
