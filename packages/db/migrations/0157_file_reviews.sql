-- File review sampling (roadmap Phase 3, feature 10). Each month every compliance officer gets a sample of the deals
-- they supervise: some picked for risk (replacement, large amounts, flags, screening hits, new advisors, past findings),
-- the rest at random. The officer works a checklist (PII pre-fills what it can see), writes findings, and sets a fix-by
-- date when something needs fixing. The advisor sees the findings on the deal and marks them fixed; the officer checks
-- and closes the review. Late fixes are reminded. Unlike the existing advice reviews (one signed piece of advice), a
-- file review looks at the whole deal.
-- Ships switched off (FILE_REVIEWS_ENABLED); changes no existing row.

CREATE TABLE file_reviews (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id),
  box_id         uuid NOT NULL REFERENCES boxes(id) ON DELETE CASCADE,
  period         text NOT NULL CHECK (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  reviewer_id    uuid NOT NULL REFERENCES app_users(id),
  reviewer_name  text NOT NULL,
  advisor_id     uuid REFERENCES app_users(id),
  reason         text NOT NULL CHECK (reason IN ('risk', 'random', 'requested')),
  risk_score     int NOT NULL DEFAULT 0 CHECK (risk_score BETWEEN 0 AND 100),
  risk_reasons   text[] NOT NULL DEFAULT '{}' CHECK (cardinality(risk_reasons) <= 12),
  status         text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'passed', 'findings', 'fixed', 'closed')),
  -- { "id_on_file": "yes"|"no"|"na", ... } for the checklist items in the API.
  checklist      jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(checklist) = 'object'),
  findings       text CHECK (findings IS NULL OR char_length(findings) BETWEEN 10 AND 4000),
  fix_by         date,
  reviewed_at    timestamptz,
  fixed_note     text CHECK (fixed_note IS NULL OR char_length(fixed_note) BETWEEN 10 AND 2000),
  fixed_by_name  text,
  fixed_at       timestamptz,
  closed_note    text CHECK (closed_note IS NULL OR char_length(closed_note) <= 2000),
  closed_at      timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (box_id, period),
  CHECK (status <> 'findings' OR (findings IS NOT NULL AND fix_by IS NOT NULL)),
  CHECK (status <> 'passed' OR findings IS NOT NULL),
  CHECK (reviewer_id IS DISTINCT FROM advisor_id)
);
CREATE INDEX file_reviews_reviewer ON file_reviews (tenant_id, reviewer_id, period);
CREATE INDEX file_reviews_box ON file_reviews (box_id, created_at DESC);
ALTER TABLE file_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE file_reviews FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_wall ON file_reviews AS RESTRICTIVE USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
CALL apply_visibility_policies('file_reviews', 'EXISTS (SELECT 1 FROM boxes b WHERE b.id = box_id)');
REVOKE ALL ON file_reviews FROM app_runtime;
GRANT SELECT, INSERT, UPDATE (status, checklist, findings, fix_by, reviewed_at, fixed_note, fixed_by_name, fixed_at, closed_note, closed_at) ON file_reviews TO app_runtime;
-- The background sweep finds late fixes across companies with the sign-in role: these columns only.
GRANT SELECT (id, tenant_id, box_id, reviewer_id, advisor_id, status, fix_by) ON file_reviews TO app_auth;

-- The reviewer reviews; the advisor (anyone who can change the deal, never the reviewer) marks fixed; the reviewer closes.
-- Allowed moves: open → passed | findings; findings → fixed; fixed → closed | findings (not fixed after all); passed is final.
CREATE FUNCTION file_reviews_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'open' THEN RAISE EXCEPTION 'A file review starts open' USING ERRCODE = '22023'; END IF;
    RETURN NEW;
  END IF;
  IF NEW.status <> OLD.status AND (OLD.status, NEW.status) NOT IN (('open', 'passed'), ('open', 'findings'), ('findings', 'fixed'), ('fixed', 'closed'), ('fixed', 'findings')) THEN
    RAISE EXCEPTION 'A file review cannot move from % to %', OLD.status, NEW.status USING ERRCODE = '42501';
  END IF;
  IF OLD.status IN ('passed', 'closed') THEN
    RAISE EXCEPTION 'A finished file review cannot be changed' USING ERRCODE = '42501';
  END IF;
  IF NEW.status IN ('passed', 'findings', 'closed') AND NEW.status <> OLD.status AND OLD.reviewer_id IS DISTINCT FROM app_user_id() THEN
    RAISE EXCEPTION 'Only the assigned reviewer decides a file review' USING ERRCODE = '42501';
  END IF;
  IF NEW.status = 'fixed' AND OLD.status <> 'fixed' AND app_user_id() = OLD.reviewer_id THEN
    RAISE EXCEPTION 'The reviewer cannot mark their own findings fixed' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER file_reviews_guard BEFORE INSERT OR UPDATE ON file_reviews FOR EACH ROW EXECUTE FUNCTION file_reviews_guard();
