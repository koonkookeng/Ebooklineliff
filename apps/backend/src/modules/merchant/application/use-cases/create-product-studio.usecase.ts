// SSOT Phase 073 Task 2 — Product studio use-case (tenant-owned upsert)
// Canonical: apps/backend/src/modules/merchant/application/use-cases/create-product-studio.usecase.ts
// - Zod-gated upsert: slug-unique per tenant (update) else create with
//   nested detail rows. tenantId always comes from the guarded header
//   (entity asserts header/body match — BDD-1).
// - Zero new deps.
import { BadRequestException, Injectable } from '@nestjs/common';
import { MerchantProductUpsertSchema, type MerchantProductUpsert } from '@repo/shared';
import { assertTenantOwnership } from '../../domain/entities/merchant-account.entity';
import type { MerchantRepository } from '../../infrastructure/repositories/prisma-merchant.repository';

@Injectable()
export class CreateProductStudioUseCase {
  constructor(private readonly repo: MerchantRepository) {}

  async execute(headerTenantId: string | undefined, body: unknown): Promise<{ id: string; slug: string; updated: boolean }> {
    const raw = (body ?? {}) as Record<string, unknown>;
    const tenantId = assertTenantOwnership(headerTenantId, raw['tenantId'] as string | undefined);
    const parsed = MerchantProductUpsertSchema.safeParse({ ...raw, tenantId });
    if (!parsed.success) throw new BadRequestException('Invalid product payload');
    const input: MerchantProductUpsert = parsed.data;
    if (input.id) {
      const updated = await this.repo.updateProduct(input.id, input);
      return { ...updated, updated: true };
    }
    const existing = await this.repo.findProductBySlug(tenantId, input.slug);
    if (existing) {
      const updated = await this.repo.updateProduct(existing.id, input);
      return { ...updated, updated: true };
    }
    const created = await this.repo.createProduct(input);
    return { ...created, updated: false };
  }
}
