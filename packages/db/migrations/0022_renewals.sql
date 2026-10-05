-- Which renewal reminders have already been made, so each record gets each reminder once per renewal date.
CREATE TABLE renewal_marks (
  box_id       uuid NOT NULL REFERENCES boxes(id) ON DELETE CASCADE,
  tenant_id    uuid NOT NULL REFERENCES tenants(id),
  threshold    int  NOT NULL CHECK (threshold IN (90, 60, 30)),
  renewal_date date NOT NULL,
  made_task    boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (box_id, threshold, renewal_date)
);
ALTER TABLE renewal_marks ENABLE ROW LEVEL SECURITY;
ALTER TABLE renewal_marks FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_wall ON renewal_marks AS RESTRICTIVE USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
CALL apply_visibility_policies('renewal_marks', 'EXISTS (SELECT 1 FROM boxes b WHERE b.id = box_id)');
