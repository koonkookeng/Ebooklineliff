// SSOT Phase 123 Task 3 §5.1 — R2 lifecycle sync service
// Canonical: apps/backend/src/modules/storage/services/r2-lifecycle.service.ts
// (legacy src/backend/modules/storage/services/r2-lifecycle.service.ts)
// - Reads enabled StorageBucketPolicy rows (structural Prisma port), builds
//   the S3 LifecycleConfiguration XML via the SSOT helper, and PUTs it
//   through the R2 transport port (real: R2StorageService.putBucketLifecycle;
//   tests: in-memory fake). Clears the bucket lifecycle edge-cache key.
// - Backoff: 429/503 retry 3x (2^n*100ms + jitter, §10.1) then rethrow to
//   the secondary queue lane. Never touches payment/HLS cores.
// - Zero new deps (no @aws-sdk — SigV4 lives in the transport).
import { Injectable, Logger } from '@nestjs/common';
import {
  R2LifecycleRuleSchema,
  buildLifecycleXml,
  lifecycleCacheKey,
  type R2LifecycleRule,
} from '@repo/shared';

/** Enabled policy row (structural Prisma shape). */
export interface BucketPolicyRow {
  ruleId: string;
  prefix: string;
  enabled: boolean;
  expireDays: number | null;
  abortIncompleteMultipartDays: number;
  description: string | null;
}

/** Minimal Prisma surface (structural; no hard import). */
export interface LifecyclePrismaPort {
  storageBucketPolicy: {
    findMany(args: unknown): Promise<BucketPolicyRow[]>;
  };
}

/** Minimal R2 transport surface (structural). */
export interface LifecycleR2Port {
  putBucketLifecycle(bucket: string, xml: string): Promise<void>;
}

/** Minimal cache surface (structural). */
export interface LifecycleCachePort {
  del(...keys: string[]): Promise<void>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

@Injectable()
export class R2LifecycleService {
  private readonly logger = new Logger(R2LifecycleService.name);

  constructor(
    private readonly prisma: LifecyclePrismaPort,
    private readonly r2: LifecycleR2Port,
    private readonly cache: LifecycleCachePort,
  ) {}

  /** Enabled rules for a bucket, Zod-gated (corrupt rows fail closed). */
  async enabledRules(bucketName: string): Promise<R2LifecycleRule[]> {
    const rows = await this.prisma.storageBucketPolicy.findMany({
      where: { bucketName, enabled: true },
    });
    return rows.map((r) =>
      R2LifecycleRuleSchema.parse({
        ruleId: r.ruleId,
        prefix: r.prefix,
        enabled: r.enabled,
        ...(r.expireDays === null ? {} : { expireDays: r.expireDays }),
        abortIncompleteMultipartDays: r.abortIncompleteMultipartDays,
        ...(r.description === null ? {} : { description: r.description }),
      }),
    );
  }

  /**
   * Sync enabled rules to R2 (true = applied). Retries 429/503 3x with
   * exponential backoff + jitter, then rethrows for the fallback queue.
   */
  async syncBucketLifecycleRules(bucketName: string): Promise<boolean> {
    const rules = await this.enabledRules(bucketName);
    const xml = buildLifecycleXml(rules);
    let attempt = 0;
    for (;;) {
      attempt++;
      try {
        await this.r2.putBucketLifecycle(bucketName, xml);
        this.logger.log(`Successfully synced ${rules.length} lifecycle rules to Cloudflare R2 bucket: ${bucketName}`);
        try {
          await this.cache.del(lifecycleCacheKey(bucketName));
        } catch {
          // Cache clear is best-effort.
        }
        return true;
      } catch (err) {
        const retryable = /429|503|LIFECYCLE 429|LIFECYCLE 503/.test((err as Error).message);
        if (!retryable || attempt >= 3) {
          this.logger.error(`Failed to sync R2 lifecycle rules for ${bucketName}`, (err as Error).message);
          throw err;
        }
        await sleep(Math.pow(2, attempt) * 100 + Math.random() * 100);
      }
    }
  }
}

/** Backward-compat alias for the Phase-000 auto-scaffold name. */
export { R2LifecycleService as R2LifecycleServiceService };
