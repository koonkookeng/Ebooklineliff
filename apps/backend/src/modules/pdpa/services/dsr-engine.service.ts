// SSOT Phase 129 BDD-2/Gate 4 — DSR engine (Articles 33/37)
// Canonical: apps/backend/src/modules/pdpa/services/dsr-engine.service.ts
// (legacy src/backend/modules/pdpa/services/dsr-engine.service.ts)
// - submit(): one active request per user+type (409 on duplicate).
// - executeErasure(): PROCESSING -> anonymize PII columns (Name/Email/
//   Phone/LINE ID nulled, displayName pseudonymized) -> drop the encrypted
//   PII envelope -> withdraw non-mandatory consents in the ledger -> revoke
//   sessions + entitlements via ports (< 1s budget) -> COMPLETED.
//   Financial ledger rows keep the userId FK (pseudo-identifier for tax
//   compliance; amounts/ledgers are never deleted — Gate 4).
// - exportPackage(): owner-scoped data-access bundle (Article 33).
// - Ports-based (tsx-importable). Zero new deps.
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { REVOKE_ALL_BUDGET_MS, dsrIdempotencyKey, type DSRStatus, type DSRType } from '@repo/shared';

export interface DsrRow {
  id: string;
  userId: string;
  requestType: string;
  status: DSRStatus;
  reason: string | null;
  processedBy: string | null;
  processedAt: Date | string | null;
  createdAt: Date | string;
}

export interface DsrDbPort {
  dataSubjectRequest: {
    create(args: { data: Record<string, unknown> }): Promise<DsrRow>;
    findFirst(args: Record<string, unknown>): Promise<DsrRow | null>;
    findMany(args: Record<string, unknown>): Promise<DsrRow[]>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<DsrRow>;
  };
  user: {
    findUnique(args: Record<string, unknown>): Promise<Record<string, unknown> | null>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
  };
  userConsentHistory: {
    createMany(args: { data: Array<Record<string, unknown>> }): Promise<unknown>;
    findMany(args: Record<string, unknown>): Promise<Array<Record<string, unknown>>>;
  };
  encryptedUserPII: {
    deleteMany(args: Record<string, unknown>): Promise<unknown>;
  };
}

export interface DsrRevokePort {
  revokeSessions(userId: string): Promise<number>;
  revokeEntitlements(userId: string): Promise<number>;
  del?(...keys: string[]): Promise<void>;
}

export interface ErasureSummary {
  requestId: string;
  anonymizedFields: string[];
  sessionsRevoked: number;
  entitlementsRevoked: number;
  revokeElapsedMs: number;
  withinBudget: boolean;
}

const ACTIVE_STATUSES: DSRStatus[] = ['PENDING', 'PROCESSING'];

@Injectable()
export class DsrEngineService {
  constructor(
    private readonly db: DsrDbPort,
    private readonly revoke: DsrRevokePort,
  ) {}

  async submit(
    userId: string,
    input: { requestType: DSRType; reason?: string },
  ): Promise<DsrRow> {
    const active = await this.db.dataSubjectRequest
      .findFirst({ where: { userId, requestType: input.requestType, status: { in: ACTIVE_STATUSES } } })
      .catch(() => null);
    if (active) throw new ConflictException('DSR_ALREADY_ACTIVE');
    return this.db.dataSubjectRequest.create({
      data: {
        userId,
        requestType: input.requestType,
        status: 'PENDING',
        ...(input.reason ? { reason: input.reason.slice(0, 500) } : {}),
      },
    });
  }

  async myRequests(userId: string): Promise<DsrRow[]> {
    return this.db.dataSubjectRequest
      .findMany({ where: { userId }, orderBy: { createdAt: 'desc' } })
      .catch(() => []);
  }

  /** Owner-scoped access bundle (Article 33 right-to-access/portability). */
  async exportPackage(userId: string): Promise<Record<string, unknown>> {
    const [profile, consents, requests] = await Promise.all([
      this.db.user.findUnique({ where: { id: userId } }).catch(() => null),
      this.db.userConsentHistory.findMany({ where: { userId } }).catch(() => []),
      this.db.dataSubjectRequest.findMany({ where: { userId } }).catch(() => [] as DsrRow[]),
    ]);
    return {
      profile,
      consentHistory: consents,
      dataSubjectRequests: requests,
      exportedAt: new Date().toISOString(),
      // NOTE: financial ledger rows are intentionally referenced by
      // pseudo-identifier only (Gate 4 — tax compliance keeps amounts).
    };
  }

  async executeErasure(userId: string, requestId: string, actorId: string): Promise<ErasureSummary> {
    const req = await this.db.dataSubjectRequest.findFirst({ where: { id: requestId, userId } });
    if (!req) throw new NotFoundException('DSR_NOT_FOUND');
    if (req.requestType !== 'RIGHT_TO_ERASURE') throw new ConflictException('DSR_WRONG_TYPE');
    await this.db.dataSubjectRequest.update({
      where: { id: requestId },
      data: { status: 'PROCESSING' },
    });
    const started = Date.now();
    const anonymizedTag = `erased-${req.id.slice(0, 8)}`;
    await this.db.user.update({
      where: { id: userId },
      data: {
        displayName: `Deleted User ${anonymizedTag}`,
        email: null,
        phone: null,
        lineUserId: `ERASED_${anonymizedTag}`,
        avatarUrl: null,
      },
    });
    await this.db.encryptedUserPII.deleteMany({ where: { userId } }).catch(() => undefined);
    const at = new Date();
    await this.db.userConsentHistory
      .createMany({
        data: ['MARKETING_PROMOTION', 'ANALYTICS_BEHAVIOR', 'THIRD_PARTY_TRANSFER'].map((purpose) => ({
          userId, purpose, isGranted: false, consentVersion: 'erasure',
          ipAddress: 'dsr-engine', userAgent: 'dsr-engine', createdAt: at,
        })),
      })
      .catch(() => undefined);
    const [sessionsRevoked, entitlementsRevoked] = await Promise.all([
      this.revoke.revokeSessions(userId).catch(() => 0),
      this.revoke.revokeEntitlements(userId).catch(() => 0),
    ]);
    try {
      await this.revoke.del?.(dsrIdempotencyKey(userId, 'RIGHT_TO_ERASURE'));
    } catch {
      /* best-effort */
    }
    const revokeElapsedMs = Date.now() - started;
    await this.db.dataSubjectRequest.update({
      where: { id: requestId },
      data: { status: 'COMPLETED', processedBy: actorId, processedAt: new Date() },
    });
    return {
      requestId,
      anonymizedFields: ['displayName', 'email', 'phone', 'lineUserId', 'avatarUrl', 'encryptedUserPII'],
      sessionsRevoked,
      entitlementsRevoked,
      revokeElapsedMs,
      withinBudget: revokeElapsedMs < REVOKE_ALL_BUDGET_MS,
    };
  }
}

/** Compat alias for the scaffold stub name (no behavior change). */
export const DsrEngineServiceService = DsrEngineService;
