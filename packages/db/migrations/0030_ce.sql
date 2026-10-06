-- Continuing education (CE) for licensed insurance people.
--
--  * ce_rule_packs: what each regulator asks for (hours, categories, term dates, how long records are kept).
--    One row per regulator. Reference data shared by every company; changed only by a migration, so each
--    change has a date and a reviewer in the repository.
--  * learner_licences: which regulator and licence class a person is held to.
--  * ce_entries: the hours ledger. Hours come from PII courses (automatic) or are logged by the person with proof.
--    Entries are never edited or deleted before their legal retention date.
--  * Head office (the country's compliance officer) reads across companies through narrow functions, as for partner compliance.

ALTER TABLE courses
  ADD COLUMN ce_pack     text,
  ADD COLUMN ce_hours    numeric(4,1) CHECK (ce_hours IS NULL OR ce_hours BETWEEN 0.5 AND 40),
  ADD COLUMN ce_category text CHECK (ce_category IS NULL OR ce_category IN ('technical', 'management', 'ethics', 'professional_development', 'general')),
  ADD CONSTRAINT courses_ce_all_or_none CHECK ((ce_pack IS NULL) = (ce_hours IS NULL) AND (ce_pack IS NULL) = (ce_category IS NULL));

CREATE TABLE ce_rule_packs (
  code             text PRIMARY KEY CHECK (code ~ '^[a-z0-9_]{2,30}$'),
  country          text NOT NULL CHECK (country IN ('CA', 'US')),
  name             text NOT NULL,
  name_fr          text NOT NULL,
  source_url       text NOT NULL,
  term_start_month int  NOT NULL CHECK (term_start_month BETWEEN 1 AND 12),
  term_start_day   int  NOT NULL CHECK (term_start_day BETWEEN 1 AND 28),
  term_months      int  NOT NULL DEFAULT 12 CHECK (term_months BETWEEN 1 AND 48),
  requirements     jsonb NOT NULL,       -- { classes: [{ key, label, label_fr, total, min: {cat: h}, max: {cat: h} }] }
  new_licensee_exempt boolean NOT NULL DEFAULT false,
  retention_years  int  NOT NULL CHECK (retention_years BETWEEN 1 AND 15),
  retention_note   text NOT NULL,
  notes            text NOT NULL DEFAULT '',
  notes_fr         text NOT NULL DEFAULT '',
  as_of            date NOT NULL,
  active           boolean NOT NULL DEFAULT true
);
GRANT SELECT ON ce_rule_packs TO app_runtime;

ALTER TABLE courses ADD CONSTRAINT courses_ce_pack_fk FOREIGN KEY (ce_pack) REFERENCES ce_rule_packs(code);

-- Ontario: RIBO. CE term 1 October to 30 September. Principal brokers 10 hours (5 management, 1 ethics, 4 of any kind but
-- not professional development); other brokers 8 hours (3 technical, 1 ethics, 4 of any kind with at most 2 professional development).
INSERT INTO ce_rule_packs (code, country, name, name_fr, source_url, term_start_month, term_start_day, term_months, requirements, new_licensee_exempt,
                           retention_years, retention_note, notes, notes_fr, as_of) VALUES
('ribo', 'CA', 'RIBO (Ontario general insurance brokers)', 'RIBO (courtiers d’assurance générale de l’Ontario)', 'https://ribo.com/?p=114', 10, 1, 12,
 '{"classes":[
    {"key":"principal","label":"Principal broker","label_fr":"Courtier principal","total":10,"min":{"management":5,"ethics":1},"max":{"professional_development":0}},
    {"key":"broker","label":"Broker (not principal)","label_fr":"Courtier (non principal)","total":8,"min":{"technical":3,"ethics":1},"max":{"professional_development":2}}]}',
 true, 7,
 'RIBO keeps no CE record for its members, so the agency keeps the proof. RIBO sets no retention period that we could confirm; 7 years is used until counsel confirms.',
 'Term 1 October to 30 September. Carry-over of surplus hours into the next term is allowed once; PII does not apply it automatically. New licensees are exempt for the rest of their first registration year.',
 'Période du 1er octobre au 30 septembre. Le report des heures excédentaires à la période suivante est permis une fois; PII ne l’applique pas automatiquement. Les nouveaux titulaires sont exemptés pour le reste de leur première année d’inscription.',
 '2026-10-07'),
