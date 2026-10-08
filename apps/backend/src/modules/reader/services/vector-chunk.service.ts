// SSOT Phase 060 §5.2 — VectorChunkService (multi-resolution retina chunks)
// Canonical: apps/backend/src/modules/reader/services/vector-chunk.service.ts
// (legacy src/backend/modules/reader/services/vector-chunk.service.ts)
// - getRetinaChunk: DPR cap (3/2/1) → Redis edge variant key (3600s) → R2
//   master SVG fallback → 404; HMAC-grade userIdHash (12-hex, Phase 040
//   precedent — not the §5.2 base64 sketch) + watermark text + baseline
//   memory footprint + hasNext from EbookDetail.totalPages.
// - tsx-safe (no param decorators; structural ports). Zero new deps.
import { Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  SCALER_BASE_HEIGHT_PX,
  SCALER_BASE_WIDTH_PX,
  canvasMemoryMb,
  dprVariantFor,
  retinaCacheKey,
  targetDprFor,
  type EbookMultiResChunkPayload,
} from '@repo/shared';

export interface VectorChunkTables {
  ebookDetail: {
    findUnique(args: unknown): Promise<{ totalPages: number } | null>;
  };
  user: {
    findUnique(args: unknown): Promise<{ displayName: string | null } | null>;
  };
}

export interface VectorChunkCache {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: Array<string | number>): Promise<unknown>;
}

export interface VectorChunkVault {
  getFileAsString(objectKey: string): Promise<string | null>;
}

@Injectable()
export class VectorChunkService {
  constructor(
    private readonly tables?: VectorChunkTables,
    private readonly cache?: VectorChunkCache,
    private readonly vault?: VectorChunkVault,
    private readonly tokenSecret: string = process.env.VIDEO_TOKEN_SECRET || process.env.APP_SECRET || 'AHONG_EMERALD_SECRET_KEY_999',
  ) {}

  r2KeyFor(productId: string, pageNumber: number): string {
    return `ebooks/${productId}/pages/page_${pageNumber}.svg`;
  }

  async getRetinaChunk(
    productId: string,
    pageNumber: number,
    deviceDpr: number,
    userId: string,
    userDisplayName?: string,
  ): Promise<EbookMultiResChunkPayload> {
    const targetDpr = targetDprFor(deviceDpr);
    const key = retinaCacheKey(productId, pageNumber, targetDpr);
    let vectorSvg = await this.cache?.get(key).catch(() => null);
    if (!vectorSvg) {
      vectorSvg = await this.vault?.getFileAsString(this.r2KeyFor(productId, pageNumber)).catch(() => null);
      if (!vectorSvg) throw new NotFoundException(`Page chunk ${pageNumber} not found.`);
      await this.cache?.set(key, vectorSvg, 'EX', 3600).catch(() => undefined);
    }
    const timestamp = new Date().toISOString();
    const userIdHash = createHash('sha256').update(`${userId}:${this.tokenSecret}`).digest('hex').slice(0, 12);
    const displayName =
      userDisplayName ?? (await this.tables?.user.findUnique({ where: { id: userId } }).catch(() => null))?.displayName ?? 'Learner';
    const detail = await this.tables?.ebookDetail.findUnique({ where: { productId } }).catch(() => null);
    return {
      pageNumber,
      vectorSvgContent: vectorSvg,
      dprVariant: dprVariantFor(targetDpr),
      forensicWatermarkData: {
        watermarkText: `${displayName} (${userIdHash})`,
        userIdHash,
        timestamp,
      },
      memoryFootprintMb: canvasMemoryMb(SCALER_BASE_WIDTH_PX, SCALER_BASE_HEIGHT_PX, targetDpr),
      hasPrevious: pageNumber > 1,
      hasNext: detail ? pageNumber < detail.totalPages : true,
    };
  }
}
