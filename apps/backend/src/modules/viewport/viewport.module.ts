// SSOT Phase 056 §5.1 — ViewportModule (router + REST + GQL wiring)
// Canonical: apps/backend/src/modules/viewport/viewport.module.ts
// (legacy src/backend/modules/viewport/viewport.module.ts)
// - useFactory wiring keeps the service tsx-importable (Phase 047 precedent).
// - PrismaService + RedisClusterService arrive via global InfraModule.
import { Module } from '@nestjs/common';
import { PrismaService } from '../../infra/database/prisma.service';
import { RedisClusterService } from '../../infra/redis/redis-cluster.service';
import { ViewportController } from './viewport.controller';
import { ViewportResolver } from './viewport.resolver';
import { ViewportRouterService } from './viewport.service';

@Module({
  controllers: [ViewportController],
  providers: [
    {
      provide: ViewportRouterService,
      useFactory: (prisma: PrismaService, edge: RedisClusterService): ViewportRouterService =>
        new ViewportRouterService(
          {
            hasEntitlement: async (userId: string, productId: string): Promise<boolean> => {
              const row = await (prisma as unknown as {
                entitlement: { findUnique(args: unknown): Promise<unknown> };
              }).entitlement.findUnique({ where: { userId_productId: { userId, productId } } });
              return row !== null;
            },
          },
          {
            displayNameOf: async (userId: string): Promise<string> => {
              const row = (await (prisma as unknown as {
                user: { findUnique(args: unknown): Promise<{ displayName?: string } | null> };
              }).user.findUnique({ where: { id: userId } }).catch(() => null)) ?? null;
              return row?.displayName ?? 'User';
            },
          },
          {
            set: async (key: string, value: string, ttlSeconds: number): Promise<void> => {
              await edge.setex(key, ttlSeconds, value).catch(() => undefined);
            },
          },
        ),
      inject: [PrismaService, RedisClusterService],
    },
    ViewportResolver,
  ],
  exports: [ViewportRouterService],
})
export class ViewportModule {}
