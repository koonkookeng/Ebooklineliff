// SSOT Phase 008 §5.1 — update-stock command (guarded deltas; reservations never stranded)
// Canonical: apps/backend/src/modules/catalog/application/commands/update-stock.command.ts
import { Injectable, BadRequestException } from '@nestjs/common';
import { UpdateStockSchema } from '@repo/shared';
import { PrismaCatalogRepository } from '../../infrastructure/repositories/prisma-catalog.repository';
import type { DomainProduct } from '../../infrastructure/mappers/product.mapper';

@Injectable()
export class UpdateStockUseCase {
  constructor(private readonly catalog: PrismaCatalogRepository) {}

  execute(raw: { productId: string; deltaQty: number }): Promise<DomainProduct> {
    const parsed = UpdateStockSchema.safeParse(raw);
    if (!parsed.success) throw new BadRequestException('Invalid stock payload');
    return this.catalog.updateStock(parsed.data.productId, parsed.data.deltaQty);
  }

  reserve(productId: string, qty: number): Promise<number> {
    if (!productId) throw new BadRequestException('Missing product id');
    return this.catalog.reserveStock(productId, qty);
  }
}
