-- A company can have each starter course once. courses.starter_key says which one a copy came from.
ALTER TABLE courses ADD COLUMN starter_key text;

-- Backfill from the audit trail, then retire the extra untouched copies (keep the published one, otherwise the oldest).
WITH src AS (
  SELECT c.id, c.tenant_id, a.detail->>'starter' AS k, c.status, c.created_at,
         row_number() OVER (PARTITION BY c.tenant_id, a.detail->>'starter'
                            ORDER BY (c.status = 'published') DESC, c.created_at, c.id) AS rn
    FROM courses c
    JOIN audit_log a ON a.entity_type = 'course' AND a.entity_id = c.id AND a.action = 'course_created' AND a.detail ? 'starter'
   WHERE c.status <> 'archived'
)
UPDATE courses c SET starter_key = CASE WHEN s.rn = 1 THEN s.k END,
                     status = CASE WHEN s.rn > 1 AND c.status = 'draft' THEN 'archived'::course_status ELSE c.status END
  FROM src s WHERE s.id = c.id;

-- Any further copies that were already published stay as they are, but are not linked to the starter.
CREATE UNIQUE INDEX courses_starter_once ON courses (tenant_id, starter_key) WHERE starter_key IS NOT NULL AND status <> 'archived';
