import { withRequestTx, type Tx } from '@pii/db';
import type { RequestContext } from '@pii/domain';
import {
  revalidateOutboxDispatch,
  assertExternalCarrierDispatch,
  CarrierConnectionUnavailable,
  type CarrierConnection,
  type CarrierChannel,
  type CarrierOperation,
} from '@pii/platform';
import type { AppDeps } from './app.ts';

export interface OutboxSweepResult {
  processed: number;
  succeeded: number;
  failed: number;
  deadLetter: number;
}

interface OutboxCandidateRow {
  id: string;
  tenant_id: string;
  contract_id: string;
  carrier_id: string;
  operation: CarrierOperation;
  jurisdiction: string;
  idempotency_key: string;
  evidence_reference: string;
  payload: Record<string, unknown>;
  retry_count: number;
  max_retries: number;
}

function workerTenantCtx(tenantId: string): RequestContext {
  return {
    tenantId,
    userId: '00000000-0000-0000-0000-000000000000',
    nodeIds: [],
    adminNodeIds: [],
    isTenantAdmin: true,
    canWrite: true,
    canUseCrm: true,
    roles: [],
  };
}

/**
 * Database-backed carrier dispatch outbox worker with row leasing, exponential backoff,
 * transactional eligibility revalidation, and dead-letter routing.
 */
