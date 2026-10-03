-- Snippets (saved replies), mail merge, and opt-out for marketing email.

ALTER TABLE snippets
  ADD COLUMN owner_node_id uuid REFERENCES org_nodes(id),
  ADD COLUMN shared        boolean NOT NULL DEFAULT false,
  ADD COLUMN created_at    timestamptz NOT NULL DEFAULT now(),
  ADD CONSTRAINT snippets_name_check CHECK (length(name) BETWEEN 1 AND 80),
  ADD CONSTRAINT snippets_body_check CHECK (length(body) BETWEEN 1 AND 20000);
-- A shared snippet is readable by the people beneath its owner, never by siblings or by people above.
CREATE POLICY shared_read ON snippets FOR SELECT
  USING (shared AND owner_node_id IS NOT NULL AND EXISTS (SELECT 1 FROM org_reach r WHERE r.ancestor_id = owner_node_id AND r.descendant_id = ANY (app_node_ids())));

ALTER TABLE contacts ADD COLUMN email_opt_out_at timestamptz;

CREATE TABLE mail_merges (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  user_id     uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  subject     text NOT NULL CHECK (length(subject) BETWEEN 1 AND 300),
  body        text NOT NULL CHECK (length(body) BETWEEN 1 AND 20000),
  locale      text NOT NULL DEFAULT 'en' CHECK (locale IN ('en', 'fr-CA')),
  status      text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'running', 'paused', 'done', 'cancelled')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  started_at  timestamptz,
  finished_at timestamptz
);
CREATE INDEX ON mail_merges (user_id, created_at DESC);

CREATE TABLE mail_merge_recipients (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id),
  merge_id       uuid NOT NULL REFERENCES mail_merges(id) ON DELETE CASCADE,
  user_id        uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  owner_node_id  uuid NOT NULL REFERENCES org_nodes(id),
  box_id         uuid REFERENCES boxes(id) ON DELETE SET NULL,
  contact_id     uuid REFERENCES contacts(id) ON DELETE SET NULL,
  email          text NOT NULL CHECK (length(email) <= 320),
  status         text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'skipped')),
  error          text,
  subject        text,
  claimed_at     timestamptz,
  sent_at        timestamptz,
  gmail_thread_id text,
  unsub_hash     text UNIQUE,
  unsubscribed_at timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (merge_id, email)
);
CREATE INDEX ON mail_merge_recipients (merge_id, status);
CREATE INDEX ON mail_merge_recipients (user_id, sent_at) WHERE sent_at IS NOT NULL;

ALTER TABLE mail_merges ENABLE ROW LEVEL SECURITY;
ALTER TABLE mail_merges FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_wall ON mail_merges AS RESTRICTIVE USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
CREATE POLICY own_rows ON mail_merges USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id() AND app_can_write());
ALTER TABLE mail_merge_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE mail_merge_recipients FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_wall ON mail_merge_recipients AS RESTRICTIVE USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
CREATE POLICY own_rows ON mail_merge_recipients USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id() AND app_can_write());

-- "Add the contact to a mail merge when a record enters this stage".
ALTER TABLE automations ADD COLUMN merge_id uuid REFERENCES mail_merges(id) ON DELETE CASCADE;
ALTER TABLE automations DROP CONSTRAINT automations_action_check;
ALTER TABLE automations DROP CONSTRAINT automations_fields_check;
ALTER TABLE automations
  ADD CONSTRAINT automations_action_check CHECK (action IN ('create_task', 'assign_owner', 'add_note', 'move_stage', 'copy_to_pipeline', 'add_to_merge')),
  ADD CONSTRAINT automations_fields_check CHECK (
    (action = 'create_task' AND title IS NOT NULL) OR
    (action = 'assign_owner' AND assignee_user_id IS NOT NULL) OR
    (action = 'add_note' AND body IS NOT NULL) OR
    (action = 'move_stage' AND target_stage_id IS NOT NULL) OR
    (action = 'copy_to_pipeline' AND target_pipeline_id IS NOT NULL) OR
    (action = 'add_to_merge' AND merge_id IS NOT NULL));

-- The public unsubscribe page finds the recipient by the hash of the link's secret, then acts through normal row-level security.
GRANT SELECT (id, tenant_id, user_id, owner_node_id, contact_id, email, unsub_hash, unsubscribed_at) ON mail_merge_recipients TO app_auth;
-- Automations learn which merge to add to, and who owns it, before acting as that person.
GRANT SELECT (id, tenant_id, user_id, status) ON mail_merges TO app_auth;
