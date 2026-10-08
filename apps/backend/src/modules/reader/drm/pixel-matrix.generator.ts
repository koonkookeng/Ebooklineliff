// SSOT Phase 061 §5.2 — PixelMatrixGeneratorService (HMAC permutation seeds)
// Canonical: apps/backend/src/modules/reader/drm/pixel-matrix.generator.ts
// (legacy src/backend/modules/reader/drm/pixel-matrix.generator.ts)
// - generatePermutationMatrix: HMAC-SHA256(userId:productId:page:nonce) →
//   64-hex seed → LCG Fisher-Yates bijection over gridX×gridY (4–32 clamp,
//   default 8×8), 15-min validity. Byte-parity with the shared
//   permutationFromSeed helper (frontend deshuffler).
// - Pure + tsx-safe (no param decorators). Zero new deps.
import { Injectable } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import {
  DRM_GRID_DEFAULT,
  DRM_GRID_MAX,
  DRM_GRID_MIN,
  DRM_SESSION_TTL_MIN,
  isBijection,
  permutationFromSeed,
  type ShufflingMatrixSeed,
} from '@repo/shared';

function clampGrid(n: number): number {
  if (!Number.isInteger(n)) return DRM_GRID_DEFAULT;
  return Math.max(DRM_GRID_MIN, Math.min(DRM_GRID_MAX, n));
}

@Injectable()
export class PixelMatrixGeneratorService {
  constructor(
    private readonly hmacSecret: string = process.env.DRM_HMAC_SECRET || 'ahong-emerald-super-secret-key-999',
  ) {}

  seedFor(userId: string, productId: string, pageNumber: number, sessionNonce: string): string {
    return createHmac('sha256', this.hmacSecret)
      .update(`${userId}:${productId}:${pageNumber}:${sessionNonce}`)
      .digest('hex');
  }

  public generatePermutationMatrix(
    userId: string,
    productId: string,
    pageNumber: number,
    sessionNonce: string,
    gridX: number = DRM_GRID_DEFAULT,
    gridY: number = DRM_GRID_DEFAULT,
  ): ShufflingMatrixSeed {
    const gx = clampGrid(gridX);
    const gy = clampGrid(gridY);
    const seed = this.seedFor(userId, productId, pageNumber, sessionNonce);
    const permutationArray = permutationFromSeed(seed, gx * gy);
    if (!isBijection(permutationArray)) throw new Error('DRM permutation is not bijective');
    return {
      seed,
      gridX: gx,
      gridY: gy,
      permutationArray,
      expiresAt: new Date(Date.now() + DRM_SESSION_TTL_MIN * 60 * 1000).toISOString(),
      sessionNonce,
    };
  }
}
