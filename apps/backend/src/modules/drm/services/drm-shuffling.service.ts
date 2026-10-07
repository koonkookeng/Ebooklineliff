// SSOT Phase 049 §5.1 — DrmShufflingService (ephemeral tile permutation)
// Canonical: apps/backend/src/modules/drm/services/drm-shuffling.service.ts
// (legacy src/backend/modules/drm/services/drm-shuffling.service.ts)
// - Fisher-Yates shuffle seeded by SHA256(seed:userId:i) — deterministic per
//   session, invertible via the stored permutation vector.
// - Pure + tsx-safe. Zero new deps (node:crypto only).
import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import {
  DRM_TILE_SIZE,
  isValidPermutation,
  tileGrid,
  type PixelTileMatrix,
} from '@repo/shared';

export interface TileMatrix {
  tileWidth: number;
  tileHeight: number;
  gridCols: number;
  gridRows: number;
  permutationVector: number[];
  seedHash: string;
}

@Injectable()
export class DrmShufflingService {
  private readonly TILE_SIZE = DRM_TILE_SIZE; // 64x64 pixel tiles for optimal mobile memory

  generateTileMatrix(imageWidth: number, imageHeight: number, userId: string): TileMatrix {
    const { gridCols, gridRows, totalTiles } = tileGrid(imageWidth, imageHeight, this.TILE_SIZE);

    const seed = randomBytes(32).toString('hex');
    const permutationVector = Array.from({ length: totalTiles }, (_, i) => i);

    // Fisher-Yates Shuffle using Cryptographic Seed Derivative
    for (let i = totalTiles - 1; i > 0; i--) {
      const hash = createHash('sha256').update(`${seed}-${userId}-${i}`).digest();
      const randomIndex = hash.readUInt32BE(0) % (i + 1);
      [permutationVector[i], permutationVector[randomIndex]] = [
        permutationVector[randomIndex],
        permutationVector[i],
      ];
    }

    return {
      tileWidth: this.TILE_SIZE,
      tileHeight: this.TILE_SIZE,
      gridCols,
      gridRows,
      permutationVector,
      seedHash: createHash('sha256').update(seed).digest('hex'),
    };
  }

  /** Guard a stored matrix before serving it (Gate 4). */
  assertValidMatrix(matrix: PixelTileMatrix): void {
    if (matrix.gridCols * matrix.gridRows !== matrix.permutationVector.length) {
      throw new Error('Tile matrix dimensions mismatch permutation length');
    }
    if (!isValidPermutation(matrix.permutationVector)) {
      throw new Error('Permutation vector is not a bijection');
    }
  }
}
