-- Shortcuts on Home: the saved views a person pins as cards. Personal; nobody else can see or change them.
CREATE TABLE home_pins (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  user_id   uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  view_id   uuid NOT NULL REFERENCES saved_views(id) ON DELETE CASCADE,
  position  int  NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, view_id)
);
ALTER TABLE home_pins ENABLE ROW LEVEL SECURITY;
ALTER TABLE home_pins FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_wall ON home_pins AS RESTRICTIVE USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
CREATE POLICY hp_select ON home_pins FOR SELECT USING (user_id = app_user_id());
CREATE POLICY hp_insert ON home_pins FOR INSERT WITH CHECK (user_id = app_user_id() AND app_can_write());
CREATE POLICY hp_update ON home_pins FOR UPDATE USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
CREATE POLICY hp_delete ON home_pins FOR DELETE USING (user_id = app_user_id());
