-- A submission writer must hold the carrier contract row lock before checking
-- authorization, then insert its business record in that SAME transaction.
-- Hold creation and product activation also acquire this lock.
CREATE OR REPLACE FUNCTION carrier_product_submission_authorized_locked(
 p_contract_id uuid, p_product_code text
) RETURNS boolean LANGUAGE plpgsql VOLATILE AS $$
DECLARE v_id uuid;
BEGIN
 IF p_product_code IS NULL OR p_product_code !~ '^[A-Z0-9_-]{1,80}$' THEN
  RETURN false;
 END IF;
 SELECT c.id INTO v_id
 FROM carrier_contract_cases c
 WHERE c.id=p_contract_id AND c.tenant_id=app_tenant_id()
 FOR UPDATE;
 IF v_id IS NULL THEN RETURN false; END IF;
 RETURN carrier_product_submission_authorized(p_contract_id,p_product_code);
END $$;
REVOKE ALL ON FUNCTION carrier_product_submission_authorized_locked(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION carrier_product_submission_authorized_locked(uuid,text) TO app_runtime;
