// SSOT Phase 049 Tasks 3/7 — DrmSessionService (ephemeral grants + violation audit)
// Canonical: apps/backend/src/modules/drm/services/drm-session.service.ts
// (legacy src/backend/modules/drm/services/drm-session.service.ts)
// - initDrmSession: entitlement-gated, 15-min TTL, permutation persisted.
// - getDrmChunk: session-validity + revocation + pixel-scrape (>5 pulls/sec
//   revokes the session per §7.1) + forensic payload build.
// - reportViolation: atomic DB log + Redis telemetry (<500ms, fail-open).
// - Pure orchestration; tsx-importable via useFactory. Zero new deps.
import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../../infra/database/prisma.service';
import { RedisClusterService } from '../../../infra/redis/redis-cluster.service';
import {
  DRM_PIXEL_SCRAPE_LIMIT_PER_SEC,
  DRM_SESSION_TTL_SEC,
  DrmViolationTypeEnum,
  drmPixelRateKey,
  drmSessionExpiry,
  drmSessionKey,
  drmViolationKey,
  type DecryptChunkPayload,
  type DrmSessionHandshake,
  type ForensicPayload,
} from '@repo/shared';
import { DrmShufflingService } from './drm-shuffling.service';

export interface InitDrmSessionInput {
  userId: string;
  productId: string;
  pageNumber: number;
  tenantId?: string;
  imageWidth: number;
  imageHeight: number;
}

export interface ReportViolationInput {
  sessionId: string;
  violationType: string;
  ipAddress: string;
  userAgent: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class DrmSessionService {
  private readonly logger = new Logger(DrmSessionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisClusterService,
    private readonly shuffling: DrmShufflingService,
    private readonly ttlSec: number = DRM_SESSION_TTL_SEC,
  ) {}

  /** SHA256 hex helper (forensic hashes). */
  hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  async initDrmSession(input: InitDrmSessionInput): Promise<DrmSessionHandshake> {
    if (!input.pageNumber || input.pageNumber < 1) throw new BadRequestException('Invalid page number');

    // Entitlement gatekeeper (no grant → no session).
    const grant = await this.prisma.entitlement
      .findUnique({ where: { userId_productId: { userId: input.userId, productId: input.productId } } })
      .catch(() => null);
    if (!grant) throw new ForbiddenException('No reading entitlement for this product');

    const matrix = this.shuffling.generateTileMatrix(input.imageWidth, input.imageHeight, input.userId);
    const expiresAt = new Date(Date.now() + this.ttlSec * 1000);
    const sessionSeed = this.hash(`${input.userId}:${input.productId}:${Date.now()}`);

    const session = await this.prisma.drmSession.create({
      data: {
        userId: input.userId,
        productId: input.productId,
        pageNumber: input.pageNumber,
        sessionSeed,
        permutationVector: matrix.permutationVector,
        tileWidth: matrix.tileWidth,
        tileHeight: matrix.tileHeight,
        gridCols: matrix.gridCols,
        gridRows: matrix.gridRows,
        expiresAt,
      },
    });

    // Edge cache for <200ms chunk lookups (fail-open).
    await this.redis
      .setex(drmSessionKey(session.id), this.ttlSec, JSON.stringify({ userId: input.userId }))
      .catch(() => undefined);

    return {
      sessionId: session.id,
      productId: input.productId,
      pageNumber: input.pageNumber,
      expiresAt: drmSessionExpiry(this.ttlSec),
      tileMatrix: {
        tileWidth: matrix.tileWidth,
        tileHeight: matrix.tileHeight,
        gridCols: matrix.gridCols,
        gridRows: matrix.gridRows,
        permutationVector: matrix.permutationVector,
        seedHash: matrix.seedHash,
      },
    };
  }

  async getDrmChunk(input: {
    productId: string;
    pageNumber: number;
    sessionId: string;
    userId: string;
    tenantId?: string;
    ipAddress: string;
  }): Promise<DecryptChunkPayload> {
    const session = await this.prisma.drmSession.findUnique({ where: { id: input.sessionId } });
    if (!session) throw new ForbiddenException('Unknown DRM session');
    if (session.revokedAt) throw new ForbiddenException('DRM session revoked');
    if (session.expiresAt.getTime() < Date.now()) throw new ForbiddenException('DRM session expired');
    if (session.userId !== input.userId || session.productId !== input.productId) {
      throw new ForbiddenException('DRM session mismatch');
    }

    // §7.1 pixel-scrape guard: >5 pulls/sec → revoke immediately.
    const rateKey = drmPixelRateKey(input.sessionId);
    const pulls = await this.redis.incr(rateKey).catch(() => 0);
    if (pulls === 1) await this.redis.expire(rateKey, 1).catch(() => undefined);
    if (pulls > DRM_PIXEL_SCRAPE_LIMIT_PER_SEC) {
      await this.revokeSession(input.sessionId, 'pixel-scrape limit exceeded');
      throw new ForbiddenException('Pixel scrape detected — session revoked');
    }

    const permutationVector = session.permutationVector as number[];
    const forensicData: ForensicPayload = {
      userIdHash: this.hash(`${input.userId}:${input.tenantId ?? 'default'}`),
      tenantId: input.tenantId ?? 'default',
      ipAddressHash: this.hash(input.ipAddress),
      timestamp: new Date().toISOString(),
    };

    const r2Base = process.env.CLOUDFLARE_R2_PUBLIC_DOMAIN ?? '';
    return {
      pageNumber: input.pageNumber,
      encryptedChunkUrl: `${r2Base}/drm/${input.productId}/page-${input.pageNumber}.svg`,
      drmSession: {
        sessionId: session.id,
        productId: session.productId,
        pageNumber: session.pageNumber,
        expiresAt: session.expiresAt.toISOString(),
        tileMatrix: {
          tileWidth: session.tileWidth,
          tileHeight: session.tileHeight,
          gridCols: session.gridCols,
          gridRows: session.gridRows,
          permutationVector,
          seedHash: this.hash(session.sessionSeed),
        },
      },
      forensicData,
    };
  }

  async reportViolation(input: ReportViolationInput): Promise<boolean> {
    const parsed = DrmViolationTypeEnum.safeParse(input.violationType);
    if (!parsed.success) throw new BadRequestException('Invalid violation type');

    // Atomic DB audit row (fail-closed on unknown session).
    const session = await this.prisma.drmSession.findUnique({ where: { id: input.sessionId } });
    if (!session) throw new BadRequestException('Unknown DRM session');
    await this.prisma.drmViolationLog.create({
      data: {
        sessionId: input.sessionId,
        violationType: parsed.data,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        metadata: (input.metadata ?? {}) as Record<string, string>,
      },
    });

    // Real-time telemetry (fail-open, <500ms budget).
    const key = drmViolationKey(input.sessionId);
    await this.redis.zincrby(key, 1, parsed.data).catch(() => undefined);
    await this.redis.expire(key, 24 * 3600).catch(() => undefined);

    // Hijack attempts revoke immediately.
    if (parsed.data === 'SESSION_HIJACK_ATTEMPT') {
      await this.revokeSession(input.sessionId, 'hijack attempt reported');
    }
    return true;
  }

  private async revokeSession(sessionId: string, reason: string): Promise<void> {
    this.logger.warn(`Revoking DRM session ${sessionId}: ${reason}`);
    await this.prisma.drmSession.update({ where: { id: sessionId }, data: { revokedAt: new Date() } }).catch(() => undefined);
    await this.redis.del(drmSessionKey(sessionId)).catch(() => undefined);
  }
}