-- British Columbia: Insurance Council of BC. Licence period 1 June to 31 May, 15 CE credits; records kept for the past 5 periods.
('icbc', 'CA', 'Insurance Council of British Columbia', 'Insurance Council of British Columbia', 'https://www.insurancecouncilofbc.com/', 6, 1, 12,
 '{"classes":[{"key":"licensee","label":"Licensee","label_fr":"Titulaire de permis","total":15,"min":{},"max":{}}]}',
 true, 5,
 'The Insurance Council of BC requires licensees to keep CE records for the past 5 licence periods.',
 'Licence period 1 June to 31 May, 15 credits. Courses from non-accredited providers can count. New licensees are exempt in their first period. Confirm any extra rules for your licence level with the Council.',
 'Période de permis du 1er juin au 31 mai, 15 crédits. Les cours de fournisseurs non agréés peuvent compter. Les nouveaux titulaires sont exemptés pendant leur première période. Confirmez auprès du Conseil toute règle additionnelle selon votre niveau de permis.',
 '2026-10-07');

CREATE TABLE learner_licences (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id),
  user_id        uuid NOT NULL REFERENCES app_users(id),
  node_id        uuid NOT NULL REFERENCES org_nodes(id),   -- the person's home node when the licence was recorded
  pack_code      text NOT NULL REFERENCES ce_rule_packs(code),
  licence_class  text NOT NULL CHECK (length(licence_class) BETWEEN 1 AND 30),
  licence_number text CHECK (licence_number IS NULL OR length(licence_number) <= 60),
  licensed_since date,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, pack_code)
);
CREATE INDEX ON learner_licences (tenant_id, node_id);

CREATE TABLE ce_entries (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  user_id       uuid NOT NULL REFERENCES app_users(id),
  node_id       uuid NOT NULL REFERENCES org_nodes(id),
  pack_code     text NOT NULL REFERENCES ce_rule_packs(code),
  title         text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  provider      text NOT NULL CHECK (length(provider) BETWEEN 1 AND 120),
  category      text NOT NULL CHECK (category IN ('technical', 'management', 'ethics', 'professional_development', 'general')),
  hours         numeric(4,1) NOT NULL CHECK (hours BETWEEN 0.5 AND 40),
  completed_on  date NOT NULL,
  source        text NOT NULL CHECK (source IN ('course', 'external')),
  enrollment_id uuid UNIQUE REFERENCES enrollments(id),
  status        text NOT NULL DEFAULT 'recorded' CHECK (status IN ('recorded', 'verified', 'rejected')),
  review_note   text CHECK (review_note IS NULL OR length(review_note) <= 300),
  reviewed_by   uuid,                    -- may be a head office person (another company): no foreign key
  reviewed_by_name text,
  reviewed_at   timestamptz,
  evidence_name text CHECK (evidence_name IS NULL OR length(evidence_name) <= 160),
  evidence_mime text CHECK (evidence_mime IS NULL OR evidence_mime IN ('application/pdf', 'image/png', 'image/jpeg')),
  evidence_data bytea CHECK (evidence_data IS NULL OR octet_length(evidence_data) <= 5242880),
  retain_until  date NOT NULL,           -- not deletable before this day
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK ((source = 'course') = (enrollment_id IS NOT NULL)),
  CHECK ((evidence_data IS NULL) = (evidence_mime IS NULL))
);
CREATE INDEX ON ce_entries (user_id, completed_on DESC);
CREATE INDEX ON ce_entries (tenant_id, pack_code, completed_on);

