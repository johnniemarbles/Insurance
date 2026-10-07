-- Won and Lost stages stay last. Earlier, a stage added later landed after them; put open stages first again.
-- Only pipelines where an open stage sits after a Won/Lost stage are touched; relative order inside each group is kept.
WITH bad AS (
  SELECT DISTINCT o.pipeline_id FROM stages o
   WHERE NOT o.is_won AND NOT o.is_lost
     AND EXISTS (SELECT 1 FROM stages w WHERE w.pipeline_id = o.pipeline_id AND (w.is_won OR w.is_lost) AND w.position < o.position)
)
UPDATE stages SET position = position + 1000 WHERE pipeline_id IN (SELECT pipeline_id FROM bad);

WITH ranked AS (
  SELECT id, row_number() OVER (PARTITION BY pipeline_id ORDER BY CASE WHEN is_lost THEN 2 WHEN is_won THEN 1 ELSE 0 END, position) AS rn
    FROM stages WHERE position >= 1000
)
UPDATE stages s SET position = r.rn FROM ranked r WHERE s.id = r.id;
