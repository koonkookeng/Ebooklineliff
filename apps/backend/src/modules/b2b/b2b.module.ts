// SSOT Phase 097 §5.1 — B2B module wiring
// Canonical: apps/backend/src/modules/b2b/b2b.module.ts
// - Repository + license/claim/analytics services -> REST + GQL.
//   Entitlement writes reuse EntitlementGrantService (012 single writer).
//   License edge counter rides Redis (Gate 8). Zero new deps.
import { Module } from '@nestjs/common';
import { PrismaService } from '../../infra/database/prisma.service';
import { RedisClusterService } from '../../infra/redis/redis-cluster.service';
import { EntitlementGrantService } from '../entitlement/services/entitlement-grant.service';
import { PrismaB2bRepository } from './repositories/b2b-prisma.repository';
import { B2bLicenseService } from './services/b2b-license.service';
import { B2bSeatAllocationService } from './services/b2b-seat-allocation.service';
import { B2bAnalyticsService } from './services/b2b-analytics.service';
import { B2bCorporateController } from './controllers/b2b-corporate.controller';
import { B2bSeatResolver } from './resolvers/b2b-seat.resolver';

@Module({
  controllers: [B2bCorporateController],
  providers: [
    PrismaB2bRepository,
    EntitlementGrantService,
    {
      provide: B2bLicenseService,
      useFactory: (repo: PrismaB2bRepository, redis: RedisClusterService) =>
        new B2bLicenseService(repo, {
          xadd: (stream: string, fields: Record<string, string | number>) =>
            redis.xaddPipeline(stream, [fields]),
        }),
      inject: [PrismaB2bRepository, RedisClusterService],
    },
    {
      provide: B2bSeatAllocationService,
      useFactory: (
        repo: PrismaB2bRepository,
        redis: RedisClusterService,
        prisma: PrismaService,
        grants: EntitlementGrantService,
      ) =>
        new B2bSeatAllocationService(
          repo,
          {
            set: (key: string, value: string | Buffer, ...args: Array<string | number>) =>
              redis.set(key, value, ...args),
            del: (...keys: string[]) => redis.del(...keys),
            setEdge: (key: string, value: string, ttlSec: number) =>
              redis.set(key, value, 'EX', ttlSec).then(() => undefined),
            delEdge: (key: string) => redis.del(key),
            xaddPipeline: (stream: string, batch: Array<Record<string, string | number>>) =>
              redis.xaddPipeline(stream, batch),
          },
          { run: <T>(fn: (tx: unknown) => Promise<T>) => prisma.$transaction((tx) => fn(tx)) },
          grants,
        ),
      inject: [PrismaB2bRepository, RedisClusterService, PrismaService, EntitlementGrantService],
    },
    {
      provide: B2bAnalyticsService,
      useFactory: (repo: PrismaB2bRepository, prisma: PrismaService) =>
        new B2bAnalyticsService(repo, {
          licenseCompletion: async (licenseId: string) => {
            const db = prisma as unknown as {
              corporateSeat: { count: (args: unknown) => Promise<number> };
            };
            const assigned = await db.corporateSeat.count({ where: { licenseId, status: 'ACTIVE' } }).catch(() => 0);
            return { assigned, activeUsers: assigned };
          },
        }),
      inject: [PrismaB2bRepository, PrismaService],
    },
    {
      provide: B2bSeatResolver,
      useFactory: (
        licenses: B2bLicenseService,
        seats: B2bSeatAllocationService,
        analytics: B2bAnalyticsService,
        repo: PrismaB2bRepository,
      ) => new B2bSeatResolver(licenses, seats, analytics, repo),
      inject: [B2bLicenseService, B2bSeatAllocationService, B2bAnalyticsService, PrismaB2bRepository],
    },
  ],
  exports: [B2bLicenseService, B2bSeatAllocationService, B2bAnalyticsService, PrismaB2bRepository],
})
export class B2bModule {}
