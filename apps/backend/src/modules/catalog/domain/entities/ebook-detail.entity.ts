// SSOT Phase 008 §5.1 — E-book detail entity (preview/pages coherence for the chunk pipeline)
// Canonical: apps/backend/src/modules/catalog/domain/entities/ebook-detail.entity.ts
import { BadRequestException } from '@nestjs/common';

/** Preview windows must fit inside the book; empty books cannot publish. */
export function assertEbookCoherent(totalPages: number, previewPages: number): void {
  if (totalPages <= 0) throw new BadRequestException('E-book must have at least 1 page');
  if (previewPages < 0 || previewPages > totalPages) {
    throw new BadRequestException('previewPages must fit inside totalPages');
  }
}
