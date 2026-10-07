// SSOT Phase 037 Task 5 — Ebook structure service (chapter ordering engine)
// Canonical: apps/backend/src/modules/catalog/services/ebook-structure.service.ts
// (legacy src/backend/modules/catalog/services/ebook-structure.service.ts)
// - createChapter: Zod-gated → server-assigned index → create; P2002 (racing
//   append) surfaces as 409 Conflict for retry (Gate 7).
// - tocByProduct: lightweight chapter list for the LIFF TOC drawer (Gate 5).
// - Zero new deps.
import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { CreateEbookChapterSchema, type CreateEbookChapter } from '@repo/shared';
import { EbookDetailRepository } from '../repositories/ebook-detail.repository';

@Injectable()
export class EbookStructureService {
  constructor(private readonly repo: EbookDetailRepository) {}

  async createChapter(body: unknown) {
    const parsed = CreateEbookChapterSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid chapter input');
    const input: CreateEbookChapter = parsed.data;
    const chapterIndex = await this.repo.nextChapterIndex(input.ebookId);
    try {
      return await this.repo.createChapter({ ...input, chapterIndex });
    } catch (err) {
      if (typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002') {
        throw new ConflictException('Chapter index taken — retry append');
      }
      throw err;
    }
  }

  async tocByProduct(productId: string) {
    if (!productId) throw new BadRequestException('Missing product id');
    return this.repo.listChaptersByProduct(productId);
  }
}
