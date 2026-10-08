// SSOT Phase 074 §8.1 — Builder presign REST (15-min R2 PUT URLs)
// Canonical: apps/backend/src/modules/product-builder/controllers/upload-presign.controller.ts
// - POST presign-upload — JWT + TenantGuard + merchant role; delegates to
//   R2AssetPipelineService (tenant-vaulted key, §8.1).
// - Zero new deps.
import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../guards/jwt-auth.guard';
import { TenantGuard } from '../../../common/guards/tenant.guard';
import { assertMerchantRole } from '../../merchant/domain/entities/merchant-account.entity';
import { R2AssetPipelineService } from '../services/r2-asset-pipeline.service';

@Controller('api/v1/builder')
@UseGuards(JwtAuthGuard, TenantGuard)
export class UploadPresignController {
  constructor(private readonly pipeline: R2AssetPipelineService) {}

  @Post('presign-upload')
  presign(@Req() req: Record<string, unknown>, @Body() body: unknown) {
    const user = (req['user'] as { role?: string } | undefined) ?? {};
    assertMerchantRole(user.role);
    const headers = (req['headers'] ?? {}) as Record<string, string | undefined>;
    const tenantId = ((req['tenantId'] as string | undefined) ?? headers['x-tenant-id'] ?? 'default').trim();
    return this.pipeline.presign(tenantId || 'default', body);
  }
}
