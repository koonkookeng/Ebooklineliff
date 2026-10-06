// SSOT Phase 008 §5.1 — create-product command (Zod in, atomic out; bundle validated in domain)
// Canonical: apps/backend/src/modules/catalog/application/commands/create-product.command.ts
import { Injectable } from '@nestjs/common';
import type { CreateProduct } from '@repo/shared';
import { PrismaCatalogRepository } from '../../infrastructure/repositories/prisma-catalog.repository';
import type { DomainProduct } from '../../infrastructure/mappers/product.mapper';

@Injectable()
export class CreateProductUseCase {
  constructor(private readonly catalog: PrismaCatalogRepository) {}

  execute(raw: CreateProduct): Promise<DomainProduct> {
    return this.catalog.create(raw);
  }
}
