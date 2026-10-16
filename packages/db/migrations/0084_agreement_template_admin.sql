-- The company administrator can save the agency-agreement wording, not only a Compliance Manager.
-- The Onboarding screen is already open to the company administrator. The paste box was not.

DROP POLICY tpl_insert ON onboarding_agreement_templates;
DROP POLICY tpl_update ON onboarding_agreement_templates;
CREATE POLICY tpl_insert ON onboarding_agreement_templates FOR INSERT
  WITH CHECK (app_can_write() AND (app_is_compliance_role() OR app_is_tenant_admin()));
CREATE POLICY tpl_update ON onboarding_agreement_templates FOR UPDATE
  USING (app_can_write() AND (app_is_compliance_role() OR app_is_tenant_admin()))
  WITH CHECK (app_can_write() AND (app_is_compliance_role() OR app_is_tenant_admin()));

DROP POLICY rev_insert ON onboarding_agreement_revisions;
CREATE POLICY rev_insert ON onboarding_agreement_revisions FOR INSERT
  WITH CHECK (app_can_write() AND (app_is_compliance_role() OR app_is_tenant_admin()));
