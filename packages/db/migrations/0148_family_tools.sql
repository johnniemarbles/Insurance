-- Families, Gate D (productivity): one email per family through the existing mail merge, private add-to-family
-- suggestions that a partner can dismiss, and an import log. Ships switched off (FAMILIES_PRODUCTIVITY_ENABLED).
-- Adds columns with defaults and new tables; changes no existing row's meaning (every existing merge is a deal merge).

-- A merge is to deals (as before) or to families. A family recipient row names the family and keeps the list of facts
-- that went into that person's message, so the send log shows exactly what each person was told.
ALTER TABLE mail_merges ADD COLUMN audience text NOT NULL DEFAULT 'deals' CHECK (audience IN ('deals', 'families'));
ALTER TABLE mail_merge_recipients
  ADD COLUMN family_id uuid REFERENCES families(id) ON DELETE SET NULL,
  ADD COLUMN facts jsonb CHECK (facts IS NULL OR jsonb_typeof(facts) = 'array');
CREATE INDEX mail_merge_recipients_family ON mail_merge_recipients (tenant_id, family_id) WHERE family_id IS NOT NULL;

-- Suggestions to add someone to a family are computed on request and never stored; only "not this one" is kept,
-- for the partner who said it.
CREATE TABLE family_suggestion_dismissals (
  tenant_id    uuid NOT NULL REFERENCES tenants(id),
  user_id      uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  contact_id   uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  family_id    uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  dismissed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, contact_id, family_id)
);
ALTER TABLE family_suggestion_dismissals ENABLE ROW LEVEL SECURITY;
ALTER TABLE family_suggestion_dismissals FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_wall ON family_suggestion_dismissals AS RESTRICTIVE USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
CREATE POLICY own_rows ON family_suggestion_dismissals USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id() AND app_can_write());

-- Each committed import: who, when, how many rows and what was created. Dry runs are not stored.
CREATE TABLE family_imports (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id),
  owner_node_id    uuid NOT NULL REFERENCES org_nodes(id),
  context_node_id  uuid REFERENCES org_nodes(id),
  user_id          uuid NOT NULL REFERENCES app_users(id),
  file_name        text CHECK (file_name IS NULL OR char_length(file_name) <= 200),
  file_sha256      text NOT NULL CHECK (file_sha256 ~ '^[0-9a-f]{64}$'),
  rows_total       integer NOT NULL CHECK (rows_total >= 1),
  clients_created  integer NOT NULL,
  clients_linked   integer NOT NULL,
  families_created integer NOT NULL,
  families_joined  integer NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE family_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE family_imports FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_wall ON family_imports AS RESTRICTIVE USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
CALL apply_visibility_policies('family_imports', 'crm_row_visible(tenant_id, owner_node_id, context_node_id)');
REVOKE ALL ON family_imports FROM app_runtime;
GRANT SELECT, INSERT ON family_imports TO app_runtime;
