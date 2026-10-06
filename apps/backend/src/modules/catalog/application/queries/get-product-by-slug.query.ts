// SSOT Phase 008 §5.1/§6.1 — get-product-by-slug query (edge-cached PDP payload)
// Canonical: apps/backend/src/modules/catalog/application/queries/get-product-by-slug.query.ts
import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaCatalogRepository } from '../../infrastructure/repositories/prisma-catalog.repository';

@Injectable()
export class GetProductBySlugUseCase {
  constructor(private readonly catalog: PrismaCatalogRepository) {}

  execute(slug: string) {
    if (!slug || slug.length < 2) throw new BadRequestException('Invalid slug');
    return this.catalog.getBySlug(slug);
  }
}
