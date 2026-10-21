-- Annuity training for US licences (California, Texas). Both states require annuity-specific training before a producer
-- sells annuities, then more at each renewal. PII records it as CE hours in a new "annuity" category, and (switched on with
-- ANNUITY_GATE_ENABLED) stops an annuity deal moving past a paperwork stage until the advisor's initial training is done.
-- Changes no existing row except the two US rule packs, which gain an "annuity" rule.

ALTER TABLE ce_entries DROP CONSTRAINT ce_entries_category_check;
ALTER TABLE ce_entries ADD CONSTRAINT ce_entries_category_check
  CHECK (category IN ('technical', 'management', 'ethics', 'professional_development', 'general', 'annuity'));

-- California Insurance Code §1749.8, as amended by SB 263 (effective 1 Jan 2025): 8 hours of approved annuity training
-- before selling annuities, then 4 hours before each licence renewal; the first 8 do not count toward the 4.
UPDATE ce_rule_packs SET requirements = requirements || jsonb_build_object('annuity', jsonb_build_object(
  'initial', 8, 'renewal', 4,
  'note', '8 hours of Department-approved annuity training before selling annuities (the updated course with best-interest content, from 2025), then 4 hours before each licence renewal. The first 8 hours do not count toward the 4.',
  'note_fr', '8 heures de formation approuvée sur les rentes avant d’en vendre (le cours mis à jour avec la norme de meilleur intérêt, depuis 2025), puis 4 heures avant chaque renouvellement. Les 8 premières heures ne comptent pas pour les 4.',
  'source', 'https://law.justia.com/codes/california/code-ins/division-1/part-2/chapter-5/article-13-5/section-1749-8'))
 WHERE code = 'ca_doi';

-- Texas: a one-time 4-hour annuity course before selling annuities; 8 hours of annuity CE each two-year term after that
-- (28 TAC §19.1029, as reported by a training provider: counsel / confirm with TDI).
UPDATE ce_rule_packs SET requirements = requirements || jsonb_build_object('annuity', jsonb_build_object(
  'initial', 4, 'renewal', 8,
  'note', 'A one-time 4-hour annuity course before selling annuities, then 8 hours of annuity CE each two-year term (28 TAC §19.1029). To be confirmed with the Texas Department of Insurance.',
  'note_fr', 'Un cours unique de 4 heures sur les rentes avant d’en vendre, puis 8 heures de FC sur les rentes à chaque période de deux ans (28 TAC §19.1029). À confirmer auprès du Texas Department of Insurance.',
  'source', 'https://www.tdi.texas.gov/agent/agce.html'))
 WHERE code = 'tx_tdi';

-- What the gate needs about one advisor, whoever moves the deal: their licences with an annuity rule, and their annuity
-- hours (date and hours only). Same company only. Read with the head-office role, which already reads CE for reviews.
CREATE FUNCTION annuity_training_for(p_user uuid) RETURNS TABLE (
  pack_code text, pack_name text, term_start_month int, term_start_day int, term_months int, term_anchor date, rule jsonb, entries jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT l.pack_code, p.name, p.term_start_month, p.term_start_day, p.term_months, l.term_anchor, p.requirements -> 'annuity',
         coalesce((SELECT jsonb_agg(jsonb_build_object('completedOn', e.completed_on, 'hours', e.hours) ORDER BY e.completed_on)
                     FROM ce_entries e WHERE e.user_id = l.user_id AND e.pack_code = l.pack_code AND e.category = 'annuity' AND e.status <> 'rejected'), '[]'::jsonb)
    FROM learner_licences l JOIN ce_rule_packs p ON p.code = l.pack_code
   WHERE l.user_id = p_user AND l.tenant_id = app_tenant_id() AND p.requirements ? 'annuity'
$$;
ALTER FUNCTION annuity_training_for(uuid) OWNER TO app_headoffice;
REVOKE ALL ON FUNCTION annuity_training_for(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION annuity_training_for(uuid) TO app_runtime;
