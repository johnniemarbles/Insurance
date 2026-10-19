import type { FastifyInstance } from 'fastify';
import { withRequestTx, type Tx } from '@pii/db';
import { audit } from './audit.ts';
import { forbidden, invalid, notFound } from './errors.ts';
import type { AppDeps } from './app.ts';

const VALID_GATE_KEYS = [
  'gate1_legal_agreement',
  'gate2_sandbox_certified',
  'gate3_kms_secrets_provisioned',
  'gate4_outbox_safety_verified',
  'gate5_feature_flag_active',
] as const;

type GateKey = typeof VALID_GATE_KEYS[number];

const VALID_TIERS = ['manual_portal', 'sandbox_testing', 'certified', 'live'] as const;
type Tier = typeof VALID_TIERS[number];

interface CarrierCertRow {
  carrier_id: string;
  display_name: string;
  country: string;
  tier: Tier | null;
  adapter_status: string | null;
  gate1_legal_agreement: boolean | null;
  gate1_legal_evidence: string | null;
  gate2_sandbox_certified: boolean | null;
  gate2_sandbox_evidence: string | null;
  gate3_kms_secrets_provisioned: boolean | null;
  gate3_kms_evidence: string | null;
  gate4_outbox_safety_verified: boolean | null;
  gate4_outbox_evidence: string | null;
  gate5_feature_flag_active: boolean | null;
  gate5_approved_by: string | null;
  gate5_approved_at: string | null;
  tier_expires_on: string | null;
  certified_by: string | null;
  certified_at: string | null;
  notes: string | null;
  revision: number | null;
  updated_at: string | null;
}

const GATE_EVIDENCE_MAP: Record<GateKey, string | null> = {
  gate1_legal_agreement: 'gate1_legal_evidence',
  gate2_sandbox_certified: 'gate2_sandbox_evidence',
  gate3_kms_secrets_provisioned: 'gate3_kms_evidence',
  gate4_outbox_safety_verified: 'gate4_outbox_evidence',
  gate5_feature_flag_active: null,
};

