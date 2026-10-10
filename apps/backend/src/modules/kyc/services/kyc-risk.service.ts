// SSOT Phase 111 §7.1 — KYC fraud risk assessment (checksum + duplicate + tamper)
// Canonical: apps/backend/src/modules/kyc/services/kyc-risk.service.ts
// - Tiers follow 111 §7.1 percent scale (≥95 LOW / 80–94 MEDIUM / <80 HIGH,
//   duplicate ID → CRITICAL); the 085 0.90/0.75 submission gate is untouched.
// - Duplicate detection uses the SHA-256 blind index (AES-GCM random IVs
//   cannot be compared). Assessed best-effort post-submit — never blocks the
//   085 submission path. Zero new deps (node:crypto).
import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../../infra/database/prisma.service';
import { KycEncryptionService } from './kyc-encryption.service';
import { thaiIdChecksum } from '@repo/shared';
import { kycRiskTier111, type KYCRiskLevel } from '@repo/shared';

export function blindIndexIdCard(idCardNumber: string): string {
  return createHash('sha256').update(`kyc-id:${idCardNumber}`, 'utf8').digest('hex');
}

@Injectable()
export class KycRiskService {
  private readonly logger = new Logger(KycRiskService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: KycEncryptionService,
  ) {}

  /** Assess + persist risk for a submitted KYC row (best-effort, idempotent). */
  async assessAndStore(kycId: string): Promise<{ riskLevel: KYCRiskLevel; duplicateId: boolean } | null> {
    try {
      const row = await this.prisma.creatorKYC.findUnique({
        where: { id: kycId },
        include: { payoutAccount: true },
      });
      if (!row) return null;

      let idNumber = '';
      try {
        idNumber = this.encryption.decrypt(row.idCardNumberEnc);
      } catch {
        idNumber = '';
      }
      const checksumValid = idNumber ? thaiIdChecksum(idNumber) : false;
      const blindIdx = idNumber ? blindIndexIdCard(idNumber) : null;
      const duplicate = blindIdx
        ? (await this.prisma.creatorKYC.count({ where: { idCardBlindIdx: blindIdx, id: { not: kycId } } })) > 0
        : false;

      const confidencePct = row.ocrConfidence !== null && row.ocrConfidence !== undefined
        ? Math.round(Number(row.ocrConfidence) * 100)
        : 0;
      const nameScore = row.payoutAccount?.nameMatchScore !== null && row.payoutAccount?.nameMatchScore !== undefined
        ? Math.round(Number(row.payoutAccount.nameMatchScore) * 100)
        : confidencePct;
      // §10.2: confidence <50% → HIGH + manual review, never blocks the pipe.
      const tampered = confidencePct < 50;
      const riskLevel = kycRiskTier111(nameScore, { duplicateId: duplicate, tampered, checksumValid });

      await this.prisma.creatorKYC.update({
        where: { id: kycId },
        data: {
          riskLevel: riskLevel as 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL',
          isPossibleTamper: tampered,
          ...(blindIdx ? { idCardBlindIdx: blindIdx } : {}),
        },
      });
      await this.prisma.kYCAuditLog
        .create({
          data: {
            kycId,
            actorUserId: 'SYSTEM_RISK_ENGINE',
            action: 'RISK_ASSESSED',
            ipAddress: 'SYSTEM_INTERNAL',
            userAgent: 'risk-engine/111',
            metadata: { riskLevel, duplicateId: duplicate, checksumValid, confidencePct, tampered },
          },
        })
        .catch(() => undefined);
      return { riskLevel, duplicateId: duplicate };
    } catch (err) {
      this.logger.warn(`Risk assessment failed for ${kycId}: ${(err as Error).message}`);
      return null;
    }
  }
}
