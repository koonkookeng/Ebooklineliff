// SSOT Phase 118 Task 4 §8.1 — R2 WORM vault adapter (batch NDJSON sink)
// Canonical: apps/backend/src/modules/audit-log/infrastructure/r2-worm-vault.adapter.ts
// (legacy src/backend/modules/audit-log/infrastructure/r2-worm-vault.adapter.ts)
// - Serializes a block window to NDJSON and sinks it via R2StorageService
//   (zero egress) under audit-worm/YYYY/MM/<head-seq>.ndjson. Object-Lock
//   Compliance (7y) is bucket policy owned by infra — the adapter records
//   the retention tag alongside the key (documented, asserted in tests).
// - Best-effort: vault failures never break the DB commit (sync state stays
//   behind → next sweep retries). Zero new deps.
import { Injectable, Logger } from '@nestjs/common';
import { AUDIT_WORM_BATCH_SIZE, AUDIT_WORM_RETENTION_DAYS, auditVaultKey } from '@repo/shared';
import { R2StorageService } from '../../../infra/cloudflare/r2-storage.service';

export interface WormBatchResult {
  r2ObjectKey: string;
  blocks: number;
  retentionDays: number;
  eTag: string;
}

@Injectable()
export class R2WormVaultAdapter {
  private readonly logger = new Logger(R2WormVaultAdapter.name);

  constructor(private readonly r2: R2StorageService) {}

  batchKey(headSequence: number | bigint, at: Date | string): string {
    void AUDIT_WORM_BATCH_SIZE;
    return auditVaultKey(headSequence, at);
  }

  toNdjson(blocks: Array<Record<string, unknown>>): string {
    return blocks.map((b) => JSON.stringify(b)).join('\n');
  }

  async sinkBatch(blocks: Array<Record<string, unknown>>, headSequence: number | bigint, at: Date | string): Promise<WormBatchResult | null> {
    if (blocks.length === 0) return null;
    const key = this.batchKey(headSequence, at);
    try {
      const { eTag } = await this.r2.putObjectBuffer(key, Buffer.from(this.toNdjson(blocks), 'utf8'), 'application/x-ndjson');
      return { r2ObjectKey: key, blocks: blocks.length, retentionDays: AUDIT_WORM_RETENTION_DAYS, eTag };
    } catch (err) {
      this.logger.warn(`WORM sink failed for ${key}: ${(err as Error).message}`);
      return null;
    }
  }
}
