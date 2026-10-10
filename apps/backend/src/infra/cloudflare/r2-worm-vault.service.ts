// SSOT Phase 118 Task 4 §8.1 — R2 WORM vault service (compliance sink)
// Canonical: apps/backend/src/infra/cloudflare/r2-worm-vault.service.ts
// (legacy src/backend/infra/cloudflare/r2-worm-vault.service.ts)
// - Thin facade over R2StorageService for the audit WORM lane: NDJSON batch
//   puts under audit-worm/ with a 7-year retention tag carried alongside.
//   Bucket-level Object Lock (Compliance mode) is platform config owned by
//   infra (see r2-cors-policy / bucket docs) — this service never pretends
//   to set lock policy per object.
// - Zero new deps.
import { Injectable } from '@nestjs/common';
import { AUDIT_WORM_RETENTION_DAYS } from '@repo/shared';
import { R2StorageService } from './r2-storage.service';

export const AUDIT_WORM_PREFIX = 'audit-worm/';

@Injectable()
export class R2WormVaultService {
  constructor(private readonly r2: R2StorageService) {}

  retentionDays(): number {
    return AUDIT_WORM_RETENTION_DAYS;
  }

  prefix(): string {
    return AUDIT_WORM_PREFIX;
  }

  putBatch(objectKey: string, ndjson: string): Promise<{ eTag: string }> {
    if (!objectKey.startsWith(AUDIT_WORM_PREFIX)) {
      return Promise.reject(new Error('WORM writes are confined to audit-worm/'));
    }
    return this.r2.putObjectBuffer(objectKey, Buffer.from(ndjson, 'utf8'), 'application/x-ndjson');
  }
}
