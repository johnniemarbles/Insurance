-- Pipeline UI: stage colours, time in stage, stage history, ordering within a stage.
ALTER TABLE pipelines ADD COLUMN color_theme text NOT NULL DEFAULT 'rainbow'
  CHECK (color_theme IN ('rainbow', 'ocean', 'forest', 'sunset', 'mono'));
ALTER TABLE stages ADD COLUMN color text CHECK (color ~ '^#[0-9a-fA-F]{6}$');
ALTER TABLE boxes ADD COLUMN stage_entered_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE boxes ADD COLUMN position double precision NOT NULL DEFAULT 0;
CREATE INDEX boxes_stage_position ON boxes (stage_id, position, updated_at DESC);

-- History of what happened to a box. Written by the API, never edited or deleted by it.
CREATE TABLE box_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  box_id        uuid NOT NULL REFERENCES boxes(id) ON DELETE CASCADE,
  kind          text NOT NULL CHECK (kind IN ('created', 'stage_changed')),
  from_stage_id uuid REFERENCES stages(id) ON DELETE SET NULL,
  to_stage_id   uuid REFERENCES stages(id) ON DELETE SET NULL,
  actor_id      uuid REFERENCES app_users(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON box_events (box_id, created_at DESC);
CREATE INDEX ON box_events (tenant_id, created_at DESC);

ALTER TABLE box_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE box_events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_wall ON box_events AS RESTRICTIVE USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
CREATE POLICY vis_select ON box_events FOR SELECT USING (EXISTS (SELECT 1 FROM boxes b WHERE b.id = box_id));
CREATE POLICY vis_insert ON box_events FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM boxes b WHERE b.id = box_id) AND app_can_write());
-- no update or delete policy: history cannot be changed through the application role

-- Existing boxes get a starting event so "days in stage" and history make sense.
INSERT INTO box_events (tenant_id, box_id, kind, to_stage_id, actor_id, created_at)
SELECT tenant_id, id, 'created', stage_id, created_by, created_at FROM boxes;
UPDATE boxes SET stage_entered_at = updated_at;
REVOKE UPDATE, DELETE ON box_events FROM app_runtime;
