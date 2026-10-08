// SSOT Phase 061 §5.2 — CanvasShufflingService (dual-DRM chunk + trap audit)
// Canonical: apps/backend/src/modules/reader/drm/canvas-shuffling.service.ts
// (legacy src/backend/modules/reader/drm/canvas-shuffling.service.ts)
// - getDrmChunk: entitlement gate (read-only port) → ephemal DrmSecurityKey
//   row (15min) → HMAC permutation matrix → 60s R2 presigned scrambled blob
//   → forensic watermark → payload (<16ms deshuffle budget client-side).
// - reportViolation: single-row insert (≤500ms) + best-effort stream event.
// - tsx-safe (no param decorators; structural ports). Zero new deps.
import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import {
  DRM_BLOB_URL_TTL_SEC,
  DRM_SESSION_TTL_MIN,
  drmSessionCacheKey,
  type DrmShuffleAlgorithm,
  type EncryptedDrmChunkPayload,
} from '@repo/shared';
import { PixelMatrixGeneratorService } from './pixel-matrix.generator';
import type { DrmViolationReport } from './dto/drm-chunk-request.dto';

export interface DrmShuffleTables {
  drmSecurityKey: {
    create(args: unknown): Promise<{ sessionNonce: string }>;
    deleteMany(args: unknown): Promise<unknown>;
  };
  drmViolationLog: {
    create(args: unknown): Promise<{ id: string }>;
  };
  entitlement: {
    findUnique(args: unknown): Promise<{ userId: string } | null>;
  };
  user: {
    findUnique(args: unknown): Promise<{ displayName: string | null } | null>;
  };
}

export interface DrmShuffleCache {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: Array<string | number>): Promise<unknown>;
}

export interface DrmShuffleVault {
  presignedGetUrl(objectKey: string, expiresInSeconds: number): string;
}

@Injectable()
export class CanvasShufflingService {
  constructor(
    private readonly matrices?: PixelMatrixGeneratorService,
    private readonly tables?: DrmShuffleTables,
    private readonly cache?: DrmShuffleCache,
    private readonly vault?: DrmShuffleVault,
    private readonly tokenSecret: string = process.env.VIDEO_TOKEN_SECRET || process.env.APP_SECRET || 'AHONG_EMERALD_SECRET_KEY_999',
    private readonly onViolation?: (event: { userId: string; productId: string; violationType: string }) => void,
  ) {}

  scrambledR2KeyFor(productId: string, pageNumber: number): string {
    return `drm/${productId}/pages/page_${pageNumber}.scrambled.webp`;
  }

  private async entitled(userId: string, productId: string): Promise<boolean> {
    const row = await this.tables?.entitlement
      .findUnique({ where: { userId_productId: { userId, productId } } })
      .catch(() => null);
    return row !== null;
  }

  async getDrmChunk(
    userId: string,
    productId: string,
    pageNumber: number,
    gridX: number,
    gridY: number,
    algorithm: DrmShuffleAlgorithm,
    userIp: string,
  ): Promise<EncryptedDrmChunkPayload> {
    if (!this.tables || !this.matrices || !this.vault) throw new NotFoundException('DRM shuffling unavailable');
    if (!(await this.entitled(userId, productId))) {
      throw new ForbiddenException('ท่านยังไม่มีสิทธิ์เข้าถึงหนังสือเล่มนี้');
    }
    const sessionNonce = randomUUID();
    const matrix = this.matrices.generatePermutationMatrix(userId, productId, pageNumber, sessionNonce, gridX, gridY);
    await this.tables.drmSecurityKey
      .create({
        data: {
          userId,
          productId,
          sessionNonce,
          hmacSecret: matrix.seed,
          algorithm,
          expiresAt: new Date(Date.now() + DRM_SESSION_TTL_MIN * 60 * 1000),
        },
      })
      .catch(() => null);
    await this.tables.drmSecurityKey.deleteMany({ where: { expiresAt: { lt: new Date() } } }).catch(() => undefined);
    const scrambledBlobUrl = this.vault.presignedGetUrl(this.scrambledR2KeyFor(productId, pageNumber), DRM_BLOB_URL_TTL_SEC);
    await this.cache?.set(drmSessionCacheKey(sessionNonce), JSON.stringify(matrix), 'EX', DRM_SESSION_TTL_MIN * 60).catch(() => undefined);
    const userIdHash = createHash('sha256').update(`${userId}:${this.tokenSecret}`).digest('hex').slice(0, 12);
    const user = await this.tables.user.findUnique({ where: { id: userId } }).catch(() => null);
    const timestamp = new Date().toISOString();
    return {
      pageNumber,
      scrambledBlobUrl,
      shufflingMatrix: matrix,
      forensicWatermark: {
        watermarkText: `${user?.displayName ?? 'Learner'} (${userIdHash})`,
        userIdHash,
        userIp,
        timestamp,
      },
      algorithm,
    };
  }

  async reportViolation(userId: string, report: DrmViolationReport, ipAddress: string): Promise<{ logged: boolean }> {
    if (!this.tables) throw new NotFoundException('DRM audit unavailable');
    await this.tables.drmViolationLog.create({
      data: {
        sessionId: null,
        violationType: report.violationType,
        userId,
        productId: report.productId,
        pageNumber: report.pageNumber,
        ipAddress,
        userAgent: report.userAgent,
        metadata: { sessionNonce: report.sessionNonce, ...(report.metadata ?? {}) },
      },
    });
    try {
      this.onViolation?.({ userId, productId: report.productId, violationType: report.violationType });
    } catch {
      // stream fan-out is best-effort within the 500ms budget
    }
    return { logged: true };
  }
}