export async function sweepCarrierOutbox(
  deps: AppDeps,
  batchSize = 25,
  targetTenantId?: string
): Promise<OutboxSweepResult> {
  const result: OutboxSweepResult = {
    processed: 0,
    succeeded: 0,
    failed: 0,
    deadLetter: 0,
  };

  let tenantIds: string[] = [];
  if (targetTenantId) {
    tenantIds = [targetTenantId];
  } else {
    try {
      const tenants = (await deps.authPool.query<{ id: string }>('SELECT id FROM tenants')).rows;
      tenantIds = tenants.map(t => t.id);
    } catch {
      return result;
    }
  }

  for (const tId of tenantIds) {
    let leased: OutboxCandidateRow[] = [];
    try {
      // 1. Lease candidates with row-level locking (SKIP LOCKED) to allow safe parallel worker execution
      leased = await withRequestTx(deps.appPool, workerTenantCtx(tId), async (tx: Tx) => {
        return (
          await tx.query<OutboxCandidateRow>(
            `WITH candidates AS (
               SELECT id
                 FROM carrier_dispatch_outbox
                WHERE status = 'queued'
                   OR (status = 'failed' AND retry_count < max_retries AND updated_at <= now() - (interval '10 seconds' * power(2, LEAST(retry_count, 6))))
                ORDER BY created_at ASC
                LIMIT $1
                FOR UPDATE SKIP LOCKED
             )
             UPDATE carrier_dispatch_outbox o
                SET status = 'processing',
                    updated_at = now()
               FROM candidates c
              WHERE o.id = c.id
             RETURNING o.id, o.tenant_id, o.contract_id, o.carrier_id, o.operation, o.jurisdiction,
                       o.idempotency_key, o.evidence_reference, o.payload, o.retry_count, o.max_retries`,
            [batchSize]
          )
        ).rows;
      });
    } catch {
      continue;
    }

    if (!leased.length) continue;
    result.processed += leased.length;

    // 2. Process each leased outbox item in its own tenant-isolated transaction
    for (const item of leased) {
      try {
        await withRequestTx(deps.appPool, workerTenantCtx(item.tenant_id), async (tx: Tx) => {
          // Check contract state and live compliance context
          const c = (
            await tx.query<{
              state: string;
              holding_clearance: boolean;
              licence_valid: boolean;
              eo_valid: boolean;
            }>(
              `SELECT cc.state,
                      NOT EXISTS(SELECT 1 FROM carrier_compliance_holds h WHERE h.contract_id = cc.id AND h.tenant_id = cc.tenant_id AND h.released_at IS NULL) AS holding_clearance,
                      EXISTS(SELECT 1 FROM compliance_items i WHERE i.node_id = cc.node_id AND i.tenant_id = cc.tenant_id AND i.kind = 'licence' AND i.expires_on >= CURRENT_DATE AND upper(i.jurisdiction) = upper(cc.jurisdiction)) AS licence_valid,
                      EXISTS(SELECT 1 FROM compliance_items i WHERE i.node_id = cc.node_id AND i.tenant_id = cc.tenant_id AND i.kind = 'eo' AND i.expires_on >= CURRENT_DATE) AS eo_valid
                 FROM carrier_contract_cases cc
                WHERE cc.id = $1 AND cc.tenant_id = $2`,
              [item.contract_id, item.tenant_id]
            )
          ).rows[0];

          if (!c) {
            // Contract deleted or missing: route straight to dead_letter
            await tx.query(
              `UPDATE carrier_dispatch_outbox
                  SET status = 'dead_letter',
                      last_error = 'Associated carrier contract record not found',
                      updated_at = now()
                WHERE id = $1`,
              [item.id]
            );
            result.deadLetter++;
            return;
          }

          // Query carrier connection settings
          const settings = (
            await tx.query<{
              mode: string;
              sending_enabled: boolean;
              recipient_verified_at: string | null;
            }>(
              `SELECT mode, sending_enabled, recipient_verified_at
                 FROM carrier_submission_settings
                WHERE tenant_id = $1 AND carrier_id = $2`,
              [item.tenant_id, item.carrier_id]
            )
          ).rows[0];

          const cert = (
            await tx.query<{
              tier: string;
              gate1_legal_agreement: boolean;
              gate2_sandbox_certified: boolean;
              gate3_kms_secrets_provisioned: boolean;
              gate4_outbox_safety_verified: boolean;
              gate5_feature_flag_active: boolean;
              certified_by: string | null;
              certified_at: string | null;
              tier_expires_on: string | null;
              not_expired: boolean;
            }>(
              `SELECT
                 tier,
                 gate1_legal_agreement,
                 gate2_sandbox_certified,
                 gate3_kms_secrets_provisioned,
                 gate4_outbox_safety_verified,
                 gate5_feature_flag_active,
                 certified_by,
                 certified_at,
                 tier_expires_on,
                 tier_expires_on > CURRENT_DATE AS not_expired
               FROM carrier_certifications
               WHERE tenant_id = $1 AND carrier_id = $2`,
              [item.tenant_id, item.carrier_id]
            )
          ).rows[0];

          const productionCertified = Boolean(
            cert &&
            cert.tier === 'live' &&
            cert.not_expired &&
            cert.gate1_legal_agreement &&
            cert.gate2_sandbox_certified &&
            cert.gate3_kms_secrets_provisioned &&
            cert.gate4_outbox_safety_verified &&
            cert.gate5_feature_flag_active &&
            cert.certified_by &&
            cert.certified_at
          );

          const connection: CarrierConnection = {
            tenantId: item.tenant_id,
            carrierId: item.carrier_id,
            channel: (settings?.mode === 'semi_automated' ? 'secure_email' : 'none') as CarrierChannel,
            enabled: Boolean(settings?.sending_enabled),
            verified: Boolean(settings?.recipient_verified_at),
            approvedOperations: [item.operation],
            approvedJurisdictions: [item.jurisdiction],
            destinationVerifiedAt: settings?.recipient_verified_at ?? null,
          };

          try {
            // 1. Transactional pre-dispatch eligibility revalidation
            revalidateOutboxDispatch(
              {
                tenantId: item.tenant_id,
                carrierId: item.carrier_id,
                contractId: item.contract_id,
                operation: item.operation,
                jurisdiction: item.jurisdiction,
                idempotencyKey: item.idempotency_key,
                evidenceReference: item.evidence_reference,
              },
              {
                contractState: c.state,
                holdingClearance: c.holding_clearance,
                licenceValid: c.licence_valid,
                eoValid: c.eo_valid,
                connection,
              }
            );

            // 2. Fail-closed external dispatch environment policy check
            const appEnv = deps.config.appEnv as 'dev' | 'test' | 'staging' | 'prod';
            assertExternalCarrierDispatch({
              environment: appEnv,
              allowExternalDispatch: false, // Remains strictly false until verified insurer technical interface is approved
              carrierAuthorized: connection.enabled,
              destinationVerified: connection.verified,
              sandboxApproved: Boolean(cert?.gate2_sandbox_certified),
              productionApproved: productionCertified,
              changeTicket: null,
            });

            // 3. (Future) If live transport adapter succeeds:
            await tx.query(
              `UPDATE carrier_dispatch_outbox
                  SET status = 'dispatched',
                      dispatched_at = now(),
                      last_error = NULL,
                      updated_at = now()
                WHERE id = $1`,
              [item.id]
            );
            result.succeeded++;
          } catch (err: any) {
            const nextRetry = item.retry_count + 1;
            const isDeadLetter = nextRetry >= item.max_retries;
            const newStatus = isDeadLetter ? 'dead_letter' : 'failed';
            const errMsg =
              err instanceof CarrierConnectionUnavailable || err.message
                ? err.message
                : 'Carrier dispatch failed closed';

            await tx.query(
              `UPDATE carrier_dispatch_outbox
                  SET status = $1,
                      retry_count = $2,
                      last_error = $3,
                      updated_at = now()
                WHERE id = $4`,
              [newStatus, nextRetry, errMsg, item.id]
            );

            if (isDeadLetter) result.deadLetter++;
            else result.failed++;
          }
        });
      } catch {
        // Individual item transaction failure does not abort remainder of batch
      }
    }
  }

  return result;
}
