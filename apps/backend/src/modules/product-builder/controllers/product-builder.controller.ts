// SSOT Phase 074 §5 — Builder REST (drafts + atomic publish)
// Canonical: apps/backend/src/modules/product-builder/controllers/product-builder.controller.ts
// - POST draft/save (partial autosave, BDD-1), GET draft/load, POST publish
//   (strict gate + atomic txn, BDD-3). JWT + TenantGuard + merchant role.
// - sellerId = authenticated user id (never trust body). Zero new deps.
import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../guards/jwt-auth.guard';
import { TenantGuard } from '../../../common/guards/tenant.guard';
import { assertMerchantRole } from '../../merchant/domain/entities/merchant-account.entity';
import { ProductBuilderService } from '../services/product-builder.service';

function ctx(req: Record<string, unknown>): { sellerId: string; tenantId: string } {
  const user = (req['user'] as { id?: string; role?: string } | undefined) ?? {};
  assertMerchantRole(user.role);
  const headers = (req['headers'] ?? {}) as Record<string, string | undefined>;
  const tenantId = ((req['tenantId'] as string | undefined) ?? headers['x-tenant-id'] ?? '').trim();
  if (!tenantId || !user.id) throw new Error('Missing tenant/user context.');
  return { sellerId: user.id, tenantId };
}

@Controller('api/v1/builder')
@UseGuards(JwtAuthGuard, TenantGuard)
export class ProductBuilderController {
  constructor(private readonly builder: ProductBuilderService) {}

  @Post('draft/save')
  saveDraft(@Req() req: Record<string, unknown>, @Body() body: Record<string, unknown>) {
    const { sellerId } = ctx(req);
    const stepIndex = typeof body['stepIndex'] === 'number' ? body['stepIndex'] : 1;
    return this.builder.saveDraft(sellerId, stepIndex, body);
  }

  @Get('draft/load')
  loadDraft(@Req() req: Record<string, unknown>, @Query('draftId') draftId: string | undefined) {
    const { sellerId } = ctx(req);
    if (!draftId) return null;
    return this.builder.loadDraft(sellerId, draftId);
  }

  @Post('publish')
  publish(@Req() req: Record<string, unknown>, @Body() body: unknown) {
    const { sellerId, tenantId } = ctx(req);
    return this.builder.publishProduct(sellerId, tenantId, body);
  }
}
