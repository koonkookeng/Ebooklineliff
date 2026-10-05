/**
 * Phase 000 — Reader chunk service: entitlement gate + R2 -> Redis edge [N-1,N,N+1].
 */
import { Injectable } from '@nestjs/common';
import { EbookChunkPayloadSchema } from '@shared/schemas/sdid-contract';
import { createHash } from 'node:crypto';

@Injectable()
export class ReaderChunkService {
  constructor(
    private readonly edge: {
      getChunk(p: string, n: number): Promise<string | null>;
      setChunk(p: string, n: number, v: string): Promise<void>;
    },
    private readonly r2: { objectUrl(p: string): string; chunkPath(p: string, n: number): string },
    private readonly entitlements: { hasAccess(userId: string, productId: string): Promise<boolean> },
  ) {}

  async getPageChunk(productId: string, page: number, userId: string, totalPages: number) {
    const allowed = await this.entitlements.hasAccess(userId, productId);
    if (!allowed) throw new Error('FORBIDDEN_NO_ENTITLEMENT');
    let svg = await this.edge.getChunk(productId, page);
    if (!svg) {
      const url = this.r2.objectUrl(this.r2.chunkPath(productId, page));
      const res = await fetch(url);
      if (!res.ok) throw new Error(`CHUNK_FETCH_${res.status}`);
      svg = await res.text();
      await this.edge.setChunk(productId, page, svg);
    }
    const userIdHash = createHash('sha256').update(userId).digest('hex').slice(0, 12);
    const payload = {
      pageNumber: page,
      vectorSvgContent: svg,
      forensicWatermarkData: {
        watermarkText: `${userIdHash} @ ${new Date().toISOString()}`,
        userIdHash,
        timestamp: new Date().toISOString(),
      },
      hasPrevious: page > 1,
      hasNext: page < totalPages,
    };
    return EbookChunkPayloadSchema.parse(payload);
  }
}
