// SSOT Phase 029 §5.1 — Prisma performance repository (append-only telemetry)
// Canonical: apps/backend/src/modules/performance/infrastructure/persistence/prisma-performance.repository.ts
// (legacy src/backend/modules/performance/.../prisma-performance.repository.ts)
// - Gate 7: all writes are fire-and-forget appends (catch-and-swallow inside,
//   never throw the hot path); reads are single-row indexed lookups (no N+1).
// - Structural prisma typing (Phase 027 navigation precedent) — no model import.
// - Zero new deps.
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../infra/database/prisma.service';
import { rumToMetricType, type PerformanceMetricType } from '@repo/shared';

interface PerformanceTables {
  performanceMetric: { create: (args: unknown) => Promise<unknown> };
  bundleManifest: {
    upsert: (args: unknown) => Promise<unknown>;
    findFirst: (args: unknown) => Promise<unknown>;
  };
  prefetchAnalytics: { create: (args: unknown) => Promise<unknown> };
}

export interface BundleManifestRow {
  buildHash: string;
  totalSizeBytes: number;
  gzipSizeBytes: number;
  isPassedGuard: boolean;
  chunksJson: unknown;
}

@Injectable()
export class PrismaPerformanceRepository {
  private readonly logger = new Logger(PrismaPerformanceRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  private get tables(): PerformanceTables {
    return this.prisma as unknown as PerformanceTables;
  }

  /** Append a RUM/telemetry point (never throws). */
  async saveMetric(input: {
    tenantId: string;
    metricType: PerformanceMetricType;
    metricValue: number;
    route: string;
    deviceMemory?: number;
    effectiveType?: string;
    userAgent?: string;
  }): Promise<void> {
    await this.tables.performanceMetric
      .create({
        data: {
          tenantId: input.tenantId,
          metricType: rumToMetricType(input.metricType),
          metricValue: input.metricValue,
          route: input.route,
          ...(input.deviceMemory !== undefined ? { deviceMemory: input.deviceMemory } : {}),
          ...(input.effectiveType ? { effectiveType: input.effectiveType } : {}),
          ...(input.userAgent ? { userAgent: input.userAgent } : {}),
        },
      })
      .catch((err: unknown) => {
        this.logger.warn(`Metric write failed: ${err instanceof Error ? err.message : 'unknown'}`);
      });
  }

  /** Idempotent manifest record keyed by buildHash (CI guard source of truth). */
  async saveManifest(row: BundleManifestRow): Promise<void> {
    await this.tables.bundleManifest
      .upsert({
        where: { buildHash: row.buildHash },
        update: {
          totalSizeBytes: row.totalSizeBytes,
          gzipSizeBytes: row.gzipSizeBytes,
          isPassedGuard: row.isPassedGuard,
          chunksJson: row.chunksJson ?? {},
        },
        create: {
          buildHash: row.buildHash,
          totalSizeBytes: row.totalSizeBytes,
          gzipSizeBytes: row.gzipSizeBytes,
          isPassedGuard: row.isPassedGuard,
          chunksJson: row.chunksJson ?? {},
        },
      })
      .catch((err: unknown) => {
        this.logger.warn(`Manifest write failed: ${err instanceof Error ? err.message : 'unknown'}`);
      });
  }

  async latestManifest(): Promise<BundleManifestRow | null> {
    const row = (await this.tables.bundleManifest
      .findFirst({ orderBy: { createdAt: 'desc' } })
      .catch(() => null)) as (BundleManifestRow & { chunksJson?: unknown }) | null;
    if (!row) return null;
    return {
      buildHash: row.buildHash,
      totalSizeBytes: row.totalSizeBytes,
      gzipSizeBytes: row.gzipSizeBytes,
      isPassedGuard: row.isPassedGuard,
      chunksJson: (row as { chunksJson?: unknown }).chunksJson ?? {},
    };
  }

  /** Append a prefetch hit/miss row (never throws). */
  async logPrefetch(input: {
    userId: string;
    productId: string;
    resourceKey: string;
    isHit: boolean;
    latencySavedMs: number;
  }): Promise<void> {
    await this.tables.prefetchAnalytics.create({ data: input }).catch((err: unknown) => {
      this.logger.warn(`Prefetch analytics write failed: ${err instanceof Error ? err.message : 'unknown'}`);
    });
  }
}
