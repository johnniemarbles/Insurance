-- Atomic, tenant-scoped authorization predicate for future carrier submissions.
-- Call inside the same transaction as a submission write, after locking the contract.
CREATE OR REPLACE FUNCTION carrier_product_submission_authorized(
 p_contract_id uuid, p_product_code text
) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS (
  SELECT 1 FROM carrier_contract_cases c
  JOIN onboarding_cases oc ON oc.id=c.onboarding_case_id
   AND oc.tenant_id=c.tenant_id AND oc.node_id=c.node_id
  JOIN carrier_product_activations g ON g.contract_id=c.id
   AND g.tenant_id=c.tenant_id AND g.node_id=c.node_id
   AND g.product_code=p_product_code AND g.revoked_at IS NULL
  WHERE c.id=p_contract_id AND c.tenant_id=app_tenant_id()
   AND c.state='active'
   AND c.appointment_effective_on<=CURRENT_DATE
   AND c.appointment_expires_on>=CURRENT_DATE
   AND oc.stage='active' AND oc.standing='good_standing'
   AND NOT EXISTS (
    SELECT 1 FROM carrier_compliance_holds h
    WHERE h.tenant_id=c.tenant_id AND h.node_id=c.node_id
     AND h.contract_id=c.id AND h.released_at IS NULL
   )
   AND EXISTS (
    SELECT 1 FROM onboarding_agreements a
    WHERE a.tenant_id=c.tenant_id AND a.case_id=c.onboarding_case_id
     AND a.officer_signed_at IS NOT NULL
   )
   AND EXISTS (
    SELECT 1 FROM compliance_items i
    WHERE i.tenant_id=c.tenant_id AND i.node_id=c.node_id
     AND i.kind='licence' AND i.expires_on>=CURRENT_DATE
     AND upper(i.jurisdiction)=upper(c.jurisdiction)
   )
   AND EXISTS (
    SELECT 1 FROM compliance_items i
    WHERE i.tenant_id=c.tenant_id AND i.node_id=c.node_id
     AND i.kind='eo' AND i.expires_on>=CURRENT_DATE
   )
   AND (
    SELECT count(DISTINCT e.kind)
    FROM carrier_authorization_evidence e
    WHERE e.tenant_id=c.tenant_id AND e.node_id=c.node_id
     AND e.contract_id=c.id AND e.product_code=p_product_code
     AND e.revoked_at IS NULL AND e.effective_on<=CURRENT_DATE
     AND e.expires_on>=CURRENT_DATE
   )=4
 )
$$;
REVOKE ALL ON FUNCTION carrier_product_submission_authorized(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION carrier_product_submission_authorized(uuid,text) TO app_runtime;
