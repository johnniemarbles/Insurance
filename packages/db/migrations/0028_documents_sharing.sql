-- Documents attached to a record. Stored encrypted in PII only; visible to whoever can see the record.
CREATE TABLE box_documents (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  box_id      uuid NOT NULL REFERENCES boxes(id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  mime        text NOT NULL CHECK (length(mime) BETWEEN 3 AND 100),
  size_bytes  integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 10485760),
  data_enc    bytea NOT NULL,
  key_id      text NOT NULL,
  uploaded_by uuid REFERENCES app_users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON box_documents (box_id, created_at DESC);
ALTER TABLE box_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE box_documents FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_wall ON box_documents AS RESTRICTIVE USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
CALL apply_visibility_policies('box_documents', 'EXISTS (SELECT 1 FROM boxes b WHERE b.id = box_id)');

-- A person can tell a teammate about a linked conversation.
ALTER TABLE notifications DROP CONSTRAINT notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check CHECK (kind IN
  ('assigned', 'task_assigned', 'mention', 'note', 'stage_change', 'capture', 'merge_done', 'unsubscribed', 'invite_accepted', 'invite_stale',
   'compliance_expiry', 'compliance_review', 'appointment_request', 'thread_shared', 'document_added'));
