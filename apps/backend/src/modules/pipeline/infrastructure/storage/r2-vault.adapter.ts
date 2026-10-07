// SSOT Phase 038 Task 5 — R2 vault adapter (chunk envelope transport)
// Canonical: apps/backend/src/modules/pipeline/infrastructure/storage/r2-vault.adapter.ts
// (legacy src/backend/modules/pipeline/infrastructure/storage/r2-vault.adapter.ts)
// - Thin adapter over R2StorageService (Phase 036 SigV4 transport): JSON
//   envelope upload + text read. Keeps the use-cases transport-agnostic.
// - Zero new deps.
import { Injectable } from '@nestjs/common';
import { R2StorageService } from '../../../../infra/cloudflare/r2-storage.service';

@Injectable()
export class R2VaultAdapter {
  constructor(private readonly r2: R2StorageService) {}

  uploadBuffer(objectKey: string, body: string, contentType: string): Promise<{ eTag: string }> {
    return this.r2.putObject(objectKey, body, contentType);
  }

  readText(objectKey: string): Promise<string> {
    return this.r2.getObjectText(objectKey);
  }
}
