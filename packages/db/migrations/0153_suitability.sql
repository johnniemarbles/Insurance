-- Suitability check before submission (roadmap Phase 2, feature 5). Before a deal enters a stage that requires it
-- (compliance adds "Suitability review" to the stage's required paperwork), the advisor runs a check of the current
-- signed recommendation against the needs analysis it answers and the company's rulebook. PII's own rules find the
-- certain gaps (cover below the need, premium over budget, replacement without disclosure ...); when the co-pilot is
-- on, the AI service adds questions about fit, each citing the records it used. The check advises; it never approves.
-- The advisor decides (proceeds with a written reason, or asks compliance); compliance clears or sends it back.
-- Ships switched off (SUITABILITY_ENABLED); changes no existing row.

ALTER TABLE stage_doc_requirements DROP CONSTRAINT stage_doc_requirements_doc_type_check;
ALTER TABLE stage_doc_requirements ADD CONSTRAINT stage_doc_requirements_doc_type_check CHECK (doc_type IN
  ('privacy_consent', 'brokerage_agreement', 'needs_analysis', 'id_record', 'pink_slip_optin', 'beneficiary_designation', 'recommendation',
   'replacement_disclosure', 'suitability_review'));

CREATE TABLE suitability_checks (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES tenants(id),
  box_id             uuid NOT NULL REFERENCES boxes(id) ON DELETE CASCADE,
  -- The signed records checked. A newer signed recommendation makes this check stale for the gate.
  recommendation_id  uuid NOT NULL REFERENCES advice_records(id),
  needs_analysis_id  uuid NOT NULL REFERENCES advice_records(id),
  -- [{ "source": "rule"|"ai", "code": "below_need"|..., "severity": "gap"|"question", "text": "...", "cites": ["N1","R1","P2"] }]
  findings           jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(findings) = 'array' AND jsonb_array_length(findings) <= 25),
  ai_used            boolean NOT NULL,
  ai_provider        text CHECK (ai_provider IS NULL OR ai_provider IN ('anthropic', 'openai', 'gemini', 'default')),
  status             text NOT NULL CHECK (status IN ('no_gaps', 'open', 'proceeded', 'referred', 'cleared', 'returned')),
  run_by             uuid NOT NULL REFERENCES app_users(id),
  run_by_name        text NOT NULL,
  advisor_note       text CHECK (advisor_note IS NULL OR char_length(advisor_note) BETWEEN 10 AND 2000),
  advisor_decided_at timestamptz,
  reviewer_id        uuid REFERENCES app_users(id),
  reviewer_name      text,
  reviewer_note      text CHECK (reviewer_note IS NULL OR char_length(reviewer_note) BETWEEN 10 AND 2000),
  reviewed_at        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX suitability_checks_box ON suitability_checks (box_id, created_at DESC);
CREATE INDEX suitability_checks_queue ON suitability_checks (tenant_id, status) WHERE status = 'referred';
ALTER TABLE suitability_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE suitability_checks FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_wall ON suitability_checks AS RESTRICTIVE USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
CALL apply_visibility_policies('suitability_checks', 'EXISTS (SELECT 1 FROM boxes b WHERE b.id = box_id)');
REVOKE ALL ON suitability_checks FROM app_runtime;
GRANT SELECT, INSERT, UPDATE (status, advisor_note, advisor_decided_at, reviewer_id, reviewer_name, reviewer_note, reviewed_at) ON suitability_checks TO app_runtime;

-- Allowed moves: open → proceeded | referred; referred → cleared | returned. Everything else is final. The records
-- checked must be signed advice of the right kinds on the same deal, and a check is run as the person running it.
CREATE FUNCTION suitability_checks_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.run_by IS DISTINCT FROM app_user_id() THEN
      RAISE EXCEPTION 'A suitability check is run as the person running it' USING ERRCODE = '42501';
    END IF;
    IF NEW.status NOT IN ('no_gaps', 'open') THEN
      RAISE EXCEPTION 'A new suitability check starts open' USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM advice_records a WHERE a.id = NEW.recommendation_id AND a.box_id = NEW.box_id AND a.kind = 'recommendation' AND a.status = 'signed')
       OR NOT EXISTS (SELECT 1 FROM advice_records a WHERE a.id = NEW.needs_analysis_id AND a.box_id = NEW.box_id AND a.kind = 'needs_analysis' AND a.status = 'signed') THEN
      RAISE EXCEPTION 'A suitability check needs the signed needs analysis and recommendation on this deal' USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
  END IF;
  IF (OLD.status, NEW.status) NOT IN (('open', 'proceeded'), ('open', 'referred'), ('referred', 'cleared'), ('referred', 'returned')) THEN
    RAISE EXCEPTION 'This suitability check cannot move from % to %', OLD.status, NEW.status USING ERRCODE = '42501';
  END IF;
  IF NEW.status IN ('cleared', 'returned') AND NEW.reviewer_id IS DISTINCT FROM app_user_id() THEN
    RAISE EXCEPTION 'A suitability review is recorded as the person making it' USING ERRCODE = '42501';
  END IF;
  IF NEW.status IN ('cleared', 'returned') AND NEW.reviewer_id = NEW.run_by THEN
    RAISE EXCEPTION 'The person who ran a suitability check cannot clear it' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER suitability_checks_guard BEFORE INSERT OR UPDATE ON suitability_checks FOR EACH ROW EXECUTE FUNCTION suitability_checks_guard();

ALTER TABLE copilot_log DROP CONSTRAINT copilot_log_kind_check;
ALTER TABLE copilot_log ADD CONSTRAINT copilot_log_kind_check CHECK (kind IN ('ask', 'rulebook', 'letter', 'meeting', 'suitability'));