export function registerCarrierCertificationRoutes(app: FastifyInstance, deps: AppDeps): void {
  // 1. Query Authoritative Certification Registry
  app.get('/v1/compliance/carrier-certifications', async (req) => {
    const { ctx } = await deps.authenticate(req);
    return withRequestTx(deps.appPool, ctx, async (tx: Tx) => {
      const rows = (
        await tx.query<CarrierCertRow>(
          `SELECT cd.id AS carrier_id, cd.display_name, cd.country,
                  cc.tier, cc.adapter_status,
                  cc.gate1_legal_agreement, cc.gate1_legal_evidence,
                  cc.gate2_sandbox_certified, cc.gate2_sandbox_evidence,
                  cc.gate3_kms_secrets_provisioned, cc.gate3_kms_evidence,
                  cc.gate4_outbox_safety_verified, cc.gate4_outbox_evidence,
                  cc.gate5_feature_flag_active, cc.gate5_approved_by, cc.gate5_approved_at,
                  cc.tier_expires_on, cc.certified_by, cc.certified_at,
                  cc.notes, cc.revision, cc.updated_at
             FROM carrier_directory cd
        LEFT JOIN carrier_certifications cc
               ON cc.carrier_id = cd.id AND cc.tenant_id = app_tenant_id()
         ORDER BY cd.display_name`
        )
      ).rows;

      const certifications = rows.map((r) => {
        const isAuthoritative = r.tier !== null;
        const adapterStatus =
          r.adapter_status ??
          (['ia-financial-group', 'sun-life'].includes(r.carrier_id) ? 'implemented' : 'staged');

        return {
          carrierId: r.carrier_id,
          displayName: r.display_name,
          country: r.country,
          isAuthoritative,
          currentTier: r.tier ?? 'manual_portal',
          adapterStatus,
          dispatchLocked: r.tier !== 'live',
          webhookQuarantineActive: true,
          gates: {
            gate1LegalAgreement: Boolean(r.gate1_legal_agreement),
            gate1LegalEvidence: r.gate1_legal_evidence,
            gate2SandboxCertified: Boolean(r.gate2_sandbox_certified),
            gate2SandboxEvidence: r.gate2_sandbox_evidence,
            gate3KmsSecretsProvisioned: Boolean(r.gate3_kms_secrets_provisioned),
            gate3KmsEvidence: r.gate3_kms_evidence,
            gate4OutboxSafetyVerified: Boolean(r.gate4_outbox_safety_verified),
            gate4OutboxEvidence: r.gate4_outbox_evidence,
            gate5FeatureFlagActive: Boolean(r.gate5_feature_flag_active),
            gate5ApprovedBy: r.gate5_approved_by,
            gate5ApprovedAt: r.gate5_approved_at,
          },
          tierExpiresOn: r.tier_expires_on,
          certifiedBy: r.certified_by,
          certifiedAt: r.certified_at,
          notes: r.notes,
          revision: r.revision ?? 1,
          updatedAt: r.updated_at,
        };
      });

      return { certifications };
    });
  });

  // 2. Record Gate Verification & Evidence
  app.post('/v1/compliance/carrier-certifications/:carrierId/gate', async (req) => {
    const { ctx } = await deps.authenticate(req);
    const isOfficer =
      ctx.isTenantAdmin ||
      ctx.roles.some((r) => r.role === 'compliance' || r.role === 'admin');
    if (!isOfficer) throw forbidden('Compliance authorization required to record carrier certification gates');

    const carrierId = (req.params as { carrierId: string }).carrierId;
    if (!req.body || typeof req.body !== 'object') throw invalid('JSON object body required');

    const { gateKey, evidence, notes } = req.body as {
      gateKey?: string;
      evidence?: string;
      notes?: string;
    };

    if (!gateKey || !VALID_GATE_KEYS.includes(gateKey as GateKey)) {
      throw invalid(`Invalid gate key. Must be one of: ${VALID_GATE_KEYS.join(', ')}`);
    }

    if (!evidence || typeof evidence !== 'string' || !evidence.trim()) {
      throw invalid('Evidence reference is mandatory when recording gate verification');
    }

    return withRequestTx(deps.appPool, ctx, async (tx: Tx) => {
      // Verify carrier exists
      const carrierExists = (
        await tx.query('SELECT 1 FROM carrier_directory WHERE id = $1', [carrierId])
      ).rowCount;
      if (!carrierExists) throw notFound('Carrier not found in directory');

      const isGate5 = gateKey === 'gate5_feature_flag_active';
      const evidenceCol = GATE_EVIDENCE_MAP[gateKey as GateKey];

      const query = isGate5
        ? `INSERT INTO carrier_certifications (
             tenant_id, carrier_id, adapter_status, gate5_feature_flag_active,
             gate5_approved_by, gate5_approved_at, notes, updated_at
           ) VALUES (
             $1, $2,
             CASE WHEN $2 IN ('ia-financial-group', 'sun-life') THEN 'implemented' ELSE 'staged' END,
             true, $3, now(), $4, now()
           )
           ON CONFLICT (tenant_id, carrier_id) DO UPDATE SET
             gate5_feature_flag_active = true,
             gate5_approved_by = EXCLUDED.gate5_approved_by,
             gate5_approved_at = now(),
             notes = COALESCE(EXCLUDED.notes, carrier_certifications.notes),
             revision = carrier_certifications.revision + 1,
             updated_at = now()
           RETURNING *`
        : `INSERT INTO carrier_certifications (
             tenant_id, carrier_id, adapter_status, ${gateKey}, ${evidenceCol},
             notes, updated_at
           ) VALUES (
             $1, $2,
             CASE WHEN $2 IN ('ia-financial-group', 'sun-life') THEN 'implemented' ELSE 'staged' END,
             true, $3, $4, now()
           )
           ON CONFLICT (tenant_id, carrier_id) DO UPDATE SET
             ${gateKey} = true,
             ${evidenceCol} = EXCLUDED.${evidenceCol},
             notes = COALESCE(EXCLUDED.notes, carrier_certifications.notes),
             revision = carrier_certifications.revision + 1,
             updated_at = now()
           RETURNING *`;

      const params = isGate5
        ? [ctx.tenantId, carrierId, ctx.userId, notes ?? evidence.trim()]
        : [ctx.tenantId, carrierId, evidence.trim(), notes ?? null];

      const updated = (await tx.query(query, params)).rows[0];

      await audit(tx, ctx, 'compliance.carrier_certification_gate_updated', 'carrier_certification', null, {
        carrierId,
        gateKey,
        evidence: evidence.trim(),
      });

      return { ok: true, certification: updated };
    });
  });

  // 3. Promote / Adjust Certification Tier
  app.post('/v1/compliance/carrier-certifications/:carrierId/tier', async (req) => {
    const { ctx } = await deps.authenticate(req);
    const isOfficer =
      ctx.isTenantAdmin ||
      ctx.roles.some((r) => r.role === 'compliance' || r.role === 'admin');
    if (!isOfficer) throw forbidden('Compliance authorization required to adjust carrier certification tier');

    const carrierId = (req.params as { carrierId: string }).carrierId;
    if (!req.body || typeof req.body !== 'object') throw invalid('JSON object body required');

    const { tier, tierExpiresOn, notes } = req.body as {
      tier?: string;
      tierExpiresOn?: string;
      notes?: string;
    };

    if (!tier || !VALID_TIERS.includes(tier as Tier)) {
      throw invalid(`Invalid certification tier. Must be one of: ${VALID_TIERS.join(', ')}`);
    }

    // Preserve the existing unconditional refusal.
    if (tier === 'live') {
      throw invalid('Live electronic dispatch is disabled fail-closed. Carriers can only be certified after manual review.');
    }

    if (tier === 'certified') {
      if (
        !tierExpiresOn ||
        !/^\d{4}-\d{2}-\d{2}$/.test(tierExpiresOn)
      ) {
        throw invalid(
          'A finite certification expiry date is required'
        );
      }

      const expiry = new Date(`${tierExpiresOn}T00:00:00Z`);

      if (
        !Number.isFinite(expiry.getTime()) ||
        expiry.toISOString().slice(0, 10) !== tierExpiresOn ||
        tierExpiresOn <= new Date().toISOString().slice(0, 10)
      ) {
        throw invalid(
          'Certification expiry must be a valid future date'
        );
      }
    }

    return withRequestTx(deps.appPool, ctx, async (tx: Tx) => {
      // Check existing row
      const existing = (
        await tx.query<{
          gate1_legal_agreement: boolean;
          gate2_sandbox_certified: boolean;
        }>(
          `SELECT gate1_legal_agreement, gate2_sandbox_certified
             FROM carrier_certifications
            WHERE tenant_id = app_tenant_id() AND carrier_id = $1`,
          [carrierId]
        )
      ).rows[0];

      if (tier === 'certified') {
        if (!existing?.gate1_legal_agreement || !existing?.gate2_sandbox_certified) {
          throw invalid('Certification requires Gate 1 (Legal Agreement) and Gate 2 (Sandbox Certified) on record');
        }
      }

      let updated: any;
      if (existing) {
        const query = `
          UPDATE carrier_certifications
             SET tier = $2,
                 certified_by = CASE WHEN $2 = 'certified' THEN $3::uuid ELSE carrier_certifications.certified_by END,
                 certified_at = CASE WHEN $2 = 'certified' THEN now() ELSE carrier_certifications.certified_at END,
                 tier_expires_on = $4,
                 notes = COALESCE($5, carrier_certifications.notes),
                 revision = carrier_certifications.revision + 1,
                 updated_at = now()
           WHERE tenant_id = app_tenant_id() AND carrier_id = $1
          RETURNING *`;

        const params = [
          carrierId,
          tier,
          tier === 'certified' ? ctx.userId : null,
          tierExpiresOn ?? null,
          notes ?? null,
        ];
        updated = (await tx.query(query, params)).rows[0];
      } else {
        const query = `
          INSERT INTO carrier_certifications (
            tenant_id, carrier_id, tier, adapter_status,
            tier_expires_on, notes, updated_at
          ) VALUES (
            $1, $2, $3,
            CASE WHEN $2 IN ('ia-financial-group', 'sun-life') THEN 'implemented' ELSE 'staged' END,
            $4, $5, now()
          )
          RETURNING *`;

        const params = [
          ctx.tenantId,
          carrierId,
          tier,
          tierExpiresOn ?? null,
          notes ?? null,
        ];
        updated = (await tx.query(query, params)).rows[0];
      }

      await audit(tx, ctx, 'compliance.carrier_certification_tier_changed', 'carrier_certification', null, {
        carrierId,
        fromTier: existing ? (existing as any).tier : 'manual_portal',
        toTier: tier,
      });

      return { ok: true, certification: updated };
    });
  });

  // 4. Query Carrier Certification Audit History
  app.get('/v1/compliance/carrier-certifications/:carrierId/audit', async (req) => {
    const { ctx } = await deps.authenticate(req);
    const carrierId = (req.params as { carrierId: string }).carrierId;

    return withRequestTx(deps.appPool, ctx, async (tx: Tx) => {
      const rows = (
        await tx.query<{
          id: string;
          tenant_id: string;
          carrier_id: string;
          revision: number;
          operation: string;
          actor_id: string | null;
          recorded_at: string;
          previous_record: Record<string, unknown> | null;
          current_record: Record<string, unknown> | null;
        }>(
          `SELECT id, tenant_id, carrier_id, revision, operation, actor_id, recorded_at, previous_record, current_record
             FROM carrier_certification_audit
            WHERE carrier_id = $1
            ORDER BY recorded_at DESC, revision DESC`,
          [carrierId]
        )
      ).rows;

      return {
        carrierId,
        history: rows.map((r) => ({
          id: r.id,
          tenantId: r.tenant_id,
          carrierId: r.carrier_id,
          revision: r.revision,
          operation: r.operation,
          actorId: r.actor_id,
          recordedAt: r.recorded_at,
          previousRecord: r.previous_record,
          currentRecord: r.current_record,
        })),
      };
    });
  });

  // 5. Formal Insurer Production Appointment Sign-Off Protocol
  app.post('/v1/compliance/carrier-certifications/:carrierId/production-signoff', async (req) => {
    const { ctx } = await deps.authenticate(req);
    const isOfficer =
      ctx.isTenantAdmin ||
      ctx.roles.some((r) => r.role === 'compliance' || r.role === 'admin');
    if (!isOfficer) throw forbidden('Compliance authorization required for insurer production sign-off');

    const carrierId = (req.params as { carrierId: string }).carrierId;
    if (!req.body || typeof req.body !== 'object') throw invalid('JSON object body required');

    const b = req.body as Record<string, unknown>;
    const appointmentReference = typeof b.appointmentReference === 'string' ? b.appointmentReference.trim() : '';
    const insurerSignoffContact = typeof b.insurerSignoffContact === 'string' ? b.insurerSignoffContact.trim() : '';
    const dpaAgreementHash = typeof b.dpaAgreementHash === 'string' ? b.dpaAgreementHash.trim().toLowerCase() : '';
    const tierExpiresOn = typeof b.tierExpiresOn === 'string' ? b.tierExpiresOn.trim() : '';
    const jurisdictions = Array.isArray(b.jurisdictions) && b.jurisdictions.length > 0 ? b.jurisdictions : ['QC', 'ON', 'BC'];

    if (!appointmentReference || !insurerSignoffContact) {
      throw invalid('appointmentReference and insurerSignoffContact are mandatory for production sign-off');
    }
    if (!/^[a-f0-9]{64}$/.test(dpaAgreementHash)) {
      throw invalid('dpaAgreementHash must be a valid 64-character SHA-256 hex string');
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(tierExpiresOn)) {
      throw invalid('tierExpiresOn must be a valid future date (YYYY-MM-DD)');
    }
    const expiry = new Date(`${tierExpiresOn}T00:00:00Z`);
    if (
      !Number.isFinite(expiry.getTime()) ||
      expiry.toISOString().slice(0, 10) !== tierExpiresOn ||
      tierExpiresOn <= new Date().toISOString().slice(0, 10)
    ) {
      throw invalid('tierExpiresOn must be a valid future date');
    }

    return withRequestTx(deps.appPool, ctx, async (tx: Tx) => {
      try {
      // 1. Verify carrier exists
      const carrierExists = (
        await tx.query('SELECT 1 FROM carrier_directory WHERE id = $1', [carrierId])
      ).rowCount;
      if (!carrierExists) throw notFound('Carrier not found in directory');

      // 2. Fetch current certification record and verify all 5 gates are satisfied
      const certRow = (
        await tx.query<{
          gate1_legal_agreement: boolean;
          gate2_sandbox_certified: boolean;
          gate3_kms_secrets_provisioned: boolean;
          gate4_outbox_safety_verified: boolean;
          gate5_feature_flag_active: boolean;
          gate5_approved_by: string | null;
        }>(
          `SELECT gate1_legal_agreement, gate2_sandbox_certified,
                  gate3_kms_secrets_provisioned, gate4_outbox_safety_verified,
                  gate5_feature_flag_active, gate5_approved_by
             FROM carrier_certifications
            WHERE carrier_id = $1 AND tenant_id = app_tenant_id()`,
          [carrierId]
        )
      ).rows[0];

      if (
        !certRow ||
        !certRow.gate1_legal_agreement ||
        !certRow.gate2_sandbox_certified ||
        !certRow.gate3_kms_secrets_provisioned ||
        !certRow.gate4_outbox_safety_verified ||
        !certRow.gate5_feature_flag_active ||
        !certRow.gate5_approved_by
      ) {
        throw invalid('All 5 certification gates must be completed with verified evidence before production sign-off');
      }

      // 3. Record sign-off in carrier_production_signoffs
      const signoffRes = await tx.query<{
        id: string;
        appointment_reference: string;
        insurer_signoff_contact: string;
        signed_off_at: string;
        effective_from: string;
        effective_to: string;
      }>(
        `INSERT INTO carrier_production_signoffs (
           tenant_id, carrier_id, appointment_reference, insurer_signoff_contact,
           signed_off_by, effective_from, effective_to, dpa_agreement_hash,
           jurisdictions, status
         ) VALUES (
           app_tenant_id(), $1, $2, $3, $4, CURRENT_DATE, $5, $6, $7, 'active'
         )
         RETURNING id, appointment_reference, insurer_signoff_contact, signed_off_at, effective_from, effective_to`,
        [
          carrierId,
          appointmentReference,
          insurerSignoffContact,
          ctx.userId,
          tierExpiresOn,
          dpaAgreementHash,
          jurisdictions,
        ]
      );
      const signoff = signoffRes.rows[0];
      if (!signoff) {
        throw invalid('Failed to record carrier production signoff');
      }

      // 4. Update carrier_certifications to tier 'live'
      const updatedCert = (
        await tx.query(
          `UPDATE carrier_certifications
              SET tier = 'live',
                  certified_by = $2,
                  certified_at = now(),
                  tier_expires_on = $3,
                  notes = COALESCE(notes || E'\n', '') || 'Production sign-off reference: ' || $4,
                  revision = revision + 1,
                  updated_at = now()
            WHERE carrier_id = $1 AND tenant_id = app_tenant_id()
            RETURNING *`,
          [carrierId, ctx.userId, tierExpiresOn, appointmentReference]
        )
      ).rows[0];

      await audit(tx, ctx, 'compliance.carrier_production_signed_off', 'carrier_certification', signoff.id, {
        carrierId,
        appointmentReference,
        insurerSignoffContact,
        tier: 'live',
        tierExpiresOn,
        dpaAgreementHash,
      });

        return {
          ok: true,
          tier: 'live',
          dispatchLocked: false,
          signoff,
          certification: updatedCert,
        };
      } catch (err) {
        console.error('PROD SIGNOFF DETAILED ERROR:', err);
        throw err;
      }
    });
  });
}
