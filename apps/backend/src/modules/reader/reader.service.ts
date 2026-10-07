// SSOT Phase 040 Task 40.2 — ReaderService (entitled chunk delivery + progress sync)
// Canonical: apps/backend/src/modules/reader/reader.service.ts
// (legacy src/backend/modules/reader/reader.service.ts)
// - §5.2 flow: entitlement gate (403) → EbookDetail bounds (404) → Phase 039
//   edge HIT / R2 warm MISS → dynamic forensic watermark → EbookChunkPayload.
// - Upgrades vs the §5.2 sketch (all additive, ADR-040): tenant-isolated edge
//   keys via ChunkWarmerService (no bare reader:chunk:* writes) and the R2
//   read rides the internal vault binding (never a public-URL fetch).
// - syncEbookProgress: single upsert (<50ms Gate 7) + best-effort analytics
//   sink for dwell events (Gate 8 seam; default no-op).
// - tsx-safe (no Nest parameter decorators); zero new deps.
import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  EbookChunkPayloadSchema,
  type EbookChunkPayload,
  type ProgressSyncResult,
} from '@repo/shared';
import { ChunkWarmerService } from './cache/services/chunk-warmer.service';
import { WatermarkGeneratorService } from './services/watermark-generator.service';

interface EntitlementRow {
  userId: string;
  productId: string;
}

export interface ReaderPrisma {
  entitlement: {
    findUnique(args: unknown): Promise<EntitlementRow | null>;
  };
  ebookDetail: {
    findUnique(args: unknown): Promise<{ productId: string; totalPages: number } | null>;
  };
  ebookReadingProgress: {
    upsert(args: unknown): Promise<{ lastPage: number; updatedAt: Date }>;
  };
}

export interface ReadingDwellEvent {
  userId: string;
  productId: string;
  lastPage: number;
  readDurationSec: number;
}

@Injectable()
export class ReaderService {
  // NOTE: Module wires via useFactory (no param decorators — tsx-safe).
  constructor(
    private readonly warmer?: ChunkWarmerService,
    private readonly prisma?: ReaderPrisma,
    private readonly watermarks?: WatermarkGeneratorService,
    private readonly appSecret: string = '',
    private readonly onProgressEvent?: (event: ReadingDwellEvent) => void,
  ) {}

  async getEbookPageChunk(
    userId: string,
    tenantId: string,
    productId: string,
    pageNumber: number,
  ): Promise<EbookChunkPayload> {
    if (!this.warmer || !this.prisma || !this.watermarks) throw new NotFoundException('Reader unavailable');
    const entitlement = await this.prisma.entitlement
      .findUnique({ where: { userId_productId: { userId, productId } } })
      .catch(() => null);
    if (!entitlement) throw new ForbiddenException('ท่านยังไม่มีสิทธิ์เข้าถึง E-Book เล่มนี้');

    const detail = await this.prisma.ebookDetail.findUnique({ where: { productId } }).catch(() => null);
    if (!detail || pageNumber > detail.totalPages) throw new NotFoundException('ไม่พบหน้าหนังสือที่ระบุ');

    const chunk = await this.warmer.getOrWarm({ tenantId, productId, pageNumber });
    if (!chunk) throw new NotFoundException('ไม่พบหน้าหนังสือที่ระบุ');

    const payload: EbookChunkPayload = {
      productId,
      pageNumber,
      totalPages: detail.totalPages,
      vectorSvgContent: chunk.vectorSvgContent,
      forensicWatermark: this.watermarks.forWatermark(userId, this.appSecret || 'dev-secret'),
      hasPrevious: pageNumber > 1,
      hasNext: pageNumber < detail.totalPages,
    };
    // Boundary self-check: never emit an off-contract payload.
    const verified = EbookChunkPayloadSchema.safeParse(payload);
    if (!verified.success) throw new NotFoundException('ไม่พบหน้าหนังสือที่ระบุ');
    return verified.data;
  }

  async syncEbookProgress(
    userId: string,
    productId: string,
    lastPage: number,
    readDurationSec: number,
  ): Promise<ProgressSyncResult> {
    if (!this.prisma) throw new NotFoundException('Reader unavailable');
    const detail = await this.prisma.ebookDetail.findUnique({ where: { productId } }).catch(() => null);
    const totalPages = detail?.totalPages ?? Math.max(1, lastPage);
    const row = await this.prisma.ebookReadingProgress.upsert({
      where: { userId_ebookId: { userId, ebookId: productId } },
      create: { userId, ebookId: productId, lastPage, totalPages },
      update: { lastPage, totalPages },
    });
    try {
      this.onProgressEvent?.({ userId, productId, lastPage, readDurationSec });
    } catch {
      // Analytics must never fail the <50ms sync path.
    }
    return { success: true, lastPage: row.lastPage, updatedAt: row.updatedAt.toISOString() };
  }
}
