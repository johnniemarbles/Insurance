import type { AiClient } from './ai.ts';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Config } from '@pii/platform';
import { assertDeployment, type Db } from '@pii/db';
import type { Authenticator, Identity } from './auth.ts';
import type { GoogleClient } from './google.ts';
import { HttpError, mapDbError } from './errors.ts';
import { registerOrgRoutes } from './routes-org.ts';
import { registerPeopleRoutes } from './routes-people.ts';
import { registerPipelineRoutes } from './routes-pipelines.ts';
import { registerBoxRoutes } from './routes-boxes.ts';
import { registerContactRoutes } from './routes-contacts.ts';
import { registerFamilyRoutes } from './routes-families.ts';
import { registerFamilyInsuranceRoutes } from './routes-family-insurance.ts';
import { registerFamilyComplianceRoutes } from './routes-family-compliance.ts';
import type { KeyProvider } from '@pii/platform';
import { registerPageRoutes } from './routes-pages.ts';
import { registerThreadRoutes } from './routes-threads.ts';
import { registerNoteRoutes } from './routes-notes.ts';
import { registerLmsRoutes } from './routes-lms.ts';
import { registerInsightRoutes } from './routes-insights.ts';
import { registerAutomationRoutes } from './routes-automation.ts';
import { registerAliasRoutes } from './routes-alias.ts';
import { registerDocumentRoutes } from './routes-documents.ts';
import { registerGateRoutes } from './routes-gates.ts';
import { registerAdviceRoutes } from './routes-advice.ts';
import { registerAdviceReviewRoutes } from './routes-advice-review.ts';
import { registerAmlRoutes } from './routes-aml.ts';
import { registerSignRoutes } from './routes-sign.ts';
import { registerVaultRoutes } from './routes-vault.ts';
import { registerEsignRoutes } from './routes-esign.ts';
import { registerClientConsentRoutes } from './routes-client-consent.ts';
import { registerRetentionRoutes } from './routes-retention.ts';
import { registerIntegrationRoutes } from './routes-integrations.ts';
import { registerMergeRoutes } from './routes-merge.ts';
import { registerAiRoutes } from './routes-ai.ts';
import { registerSettingRoutes } from './routes-settings.ts';
import { registerNavRoutes } from './routes-nav.ts';
import { registerRenewalRoutes } from './renewals.ts';
import { registerComplianceRoutes } from './routes-compliance.ts';
import { registerOnboardingRoutes } from './routes-onboarding.ts';
import { registerCarrierContractRoutes } from './routes-carrier-contracts.ts';
import { registerCarrierSubmissionSettingsRoutes } from './routes-carrier-submission-settings.ts';
import { registerCarrierWorkflowRoutes } from './routes-carrier-workflow.ts';
import { registerCarrierWebhookRoutes } from './routes-carrier-webhooks.ts';
import { registerCarrierReviewRoutes } from './routes-carrier-review.ts';
import { registerCarrierEligibilityRoutes } from './routes-carrier-eligibility.ts';
import { registerCarrierExpiryRoutes } from './routes-carrier-expiry.ts';
import { registerCarrierHistoryRoutes } from './routes-carrier-history.ts';
import { registerCarrierAuthorizationEvidenceRoutes } from './routes-carrier-authorization-evidence.ts';
import { registerCarrierActivationRoutes } from './routes-carrier-activation.ts';
import { registerCarrierCertificationRoutes } from './routes-carrier-certifications.ts';
import { registerCarrierPreflightRoutes } from './routes-carrier-preflight.ts';
import { registerCarrierProductRevocationRoutes } from './routes-carrier-product-revocation.ts';
import { registerCarrierHoldRoutes } from './routes-carrier-holds.ts';
import { registerCarrierBusinessStagingRoutes } from './routes-carrier-business-staging.ts';
import { registerCommercialRoutes } from './routes-commercial.ts';
import { registerExtensionRoutes } from './routes-extension.ts';
import { registerOnboardingSignRoutes } from './routes-onboarding-sign.ts';
import { registerOnboardingSelfReportRoutes } from './routes-onboarding-self-report.ts';
import { registerOnboardingDashboardRoutes } from './routes-onboarding-dashboard.ts';
import { registerTrainingDashboardRoutes } from './routes-training-dashboard.ts';
import { registerAuditEngagementRoutes } from './routes-audit-engagements.ts';
import { registerSubBrokerRoutes } from './routes-sub-brokers.ts';
import { registerCeRoutes } from './routes-ce.ts';
import { registerFirstWeekRoutes } from './routes-firstweek.ts';
import { registerPresenceRoutes } from './routes-presence.ts';
import { registerForecastRoutes } from './routes-forecast.ts';
import { registerDuplicateRoutes } from './routes-duplicates.ts';
import { registerPublicApiRoutes } from './routes-publicapi.ts';
import { registerDashboardRoutes } from './routes-dashboard.ts';
import { registerWorkspaceRoutes } from './routes-workspace.ts';
import { registerNotificationRoutes } from './routes-notifications.ts';
import { registerPrivacyRoutes } from './routes-privacy.ts';
import { registerActivityRoutes } from './routes-activity.ts';
import { registerAuthRoutes, originGuard } from './routes-auth.ts';
import { registerDemoRoutes } from './routes-demo.ts';
import { registerRateLimit } from './rate-limit.ts';
import { registerConsentRoutes, hasAcceptedFirstLogin } from './routes-consent.ts';
import { withRequestTx } from '@pii/db';

