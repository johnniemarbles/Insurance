-- Co-pilot step 2: the company's rulebook (its own compliance manual, AML policy, carrier guides) that the co-pilot answers
-- from, quoting the passage; and two more kinds in the co-pilot log (rulebook questions, letter drafts).
-- Ships switched off (COPILOT_ENABLED). New tables and a widened check; changes no existing row.

ALTER TABLE copilot_log DROP CONSTRAINT copilot_log_kind_check;
ALTER TABLE copilot_log ADD CONSTRAINT copilot_log_kind_check CHECK (kind IN ('ask', 'rulebook', 'letter'));

-- One row per uploaded document. The text is kept (as passages, below); the file itself is not.
CREATE TABLE rulebook_documents (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id),
  title        text NOT NULL CHECK (char_length(title) BETWEEN 2 AND 200),
  file_name    text CHECK (file_name IS NULL OR char_length(file_name) <= 200),
  mime         text NOT NULL CHECK (char_length(mime) BETWEEN 3 AND 100),
  sha256       text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  passages     integer NOT NULL CHECK (passages >= 1),
  text_chars   integer NOT NULL,
  uploaded_by  uuid NOT NULL REFERENCES app_users(id),
  uploaded_by_name text NOT NULL,
  uploaded_at  timestamptz NOT NULL DEFAULT now(),
  retired_at   timestamptz,
  retired_by_name text
);
CREATE UNIQUE INDEX rulebook_documents_one_copy ON rulebook_documents (tenant_id, sha256) WHERE retired_at IS NULL;

CREATE TABLE rulebook_passages (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id),
  document_id  uuid NOT NULL REFERENCES rulebook_documents(id) ON DELETE CASCADE,
  ord          integer NOT NULL,
  heading      text CHECK (heading IS NULL OR char_length(heading) <= 300),
  body         text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
  -- 'simple' search (no stemming) works the same for English and French.
  tsv          tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce(heading, '') || ' ' || body)) STORED,
  UNIQUE (document_id, ord)
);
CREATE INDEX rulebook_passages_tsv ON rulebook_passages USING gin (tsv);
CREATE INDEX rulebook_passages_doc ON rulebook_passages (tenant_id, document_id);

-- Everyone in the company can read its rulebook; only compliance or a tenant admin adds or retires documents.
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['rulebook_documents', 'rulebook_passages'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_wall ON %I AS RESTRICTIVE USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id())', t);
    EXECUTE format('CREATE POLICY read_all ON %I FOR SELECT USING (true)', t);
    EXECUTE format('CREATE POLICY compliance_insert ON %I FOR INSERT WITH CHECK ((app_is_tenant_admin() OR app_is_compliance_role()) AND app_can_write())', t);
  END LOOP;
END $$;
CREATE POLICY compliance_retire ON rulebook_documents FOR UPDATE
  USING ((app_is_tenant_admin() OR app_is_compliance_role()) AND app_can_write())
  WITH CHECK ((app_is_tenant_admin() OR app_is_compliance_role()) AND app_can_write());
REVOKE ALL ON rulebook_documents, rulebook_passages FROM app_runtime;
GRANT SELECT, INSERT ON rulebook_documents, rulebook_passages TO app_runtime;
GRANT UPDATE (retired_at, retired_by_name) ON rulebook_documents TO app_runtime;
