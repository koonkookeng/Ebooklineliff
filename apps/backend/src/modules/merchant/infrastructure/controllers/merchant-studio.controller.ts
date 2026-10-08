// SSOT Phase 073 §5.2 — Merchant Studio REST (product + direct upload)
// Canonical: apps/backend/src/modules/merchant/infrastructure/controllers/merchant-studio.controller.ts
// - POST product/upsert — JWT + TenantGuard + merchant role (spec §5.2).
// - POST video/presigned-upload — tenant-vaulted R2 PUT URL (zero-egress;
//   transcode itself stays in the 043/044 Stream pipeline — handoff by key).
// - Zero new deps.
import { BadRequestException, Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { JwtAuthGuard } from '../../../../guards/jwt-auth.guard';
import { TenantGuard } from '../../../../common/guards/tenant.guard';
import { assertMerchantRole } from '../../domain/entities/merchant-account.entity';
import { CreateProductStudioUseCase } from '../../application/use-cases/create-product-studio.usecase';
import { R2StorageService } from '../../../../infra/cloudflare/r2-storage.service';

const PresignedUploadSchema = z.object({
  fileName: z.string().min(1),
  fileSize: z.number().int().positive(),
  contentType: z.string().min(1).default('video/mp4'),
});

function headerTenant(req: Record<string, unknown>): string | undefined {
  const headers = (req['headers'] ?? {}) as Record<string, string | undefined>;
  return headers['x-tenant-id'] ?? headers['X-Tenant-ID'];
}

function userRole(req: Record<string, unknown>): string | undefined {
  return (req['user'] as { role?: string } | undefined)?.role;
}

@Controller('api/v1/merchant/studio')
@UseGuards(JwtAuthGuard, TenantGuard)
export class MerchantStudioController {
  constructor(
    private readonly products: CreateProductStudioUseCase,
    private readonly r2: R2StorageService,
  ) {}

  @Post('product/upsert')
  upsertProduct(@Req() req: Record<string, unknown>, @Body() body: unknown) {
    assertMerchantRole(userRole(req));
    return this.products.execute(headerTenant(req), body);
  }

  @Post('video/presigned-upload')
  presignedUpload(@Req() req: Record<string, unknown>, @Body() body: unknown) {
    assertMerchantRole(userRole(req));
    const parsed = PresignedUploadSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid upload payload');
    const tenantId = (req['tenantId'] as string | undefined) ?? headerTenant(req) ?? 'default';
    const safeName = parsed.data.fileName.replace(/[^A-Za-z0-9._-]/g, '_');
    const objectKey = `tenants/${tenantId}/studio/raw/${Date.now()}-${safeName}`;
    return {
      uploadUrl: this.r2.presignedPutUrl(objectKey, parsed.data.contentType, 900),
      objectKey,
      expiresInSeconds: 900,
    };
  }
}
