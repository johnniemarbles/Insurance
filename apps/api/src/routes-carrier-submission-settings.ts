import type { FastifyInstance } from 'fastify';
import { withRequestTx } from '@pii/db';
import { forbidden, invalid } from './errors.ts';
import type { AppDeps } from './app.ts';

const EMAIL = /^[^\s@<>\u0000-\u001f]+@[^\s@<>\u0000-\u001f]+\.[^\s@<>\u0000-\u001f]+$/;
const email = (value: unknown, optional = false): string | null => {
  if (optional && (value === null || value === '')) return null;
  if (typeof value !== 'string' || value.length > 254 || !EMAIL.test(value)) throw invalid('Invalid contracting email address');
  return value;
};
const CARRIER = 'ia-financial-group';
export function registerCarrierSubmissionSettingsRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get('/v1/compliance/carrier-submission-settings/ia', async req => {
    const { ctx } = await deps.authenticate(req);
    if (!ctx.isTenantAdmin && !ctx.roles.some(r => r.role === 'compliance')) throw forbidden('Compliance access required');
    return withRequestTx(deps.appPool, ctx, async tx => {
      const row = (await tx.query(
        `SELECT carrier_id AS "carrierId", mode, recipient_to AS "recipientTo",
          recipient_cc AS "recipientCc", reply_to AS "replyTo",
          subject_template AS "subjectTemplate", body_template AS "bodyTemplate",
          recipient_verified_at AS "recipientVerifiedAt", sending_enabled AS "sendingEnabled",
          revision, updated_at AS "updatedAt"
          FROM carrier_submission_settings WHERE tenant_id = app_tenant_id() AND carrier_id = $1`, [CARRIER])).rows[0];
      return { settings: row ?? { carrierId: CARRIER, mode: 'manual', recipientTo: null,
        recipientCc: [], replyTo: null, subjectTemplate: 'Carrier contracting application — {{caseReference}}',
        bodyTemplate: 'Please review the attached contracting application.',
        recipientVerifiedAt: null, sendingEnabled: false, revision: 0 } };
    });
  });
  app.put('/v1/compliance/carrier-submission-settings/ia', async req => {
    const { ctx } = await deps.authenticate(req);
    if (!ctx.isTenantAdmin || !ctx.canWrite) throw forbidden('Tenant administrator required');
    const b = req.body;
    if (!b || typeof b !== 'object' || Array.isArray(b)) throw invalid('Object required');
    const x = b as Record<string, unknown>;
    const fields = ['mode','recipientTo','recipientCc','replyTo','subjectTemplate','bodyTemplate'];
    if (Object.keys(x).some(k => !fields.includes(k)) || fields.some(k => !(k in x))) throw invalid('Unexpected or missing fields');
    if (x.mode !== 'manual' && x.mode !== 'semi_automated') throw invalid('Invalid mode');
    const to = email(x.recipientTo, true);
    const replyTo = email(x.replyTo, true);
    if (!Array.isArray(x.recipientCc) || x.recipientCc.length > 10) throw invalid('Invalid CC list');
    const cc = x.recipientCc.map(v => email(v));
    if (new Set(cc).size !== cc.length) throw invalid('Duplicate CC address');
    if (typeof x.subjectTemplate !== 'string' || !x.subjectTemplate.trim() || x.subjectTemplate.length > 250 ||
      /[\r\n\u0000]/.test(x.subjectTemplate)) throw invalid('Invalid subject');
    if (typeof x.bodyTemplate !== 'string' || !x.bodyTemplate.trim() || x.bodyTemplate.length > 10000)
      throw invalid('Invalid email template');
    return withRequestTx(deps.appPool, ctx, async tx => {
      const result = await tx.query(
        `INSERT INTO carrier_submission_settings
         (tenant_id,carrier_id,mode,recipient_to,recipient_cc,reply_to,subject_template,body_template,updated_by)
         VALUES (app_tenant_id(),$1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (tenant_id,carrier_id) DO UPDATE SET
          mode=EXCLUDED.mode,recipient_to=EXCLUDED.recipient_to,recipient_cc=EXCLUDED.recipient_cc,
          reply_to=EXCLUDED.reply_to,subject_template=EXCLUDED.subject_template,body_template=EXCLUDED.body_template,
          recipient_verified_at=NULL,recipient_verified_by=NULL,recipient_verification_evidence=NULL,
          sending_enabled=false,revision=carrier_submission_settings.revision+1,
          updated_by=EXCLUDED.updated_by,updated_at=now()
         RETURNING revision,updated_at AS "updatedAt",sending_enabled AS "sendingEnabled"`,
        [CARRIER,x.mode,to,cc,replyTo,x.subjectTemplate,x.bodyTemplate,ctx.userId]);
      return { settings: result.rows[0], recipientVerified: false };
    });
  });
}
