-- California continuing education (first US state). The Department of Insurance sets a two-year term for each licence,
-- starting the day after that licence's last expiration, so the term cannot be a fixed calendar date. learner_licences
-- now holds the date the person's current term started; terms repeat every term_months from it.
ALTER TABLE learner_licences ADD COLUMN term_anchor date;

DROP FUNCTION ho_ce_licences();
CREATE FUNCTION ho_ce_licences() RETURNS TABLE (
  licence_id uuid, tenant_id uuid, company text, user_id uuid, name text, email text, pack_code text, licence_class text, licence_number text, licensed_since date, term_anchor date)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM ho_require();
  RETURN QUERY
  SELECT l.id, l.tenant_id, t.name, l.user_id, coalesce(u.display_name, u.email::text), u.email::text, l.pack_code, l.licence_class, l.licence_number, l.licensed_since, l.term_anchor
    FROM learner_licences l JOIN tenants t ON t.id = l.tenant_id AND NOT t.is_head_office JOIN app_users u ON u.id = l.user_id AND u.status::text <> 'disabled'
   ORDER BY t.name, u.display_name NULLS LAST, u.email LIMIT 5000;
END $$;
ALTER FUNCTION ho_ce_licences() OWNER TO app_headoffice;
REVOKE ALL ON FUNCTION ho_ce_licences() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ho_ce_licences() TO app_runtime;

-- California Department of Insurance, as of 2026-10-10. Agent and broker licences: 24 hours every two years, at least 3 on ethics.
-- Limited lines automobile: 20 hours every two years. Items not confirmed from the source are listed in the notes for counsel.
INSERT INTO ce_rule_packs (code, country, name, name_fr, source_url, term_start_month, term_start_day, term_months, requirements, new_licensee_exempt,
                           retention_years, retention_note, notes, notes_fr, as_of) VALUES
('ca_doi', 'US', 'California Department of Insurance', 'California Department of Insurance',
 'https://www.insurance.ca.gov/0200-industry/0050-renew-license/', 1, 1, 24,
 '{"classes":[
    {"key":"agent","label":"Life, accident and health, property and casualty, or personal lines","label_fr":"Vie, accident et maladie, dommages ou lignes personnelles","total":24,"min":{"ethics":3},"max":{}},
    {"key":"limited_auto","label":"Limited lines: automobile","label_fr":"Lignes limitées : automobile","total":20,"min":{},"max":{}}]}',
 false, 5,
 'California requires you to keep CE completion certificates for at least 5 years.',
 'Two-year term that starts the day after your licence last expired; enter that date on your licence. Finish at least 60 days before your licence expires. A course cannot be repeated for credit in the same term, partial credit is not given, and extra ethics hours do not carry over. Not yet confirmed with counsel: the 1-hour fraud-awareness requirement some licence types carry, any exemption for new licensees, and the separate long-term-care and annuity training. Check with the Department before relying on this.',
 'Période de deux ans qui commence le lendemain de la dernière expiration du permis; saisissez cette date. Terminez au moins 60 jours avant l’expiration. Un cours ne peut pas être repris dans la même période, aucun crédit partiel n’est accordé et les heures d’éthique excédentaires ne se reportent pas. À confirmer avec un conseiller : l’heure de sensibilisation à la fraude, toute exemption pour les nouveaux titulaires et la formation distincte sur les soins de longue durée et les rentes.',
 '2026-10-10');
