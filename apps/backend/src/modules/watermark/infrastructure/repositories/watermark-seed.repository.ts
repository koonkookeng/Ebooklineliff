// SSOT Phase 042 §5.1 — WatermarkSeedRepository (seed + violation persistence)
// Canonical: apps/backend/src/modules/watermark/infrastructure/repositories/watermark-seed.repository.ts
// (legacy src/backend/modules/watermark/infrastructure/repositories/watermark-seed.repository.ts)
// - Structural Prisma port (tsx-safe): issueSeedLog / findSeedRow /
//   logViolation. Audit writes are fire-and-forget from the caller so seed
//   issuance never blocks the <10ms reader path (Gate 7).
// - Zero new deps.
import { WATERMARK_SEED_TTL_SEC } from '@repo/shared';

export interface WatermarkSeedTables {
  watermarkSeedLog: {
    create(args: unknown): Promise<unknown>;
    findUnique(args: unknown): Promise<{
      seedId: string;
      userId: string;
      lineUserId: string | null;
      productId: string;
      clientIp: string;
      hmacSignature: string;
      createdAt: Date;
      expiresAt: Date;
    } | null>;
  };
  securityViolationLog: {
    create(args: unknown): Promise<unknown>;
  };
}

export interface SeedIssueInput {
  seedId: string;
  userId: string;
  lineUserId?: string;
  productId: string;
  clientIp: string;
  userAgent: string;
  hmacSignature: string;
  issuedAtMs?: number;
}

export interface ViolationInput {
  userId: string;
  lineUserId?: string;
  violationType: string;
  metadata: Record<string, unknown>;
  ipAddress: string;
}

export class WatermarkSeedRepository {
  // NOTE: Module wires via useFactory (no param decorators — tsx-safe).
  constructor(private readonly tables?: WatermarkSeedTables) {}

  async issueSeedLog(input: SeedIssueInput): Promise<void> {
    if (!this.tables) return;
    const issuedAt = input.issuedAtMs ?? Date.now();
    await this.tables.watermarkSeedLog
      .create({
        data: {
          seedId: input.seedId,
          userId: input.userId,
          lineUserId: input.lineUserId,
          productId: input.productId,
          clientIp: input.clientIp,
          userAgent: input.userAgent.slice(0, 500),
          hmacSignature: input.hmacSignature,
          expiresAt: new Date(issuedAt + WATERMARK_SEED_TTL_SEC * 1000),
        },
      })
      .catch(() => undefined);
  }

  /** Seed provenance row (userIdHash is derived by the caller via crypto). */
  async findSeedRow(seedId: string): Promise<{
    seedId: string;
    userId: string;
    lineUserId: string | null;
    timestamp: string;
    expired: boolean;
  } | null> {
    const row = await this.tables?.watermarkSeedLog.findUnique({ where: { seedId } }).catch(() => null);
    if (!row) return null;
    return {
      seedId: row.seedId,
      userId: row.userId,
      lineUserId: row.lineUserId,
      timestamp: row.createdAt.toISOString(),
      expired: row.expiresAt.getTime() <= Date.now(),
    };
  }

  async logViolation(input: ViolationInput): Promise<void> {
    if (!this.tables) return;
    await this.tables.securityViolationLog
      .create({
        data: {
          userId: input.userId,
          lineUserId: input.lineUserId,
          violationType: input.violationType,
          metadataJson: input.metadata,
          ipAddress: input.ipAddress,
        },
      })
      .catch(() => undefined);
  }
}
