-- Client identity and anti-money-laundering records. Append-only: a correction is a new row.
-- PII records what was checked, by whom and when. It never stores ID numbers, and it does not file reports with FINTRAC.
CREATE TABLE client_id_records (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id),
  box_id         uuid NOT NULL REFERENCES boxes(id) ON DELETE CASCADE,
  method         text NOT NULL CHECK (method IN ('in_person','credit_file','dual_process')),
  documents_seen text[] NOT NULL DEFAULT '{}' CHECK (cardinality(documents_seen) <= 5),
  result         text NOT NULL CHECK (result IN ('verified','failed')),
  verified_on    date NOT NULL,
  verifier_id    uuid NOT NULL REFERENCES app_users(id),
  verifier_name  text NOT NULL,
  note           text CHECK (note IS NULL OR char_length(note) <= 500),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE screening_results (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id),
  box_id         uuid NOT NULL REFERENCES boxes(id) ON DELETE CASCADE,
  list           text NOT NULL CHECK (list IN ('pep','sanctions')),
  result         text NOT NULL CHECK (result IN ('clear','hit','cleared_after_review')),
  screened_on    date NOT NULL,
  reviewer_id    uuid NOT NULL REFERENCES app_users(id),
  reviewer_name  text NOT NULL,
  note           text CHECK (note IS NULL OR char_length(note) <= 500),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE cash_transactions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id),
  box_id           uuid NOT NULL REFERENCES boxes(id) ON DELETE CASCADE,
  amount           numeric(14,2) NOT NULL CHECK (amount > 0),
  currency         text NOT NULL DEFAULT 'CAD' CHECK (currency ~ '^[A-Z]{3}$'),
  occurred_on      date NOT NULL,
  report_required  boolean NOT NULL,
  report_ref       text CHECK (report_ref IS NULL OR char_length(report_ref) BETWEEN 1 AND 100),
  reported_at      timestamptz,
  recorded_by      uuid NOT NULL REFERENCES app_users(id),
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX client_id_records_box ON client_id_records (box_id, created_at DESC);
CREATE INDEX screening_results_box ON screening_results (box_id, created_at DESC);
CREATE INDEX cash_transactions_box ON cash_transactions (box_id, created_at DESC);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['client_id_records','screening_results','cash_transactions'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_wall ON %I AS RESTRICTIVE USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id())', t);
    EXECUTE format($f$CALL apply_visibility_policies(%L, 'EXISTS (SELECT 1 FROM boxes b WHERE b.id = box_id)')$f$, t);
  END LOOP;
END $$;
REVOKE ALL ON client_id_records, screening_results FROM app_runtime;
GRANT SELECT, INSERT ON client_id_records, screening_results TO app_runtime;
-- Cash entries: the amount and date can never change; the filing reference can be added once.
REVOKE ALL ON cash_transactions FROM app_runtime;
GRANT SELECT, INSERT, UPDATE (report_ref, reported_at) ON cash_transactions TO app_runtime;
CREATE FUNCTION cash_transactions_report_once() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.reported_at IS NOT NULL THEN RAISE EXCEPTION 'The report reference is already recorded' USING ERRCODE = '42501'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER cash_transactions_report_once BEFORE UPDATE ON cash_transactions FOR EACH ROW EXECUTE FUNCTION cash_transactions_report_once();
