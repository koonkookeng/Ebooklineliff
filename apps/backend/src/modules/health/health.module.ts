import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
// Phase 130 additive lane: readiness + go-live audit (001 lane untouched).
import { GoLiveController } from './go-live.controller';
import { GoLiveAuditService } from './go-live-audit.service';
import { PrismaService } from '../../infra/database/prisma.service';
import { RedisClusterService } from '../../infra/redis/redis-cluster.service';

@Module({
  controllers: [HealthController, GoLiveController],
  providers: [
    HealthService,
    {
      provide: GoLiveAuditService,
      useFactory: (prisma: PrismaService, redis: RedisClusterService) => {
        // Tagged-template $queryRaw keeps the probe parameterised (no
        // $queryRawUnsafe in the production path even for a constant).
        const db = prisma as unknown as {
          $queryRaw<T = unknown>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T>;
        };
        return new GoLiveAuditService({ queryRaw: () => db.$queryRaw`SELECT 1` }, redis);
      },
      inject: [PrismaService, RedisClusterService],
    },
  ],
  exports: [GoLiveAuditService],
})
export class HealthModule {}
