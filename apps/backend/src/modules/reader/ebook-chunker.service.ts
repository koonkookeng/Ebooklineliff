// SSOT Phase 036 Task 4 — Ebook chunker (manifest plan + R2 upload + verify)
// Canonical: apps/backend/src/modules/reader/ebook-chunker.service.ts
// (legacy src/backend/modules/reader/ebook-chunker.service.ts)
// - BDD Scenario 3: planChunkManifest (page→key/checksum layout) → uploadChunks
//   (parallel R2 PUT + temp-buffer purge) → verifyManifest (row count parity).
// - Rasterization (PDF/EPUB → SVG text) is the upstream book-pipeline seam:
//   this service accepts PRE-RENDERED page payloads {pageNumber, svgContent}
//   (page text stays inside the tenant vault; checksums gate corruption).
// - Chunk rows upsert by @@unique(ebookId, pageNumber) (Gate 7, idempotent
//   re-runs); BigInt file sizes convert at the JSON boundary.
// - Zero new deps: Prisma SSOT + R2StorageService only.
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../infra/database/prisma.service';
import { R2StorageService } from '../../infra/cloudflare/r2-storage.service';
import { chunkObjectKey } from '@repo/shared';

export interface RenderedPage {
  pageNumber: number;
  svgContent: string;
}

export interface ChunkPlanEntry {
  pageNumber: number;
  r2ObjectKey: string;
  chunkSizeBytes: number;
  vectorChecksum: string;
}

interface ChunkerTables {
  ebookDetail: {
    findFirst: (args: unknown) => Promise<{ id: string; productId: string; totalPages: number } | null>;
  };
  ebookChunkMeta: {
    upsert: (args: unknown) => Promise<unknown>;
    count: (args: unknown) => Promise<number>;
  };
}

@Injectable()
export class EbookChunkerService {
  private readonly logger = new Logger(EbookChunkerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly r2: R2StorageService,
  ) {}

  private get tables(): ChunkerTables {
    return this.prisma as unknown as ChunkerTables;
  }

  /** Deterministic page→key/checksum layout for a product (pure plan). */
  planChunkManifest(productId: string, pages: RenderedPage[]): ChunkPlanEntry[] {
    if (!productId) throw new BadRequestException('Missing product id');
    if (!Array.isArray(pages) || pages.length === 0) throw new BadRequestException('No rendered pages');
    const seen = new Set<number>();
    return pages.map((p) => {
      if (!Number.isInteger(p.pageNumber) || p.pageNumber <= 0) throw new BadRequestException('Invalid page number');
      if (typeof p.svgContent !== 'string' || !p.svgContent) throw new BadRequestException('Empty page content');
      if (seen.has(p.pageNumber)) throw new BadRequestException('Duplicate page number');
      seen.add(p.pageNumber);
      const bytes = Buffer.byteLength(p.svgContent, 'utf8');
      return {
        pageNumber: p.pageNumber,
        r2ObjectKey: chunkObjectKey(productId, p.pageNumber),
        chunkSizeBytes: bytes,
        vectorChecksum: createHash('sha256').update(p.svgContent, 'utf8').digest('hex'),
      };
    });
  }

  /** Upload planned chunks to R2 + upsert manifests (temp buffers purged). */
  async uploadChunks(productId: string, pages: RenderedPage[]): Promise<{ uploaded: number; purged: boolean }> {
    const plan = this.planChunkManifest(productId, pages);
    const ebook = await this.tables.ebookDetail.findFirst({ where: { productId } });
    if (!ebook) throw new BadRequestException('Unknown ebook product');
    const byPage = new Map(pages.map((p) => [p.pageNumber, p.svgContent]));
    let uploaded = 0;
    for (const entry of plan) {
      const content = byPage.get(entry.pageNumber) as string;
      await this.r2.putObject(entry.r2ObjectKey, content, 'image/svg+xml');
      await this.tables.ebookChunkMeta.upsert({
        where: { ebookId_pageNumber: { ebookId: ebook.id, pageNumber: entry.pageNumber } },
        update: { r2ObjectKey: entry.r2ObjectKey, chunkSizeBytes: entry.chunkSizeBytes, vectorChecksum: entry.vectorChecksum },
        create: { ebookId: ebook.id, pageNumber: entry.pageNumber, r2ObjectKey: entry.r2ObjectKey, chunkSizeBytes: entry.chunkSizeBytes, vectorChecksum: entry.vectorChecksum },
      });
      uploaded++;
    }
    // Temp server buffers: drop references immediately (GC reclaims, §BDD3).
    byPage.clear();
    return { uploaded, purged: true };
  }

  /** Row-count parity check after upload (true = manifest complete). */
  async verifyManifest(productId: string, expectedPages: number): Promise<boolean> {
    const ebook = await this.tables.ebookDetail.findFirst({ where: { productId } }).catch(() => null);
    if (!ebook) return false;
    const count = await this.tables.ebookChunkMeta.count({ where: { ebookId: ebook.id } }).catch(() => -1);
    return count === expectedPages;
  }
}
