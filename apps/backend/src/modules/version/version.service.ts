// SSOT Phase 033 Task 2/§5.2 — Version service (edge-first check + fleet log)
// Canonical: apps/backend/src/modules/version/version.service.ts
// (legacy src/backend/modules/version/version.service.ts)
// - BDD Scenario 1: Redis hit serves the release pointer in <20ms; miss falls
//   back to the newest active row and refills the edge (300s TTL, Gate 6).
// - No active release → echo-client OPTIONAL (never force a user with no data).
// - Decision delegates to evaluateUpdate() (@repo/shared single source).
// - Device-log append is fire-and-forget (Gate 7 — never blocks the fast path).
// - Zero new deps: Prisma SSOT + RedisClusterService only.
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infra/database/prisma.service';
import { RedisClusterService } from '../../infra/redis/redis-cluster.service';
import {
  LatestReleaseSchema,
  UpdatePolicyEnum,
  VERSION_CACHE_TTL_SEC,
  VersionCheckRequestSchema,
  evaluateUpdate,
  versionCacheKey,
  type LatestRelease,
  type VersionCheckRequest,
  type VersionCheckResponse,
} from '@repo/shared';

interface VersionTables {
  appVersion: {
    findFirst: (args: unknown) => Promise<(LatestRelease & { releaseNotes?: string | null }) | null>;
  };
  clientDeviceLog: {
    create: (args: unknown) => Promise<unknown>;
  };
}

export interface DeviceMeta {
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class VersionService {
  private readonly logger = new Logger(VersionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisClusterService,
  ) {}

  private get tables(): VersionTables {
    return this.prisma as unknown as VersionTables;
  }

  async evaluateClientVersion(body: unknown, meta: DeviceMeta = {}): Promise<VersionCheckResponse> {
    const parsed = VersionCheckRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid version check request');
    const dto: VersionCheckRequest = parsed.data;

    const key = versionCacheKey(dto.tenantId);
    let latest: LatestRelease | null = null;
    const cached = await this.redis.get(key).catch(() => null);
    if (cached) {
      try {
        const hit = LatestReleaseSchema.safeParse(JSON.parse(cached) as unknown);
        if (hit.success) latest = hit.data;
        else this.logger.warn(`Corrupt version cache entry ignored: ${key}`);
      } catch {
        this.logger.warn(`Corrupt version cache entry ignored: ${key}`);
      }
    }
    if (!latest) {
      const row = await this.tables.appVersion
        .findFirst({ where: { tenantId: dto.tenantId, isActive: true }, orderBy: { releasedAt: 'desc' } })
        .catch(() => null);
      // Fail-open on malformed admin rows (empty/garbage versions must never
      // force-update the fleet — echo-client instead, same as no-release).
      const semverLike = (v: unknown): v is string => typeof v === 'string' && /^\d+\.\d+\.\d+$/.test(v);
      if (!row || !row.buildHash || !semverLike(row.version) || !semverLike(row.minSupportedVersion)) {
        if (row) this.logger.warn(`Malformed release row ignored for tenant ${dto.tenantId}`);
        return {
          isLatest: true,
          needsForceUpdate: false,
          latestVersion: dto.clientVersion,
          latestBuildHash: dto.clientBuildHash,
          updatePolicy: 'OPTIONAL',
        };
      }
      // DB policy is free-text: coerce to the enum (fail-closed to OPTIONAL).
      const policy = UpdatePolicyEnum.safeParse(row.updatePolicy);
      latest = {
        version: row.version,
        buildHash: row.buildHash,
        minSupportedVersion: row.minSupportedVersion,
        updatePolicy: policy.success ? policy.data : 'OPTIONAL',
        ...(row.releaseNotes ? { releaseNotes: row.releaseNotes } : {}),
      };
      await this.redis.setex(key, VERSION_CACHE_TTL_SEC, JSON.stringify(latest)).catch(() => undefined);
    }

    const decision = evaluateUpdate(dto.clientVersion, dto.clientBuildHash, latest);
    void this.tables.clientDeviceLog
      .create({
        data: {
          tenantId: dto.tenantId,
          clientVersion: dto.clientVersion,
          clientBuildHash: dto.clientBuildHash,
          platform: dto.platform,
          ...(meta.ipAddress ? { ipAddress: meta.ipAddress } : {}),
          ...(meta.userAgent ? { userAgent: meta.userAgent } : {}),
        },
      })
      .catch((err: unknown) => {
        this.logger.warn(`Device log write failed: ${err instanceof Error ? err.message : 'unknown'}`);
      });

    return {
      ...decision,
      latestVersion: latest.version,
      latestBuildHash: latest.buildHash,
      ...(latest.releaseNotes ? { releaseNotes: latest.releaseNotes } : {}),
    };
  }
}
