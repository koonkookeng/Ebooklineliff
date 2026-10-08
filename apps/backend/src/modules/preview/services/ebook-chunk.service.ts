// SSOT Phase 051 §5.1 — preview chunk delivery (R2 vector SVG + forensic watermark)
// Canonical: apps/backend/src/modules/preview/services/ebook-chunk.service.ts
// (legacy src/backend/modules/preview/services/ebook-chunk.service.ts)
// - Gatekeeper first (403 past page 10), then zero-egress R2 fetch.
// - Watermark binds a 12-hex user hash (never raw PII) + ISO timestamp.
// - Zero new deps (node:crypto only).
import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { EbookPreviewChunkPayload } from '@repo/shared';
import { PreviewGatekeeperService, type PreviewIdentity } from './preview-gatekeeper.service';

export interface PreviewChunkR2Port {
  getObjectText(objectKey: string): Promise<string>;
}

export function hashPreviewIdentity(identity: string): string {
  return createHash('sha256').update(`preview:${identity}`).digest('hex').slice(0, 12);
}

@Injectable()
export class EbookChunkService {
  constructor(
    private readonly gate: PreviewGatekeeperService,
    private readonly r2: PreviewChunkR2Port,
  ) {}

  async getPreviewChunk(
    id: PreviewIdentity,
    productId: string,
    pageNumber: number,
  ): Promise<EbookPreviewChunkPayload> {
    const verdict = await this.gate.validateEbookPageAccess(id, productId, pageNumber);
    const pageKey = String(pageNumber).padStart(4, '0');
    const vectorSvgContent = await this.r2.getObjectText(`ebooks/${productId}/pages/${pageKey}.svg`);
    const identity = id.userId ?? id.lineUserId ?? 'anon';
    const userIdHash = hashPreviewIdentity(identity);
    const timestamp = new Date().toISOString();
    return {
      productId,
      pageNumber,
      totalPreviewPages: verdict.isPreviewMode ? verdict.maxPreviewPages : pageNumber,
      isLastPreviewPage: verdict.isPreviewMode ? verdict.isLastPreviewPage : false,
      vectorSvgContent,
      forensicWatermarkData: {
        watermarkText: `PREVIEW MODE - ${userIdHash}`,
        userIdHash,
        timestamp,
      },
      hasEntitlement: !verdict.isPreviewMode,
    };
  }
}
