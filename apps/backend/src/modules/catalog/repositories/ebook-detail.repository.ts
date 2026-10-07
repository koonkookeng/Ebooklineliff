// SSOT Phase 037 Task 5 — Ebook detail repository (TOC reads + chapter writes)
// Canonical: apps/backend/src/modules/catalog/repositories/ebook-detail.repository.ts
// (legacy src/backend/modules/catalog/repositories/ebook-detail.repository.ts)
// - Lightweight TOC: chapters ordered by chapterIndex, chunk payloads excluded
//   (Gate 5 — TOC stays KB-sized for the LIFF drawer).
// - createChapter assigns chapterIndex = max + 1 inside the write path;
//   @@unique(ebookId, chapterIndex) makes concurrent appends 409-safe via the
//   service's P2002 mapping (Gate 7).
// - Structural prisma typing (Phase 027–036 precedent). Zero new deps.
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infra/database/prisma.service';

export interface ChapterRow {
  id: string;
  ebookId: string;
  chapterIndex: number;
  title: string;
  chunkCount: number;
  chunkR2Prefix: string;
}

interface EbookTables {
  ebookDetail: {
    findFirst: (args: unknown) => Promise<{ id: string } | null>;
  };
  ebookChapter: {
    findMany: (args: unknown) => Promise<ChapterRow[]>;
    create: (args: unknown) => Promise<ChapterRow>;
    aggregate: (args: unknown) => Promise<{ _max: { chapterIndex: number | null } }>;
  };
}

@Injectable()
export class EbookDetailRepository {
  constructor(private readonly prisma: PrismaService) {}

  private get tables(): EbookTables {
    return this.prisma as unknown as EbookTables;
  }

  /** TOC chapters for a product, ordered by chapterIndex (BDD Scenario 1). */
  async listChaptersByProduct(productId: string): Promise<ChapterRow[]> {
    const ebook = await this.tables.ebookDetail.findFirst({ where: { productId } }).catch(() => null);
    if (!ebook) return [];
    return this.tables.ebookChapter
      .findMany({ where: { ebookId: ebook.id }, orderBy: { chapterIndex: 'asc' } })
      .catch(() => []);
  }

  /** Next chapter index for an ebook (append-only ordering). */
  async nextChapterIndex(ebookId: string): Promise<number> {
    const agg = await this.tables.ebookChapter
      .aggregate({ where: { ebookId }, _max: { chapterIndex: true } })
      .catch(() => ({ _max: { chapterIndex: null } }));
    return (agg._max.chapterIndex ?? 0) + 1;
  }

  createChapter(data: { ebookId: string; chapterIndex: number; title: string; chunkCount: number; chunkR2Prefix: string }): Promise<ChapterRow> {
    return this.tables.ebookChapter.create({ data });
  }
}