-- Legal retention: nobody, not even a tenant administrator, can delete an entry before its date.
CREATE FUNCTION ce_entries_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.retain_until > current_date THEN
      RAISE EXCEPTION 'This CE record must be kept until % by law', OLD.retain_until USING ERRCODE = '23001';
    END IF;
    RETURN OLD;
  END IF;
  -- Only the review fields can change after the entry is made.
  IF NEW.user_id <> OLD.user_id OR NEW.tenant_id <> OLD.tenant_id OR NEW.pack_code <> OLD.pack_code OR NEW.title <> OLD.title OR NEW.provider <> OLD.provider
     OR NEW.category <> OLD.category OR NEW.hours <> OLD.hours OR NEW.completed_on <> OLD.completed_on OR NEW.source <> OLD.source
     OR NEW.retain_until < OLD.retain_until OR NEW.evidence_data IS DISTINCT FROM OLD.evidence_data THEN
    RAISE EXCEPTION 'A CE record cannot be changed once it is made' USING ERRCODE = '23001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER ce_entries_guard BEFORE UPDATE OR DELETE ON ce_entries FOR EACH ROW EXECUTE FUNCTION ce_entries_guard();

-- Who can see a person's CE file: the person, a company administrator, and anyone who leads the person's branch or a branch above.
-- Colleagues at the same level cannot.
CREATE FUNCTION ce_visible(p_tenant uuid, p_user uuid, p_node uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT p_tenant = app_tenant_id() AND (
       p_user = app_user_id()
    OR app_is_tenant_admin()
    OR EXISTS (SELECT 1 FROM user_node_roles r
                WHERE r.user_id = app_user_id() AND r.role::text IN ('admin', 'manager', 'trainer', 'partner')
                  AND (r.node_id = p_node OR EXISTS (SELECT 1 FROM org_reach x WHERE x.ancestor_id = r.node_id AND x.descendant_id = p_node))))
$$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['learner_licences', 'ce_entries'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_wall ON %I AS RESTRICTIVE USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id())', t);
  END LOOP;
END $$;
CALL apply_visibility_policies('learner_licences', 'ce_visible(tenant_id, user_id, node_id)');
CALL apply_visibility_policies('ce_entries', 'ce_visible(tenant_id, user_id, node_id)');

GRANT SELECT, INSERT, UPDATE, DELETE ON learner_licences, ce_entries TO app_runtime;

-- Head office: the country's compliance officer reads every company's CE file, and can verify or reject an entry. Nothing else.
GRANT SELECT ON ce_rule_packs, learner_licences, ce_entries TO app_headoffice;
GRANT UPDATE (status, review_note, reviewed_by, reviewed_by_name, reviewed_at) ON ce_entries TO app_headoffice;
GRANT CREATE ON SCHEMA public TO app_headoffice;

CREATE FUNCTION ho_ce_licences() RETURNS TABLE (
  licence_id uuid, tenant_id uuid, company text, user_id uuid, name text, email text, pack_code text, licence_class text, licence_number text, licensed_since date)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM ho_require();
  RETURN QUERY
  SELECT l.id, l.tenant_id, t.name, l.user_id, coalesce(u.display_name, u.email::text), u.email::text, l.pack_code, l.licence_class, l.licence_number, l.licensed_since
    FROM learner_licences l JOIN tenants t ON t.id = l.tenant_id AND NOT t.is_head_office JOIN app_users u ON u.id = l.user_id AND u.status::text <> 'disabled'
   ORDER BY t.name, u.display_name NULLS LAST, u.email LIMIT 5000;
END $$;

CREATE FUNCTION ho_ce_entries(p_since date) RETURNS TABLE (
  entry_id uuid, tenant_id uuid, company text, user_id uuid, pack_code text, title text, provider text, category text, hours numeric, completed_on date,
  source text, status text, review_note text, has_evidence boolean, retain_until date)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM ho_require();
  RETURN QUERY
  SELECT e.id, e.tenant_id, t.name, e.user_id, e.pack_code, e.title, e.provider, e.category, e.hours, e.completed_on, e.source, e.status, e.review_note,
         (e.evidence_data IS NOT NULL), e.retain_until
    FROM ce_entries e JOIN tenants t ON t.id = e.tenant_id AND NOT t.is_head_office
   WHERE e.completed_on >= p_since ORDER BY e.completed_on DESC LIMIT 30000;
END $$;

CREATE FUNCTION ho_ce_evidence(p_entry uuid) RETURNS TABLE (filename text, mime text, data bytea)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM ho_require();
  RETURN QUERY SELECT e.evidence_name, e.evidence_mime, e.evidence_data FROM ce_entries e JOIN tenants t ON t.id = e.tenant_id AND NOT t.is_head_office
   WHERE e.id = p_entry AND e.evidence_data IS NOT NULL;
END $$;

CREATE FUNCTION ho_ce_review(p_entry uuid, p_decision text, p_note text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE who text; done int;
BEGIN
  PERFORM ho_require();
  IF p_decision NOT IN ('verified', 'rejected') THEN RAISE EXCEPTION 'Decision must be verified or rejected' USING ERRCODE = '22023'; END IF;
  SELECT coalesce(display_name, email::text) INTO who FROM app_users WHERE id = app_user_id();
  UPDATE ce_entries SET status = p_decision, review_note = nullif(left(coalesce(p_note, ''), 300), ''), reviewed_by = app_user_id(), reviewed_by_name = who, reviewed_at = now()
   WHERE id = p_entry AND tenant_id IN (SELECT id FROM tenants WHERE NOT is_head_office);
  GET DIAGNOSTICS done = ROW_COUNT;
  RETURN done > 0;
END $$;

ALTER FUNCTION ho_ce_licences() OWNER TO app_headoffice;
ALTER FUNCTION ho_ce_entries(date) OWNER TO app_headoffice;
ALTER FUNCTION ho_ce_evidence(uuid) OWNER TO app_headoffice;
ALTER FUNCTION ho_ce_review(uuid, text, text) OWNER TO app_headoffice;
REVOKE ALL ON FUNCTION ho_ce_licences(), ho_ce_entries(date), ho_ce_evidence(uuid), ho_ce_review(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ho_ce_licences(), ho_ce_entries(date), ho_ce_evidence(uuid), ho_ce_review(uuid, text, text) TO app_runtime;

-- Certificates: say which agency issued them, and make the public check page possible without signing in.
CREATE FUNCTION certificate_public(p_code text) RETURNS TABLE (
  code text, issued_at timestamptz, learner text, course text, company text, hours numeric, category text, pack text, locale text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT c.verification_code, c.issued_at, coalesce(u.display_name, u.email::text),
         coalesce((SELECT cl.title FROM course_locales cl WHERE cl.course_id = co.id AND cl.locale::text = c.locale::text),
                  (SELECT cl.title FROM course_locales cl WHERE cl.course_id = co.id AND cl.locale = 'en'), ''),
         t.name, co.ce_hours, co.ce_category, co.ce_pack, c.locale::text
    FROM certificates c JOIN enrollments e ON e.id = c.enrollment_id JOIN courses co ON co.id = e.course_id
    JOIN app_users u ON u.id = e.user_id JOIN tenants t ON t.id = c.tenant_id
   WHERE c.verification_code = p_code
$$;
ALTER FUNCTION certificate_public(text) OWNER TO app_headoffice;
GRANT SELECT ON certificates, enrollments, courses, course_locales TO app_headoffice;
REVOKE ALL ON FUNCTION certificate_public(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION certificate_public(text) TO app_auth;

REVOKE CREATE ON SCHEMA public FROM app_headoffice;
