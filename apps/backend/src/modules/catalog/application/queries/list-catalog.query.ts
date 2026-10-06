// SSOT Phase 008 §5.1/§6.1 — list-catalog query (tenant-isolated, stripped, edge-cached)
// Canonical: apps/backend/src/modules/catalog/application/queries/list-catalog.query.ts
import { Injectable } from '@nestjs/common';
import type { ListCatalogQuery } from '@repo/shared';
import { PrismaCatalogRepository } from '../../infrastructure/repositories/prisma-catalog.repository';

@Injectable()
export class ListCatalogUseCase {
  constructor(private readonly catalog: PrismaCatalogRepository) {}

  execute(raw: ListCatalogQuery) {
    return this.catalog.list(raw);
  }
}