export interface AppDeps {
  config: Config;
  appPool: Db;
  authenticate: Authenticator;
  /** Pool for the narrow auth role (sessions, login lookup, invitation acceptance). */
  authPool: Db;
  google?: GoogleClient;
  /** Encryption keys for linked email content. Absent: linking is refused (503). */
  keys?: KeyProvider;
  /** AI text service. Absent: AI features answer 503. */
  ai?: AiClient;
  /** Sends reminder emails. Absent: reminders stay in the app. */
  mailer?: import('./mailer.ts').Mailer;
  /** Write-once archive (S3 with Object Lock). Absent: signed paperwork stays in the database only. */
  vault?: import('./vault.ts').Vault;
  /** Replaces the network for outside services (used by tests). */
  fetchImpl?: typeof fetch;
  /** While set, reminder emails are gathered here and sent as one message per person. */
  digest?: Map<string, { kind: string; data: Record<string, unknown> }[]>;
}

export function buildApp(input: AppDeps): FastifyInstance {
  // Authenticate once per request, however many times handlers and hooks ask.
  const memo = new WeakMap<object, Promise<Identity>>();
  const deps: AppDeps = {
    ...input,
    authenticate: (req) => {
      let p = memo.get(req);
      if (!p) { p = input.authenticate(req); memo.set(req, p); }
      return p;
    },
  };
  const proxyHops: number = Number.parseInt(process.env.TRUST_PROXY_HOPS ?? '1', 10) || 1;
  const app = Fastify({
    // Behind the hosting proxy: take the address the nearest proxy saw, so one visitor is one address and a spoofed header cannot choose it.
    trustProxy: (_addr: string, hop: number) => hop < proxyHops,
    ajv: { customOptions: { allowUnionTypes: true } },
    logger: deps.config.appEnv === 'test' ? false : {
      level: deps.config.logLevel,
      redact: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["x-dev-user-email"]'],
      // Never log query strings: sign-in callbacks and invitation links carry one-time codes.
      serializers: { req: (r: { method: string; url: string; host?: string }) => ({ method: r.method, url: r.url.split('?')[0], host: r.host }) },
    },
  });

  // Some tools (Jotform, Wufoo, plain HTML forms) post form-encoded data to a capture link; nothing else accepts it.
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string', bodyLimit: 40_000 }, (req, body, done) => {
    if (!req.url.startsWith('/v1/hooks/') && !req.url.startsWith('/u/')) return done(new HttpError(415, 'unsupported_media_type', 'Send JSON'), undefined);
    try { done(null, Object.fromEntries(new URLSearchParams(body as string))); } catch (e) { done(e as Error, undefined); }
  });

  app.setErrorHandler((err, req, reply) => {
    const mapped = err instanceof HttpError ? err : mapDbError(err);
    if (mapped) return reply.code(mapped.status).send({ error: { code: mapped.code, message: mapped.message } });
    const e = err as { validation?: unknown; statusCode?: number; message: string };
    if (e.validation) return reply.code(400).send({ error: { code: 'bad_request', message: e.message } });
    if (process.env.PII_DEBUG_DB) console.error(err);
    req.log.error({ err }, 'unhandled error');
    return reply.code(500).send({ error: { code: 'internal', message: 'Something went wrong' } });
  });

  registerRateLimit(app);

  // Which country this server holds data for. Public and harmless: it lets the extension confirm a sign-in picker choice.
  app.get('/v1/region', async () => ({ region: deps.config.region, country: deps.config.region === 'us' ? 'US' : 'CA' }));
  app.get('/healthz', async () => ({ ok: true }));
  app.get('/readyz', async (_req, reply) => {
    try {
      const d = await assertDeployment(deps.appPool, deps.config.region);
      return { ok: true, region: d.region, environment: d.environment, physicalRegionVerified: d.verified };
    } catch (err) {
      return reply.code(503).send({ ok: false, error: (err as Error).message });
    }
  });
  app.get('/v1/ops/telemetry', async () => {
    const start = Date.now();
    const dbCheck = await deps.appPool.query('SELECT 1');
    const queryLatencyMs = Date.now() - start;
    const mem = process.memoryUsage();

    return {
      ok: true,
      region: deps.config.region,
      country: deps.config.region === 'us' ? 'US' : 'CA',
      database: {
        connected: Boolean(dbCheck.rowCount),
        queryLatencyMs,
      },
      process: {
        uptimeSeconds: Math.floor(process.uptime()),
        memoryUsageMb: {
          rss: Math.round(mem.rss / (1024 * 1024)),
          heapTotal: Math.round(mem.heapTotal / (1024 * 1024)),
          heapUsed: Math.round(mem.heapUsed / (1024 * 1024)),
        },
        nodeVersion: process.version,
      },
    };
  });

  app.addHook('preHandler', originGuard(deps));
  // People must accept the first-login notice before using anything else (Law 25 / PIPEDA).
  app.addHook('preHandler', async (req) => {
    const path = req.url.split('?')[0]!;
    if (!path.startsWith('/v1/') || path === '/v1/me' || path === '/v1/embed-token' || path.startsWith('/v1/consent/') || path.startsWith('/v1/hooks/') || path.startsWith('/v1/public/') || path.startsWith('/v1/webhooks/') || path.startsWith('/v1/ops/')) return;
    const id = await deps.authenticate(req);
    const ok = await withRequestTx(deps.appPool, id.ctx, (tx) => hasAcceptedFirstLogin(tx, id.ctx));
    if (!ok) throw new HttpError(403, 'consent_required', 'Please review and accept the privacy notice first');
  });

  registerPageRoutes(app, deps);
  registerAuthRoutes(app, deps);
  registerDemoRoutes(app, deps);
  registerConsentRoutes(app, deps);
  registerOrgRoutes(app, deps);
  registerPeopleRoutes(app, deps);
  registerPipelineRoutes(app, deps);
  registerBoxRoutes(app, deps);
  registerContactRoutes(app, deps);
  registerFamilyRoutes(app, deps);
  registerFamilyInsuranceRoutes(app, deps);
  registerFamilyComplianceRoutes(app, deps);
  registerNoteRoutes(app, deps);
  registerThreadRoutes(app, deps);
  registerLmsRoutes(app, deps);
  registerInsightRoutes(app, deps);
  registerDashboardRoutes(app, deps);
  registerWorkspaceRoutes(app, deps);
  registerPublicApiRoutes(app, deps);
  registerAutomationRoutes(app, deps);
  registerAliasRoutes(app, deps);
  registerDocumentRoutes(app, deps);
  registerGateRoutes(app, deps);
  registerAdviceRoutes(app, deps);
  registerAdviceReviewRoutes(app, deps);
  registerAmlRoutes(app, deps);
  registerSignRoutes(app, deps);
  registerVaultRoutes(app, deps);
  registerEsignRoutes(app, deps);
  registerClientConsentRoutes(app, deps);
  registerRetentionRoutes(app, deps);
  registerIntegrationRoutes(app, deps);
  registerMergeRoutes(app, deps);
  registerAiRoutes(app, deps);
  registerSettingRoutes(app, deps);
  registerNavRoutes(app, deps);
  registerRenewalRoutes(app, deps);
  registerComplianceRoutes(app, deps);
  registerOnboardingRoutes(app, deps);
  registerCarrierContractRoutes(app, deps);
  registerCarrierSubmissionSettingsRoutes(app, deps);
  registerCarrierWorkflowRoutes(app, deps);
  registerCarrierWebhookRoutes(app, deps);
  registerCarrierReviewRoutes(app, deps);
  registerCarrierEligibilityRoutes(app, deps);
  registerCarrierExpiryRoutes(app, deps);
  registerCarrierHistoryRoutes(app, deps);
  registerCarrierAuthorizationEvidenceRoutes(app, deps);
  registerCarrierActivationRoutes(app, deps);
  registerCarrierCertificationRoutes(app, deps);
  registerCarrierPreflightRoutes(app, deps);
  registerCarrierProductRevocationRoutes(app, deps);
  registerCarrierHoldRoutes(app, deps);
  registerCarrierBusinessStagingRoutes(app, deps);
  registerCommercialRoutes(app, deps);
  registerExtensionRoutes(app, deps);
  registerOnboardingSignRoutes(app, deps);
  registerOnboardingSelfReportRoutes(app, deps);
  registerOnboardingDashboardRoutes(app, deps);
  registerTrainingDashboardRoutes(app, deps);
  registerAuditEngagementRoutes(app, deps);
  registerSubBrokerRoutes(app, deps);
  registerCeRoutes(app, deps);
  registerFirstWeekRoutes(app, deps);
  registerPresenceRoutes(app, deps);
  registerForecastRoutes(app, deps);
  registerDuplicateRoutes(app, deps);
  registerNotificationRoutes(app, deps);
  registerPrivacyRoutes(app, deps);
  registerActivityRoutes(app, deps);
  return app;
}
