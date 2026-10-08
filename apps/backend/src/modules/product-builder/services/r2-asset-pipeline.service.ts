// SSOT Phase 074 §8.1 — R2 asset pipeline (presign delegate, Zero Redundant)
// Canonical: apps/backend/src/modules/product-builder/services/r2-asset-pipeline.service.ts
// - Delegates SigV4 presigning to R2StorageService (single implementation,
//   Phase 036 owner). Tenant-vaulted keys: tenants/{tenant}/builder/...,
//   15-min TTL (§8.1). Transcode/chunking handoff stays in 038/043 pipes.
// - Zero new deps.
import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { BUILDER_PRESIGN_TTL_SEC } from '@repo/shared';
import { R2StorageService } from '../../../infra/cloudflare/r2-storage.service';

const PresignSchema = z.object({
  fileName: z.string().min(1),
  fileSize: z.number().int().positive(),
  contentType: z.string().min(1),
  kind: z.enum(['video', 'ebook', 'image']).default('video'),
});

@Injectable()
export class R2AssetPipelineService {
  constructor(private readonly r2: R2StorageService) {}

  presign(tenantId: string, body: unknown): { uploadUrl: string; objectKey: string; expiresInSeconds: number } {
    const parsed = PresignSchema.parse(body);
    const safe = parsed.fileName.replace(/[^A-Za-z0-9._-]/g, '_');
    const objectKey = `tenants/${tenantId}/builder/${parsed.kind}/${Date.now()}-${safe}`;
    return {
      uploadUrl: this.r2.presignedPutUrl(objectKey, parsed.contentType, BUILDER_PRESIGN_TTL_SEC),
      objectKey,
      expiresInSeconds: BUILDER_PRESIGN_TTL_SEC,
    };
  }
}
