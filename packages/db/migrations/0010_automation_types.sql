-- More automation types and triggers, a record of what ran, and the weekly summary event.

DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint WHERE conrelid = 'automations'::regclass AND contype = 'c' LOOP
    EXECUTE format('ALTER TABLE automations DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE automations
  ADD COLUMN trigger            text NOT NULL DEFAULT 'enter' CHECK (trigger IN ('enter', 'stale', 'email')),
  ADD COLUMN stale_days         integer,
  ADD COLUMN target_stage_id    uuid REFERENCES stages(id) ON DELETE CASCADE,
  ADD COLUMN target_pipeline_id uuid REFERENCES pipelines(id) ON DELETE CASCADE,
  ADD COLUMN body               text;

ALTER TABLE automations
  ADD CONSTRAINT automations_action_check CHECK (action IN ('create_task', 'assign_owner', 'add_note', 'move_stage', 'copy_to_pipeline')),
  ADD CONSTRAINT automations_title_check CHECK (title IS NULL OR length(title) BETWEEN 1 AND 300),
  ADD CONSTRAINT automations_due_check CHECK (due_in_days IS NULL OR due_in_days BETWEEN 0 AND 3650),
  ADD CONSTRAINT automations_body_check CHECK (body IS NULL OR length(body) BETWEEN 1 AND 1000),
  ADD CONSTRAINT automations_stale_check CHECK ((trigger = 'stale') = (stale_days IS NOT NULL) AND (stale_days IS NULL OR stale_days BETWEEN 1 AND 3650)),
  ADD CONSTRAINT automations_fields_check CHECK (
    (action = 'create_task' AND title IS NOT NULL) OR
    (action = 'assign_owner' AND assignee_user_id IS NOT NULL) OR
    (action = 'add_note' AND body IS NOT NULL) OR
    (action = 'move_stage' AND target_stage_id IS NOT NULL) OR
    (action = 'copy_to_pipeline' AND target_pipeline_id IS NOT NULL));

-- Each automation acts once per record per "occasion" (the time the record entered the stage, or the first received email).
CREATE TABLE automation_runs (
  automation_id uuid NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  box_id        uuid NOT NULL REFERENCES boxes(id) ON DELETE CASCADE,
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  run_key       text NOT NULL,
  ran_at        timestamptz NOT NULL DEFAULT now(),
  outcome       text NOT NULL DEFAULT 'done' CHECK (outcome IN ('done', 'skipped')),
  note          text,
  PRIMARY KEY (automation_id, box_id, run_key)
);
ALTER TABLE automation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_wall ON automation_runs AS RESTRICTIVE USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
CALL apply_visibility_policies('automation_runs', 'EXISTS (SELECT 1 FROM boxes b WHERE b.id = box_id)');

-- Weekly summary as an event for subscribers.
ALTER TABLE webhook_subscriptions DROP CONSTRAINT IF EXISTS webhook_subscriptions_events_check;
ALTER TABLE webhook_subscriptions
  ADD CONSTRAINT webhook_subscriptions_events_check CHECK (events <@ ARRAY['box.created', 'box.stage_changed', 'digest.weekly']::text[] AND cardinality(events) > 0),
  ADD COLUMN last_digest_at timestamptz;

-- The background sweep learns which automations exist (configuration only, no personal data), then reads and acts on records
-- through the normal row-level-security path, as the person who set the automation up. The auth role never reads records.
GRANT SELECT ON automations TO app_auth;
GRANT UPDATE (last_digest_at) ON webhook_subscriptions TO app_auth;
