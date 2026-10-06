// SSOT Phase 012 §5/BDD — Entitlement grant service (instant unlock inside verify txn)
// Canonical: apps/backend/src/modules/entitlement/services/entitlement-grant.service.ts
// Works with a Prisma transaction client (atomic with order+slip) or standalone.
import { Injectable } from '@nestjs/common';
import { RedisClusterService } from '../../../infra/redis/redis-cluster.service';

export type EntitlementAccessType = 'FULL_PURCHASE' | 'SUBSCRIPTION' | 'CORPORATE_LICENSE' | 'TIME_LIMITED_RENTAL';

type TxClient = {
  entitlement: {
    upsert: (args: unknown) => Promise<{ productId: string }>;
    findUnique: (args: unknown) => Promise<{ id: string } | null>;
  };
};

@Injectable()
export class EntitlementGrantService {
  constructor(private readonly redis: RedisClusterService) {}

  /** Idempotent FULL_PURCHASE grants for every product in the order. Returns granted ids. */
  async grantForOrder(
    tx: TxClient,
    userId: string,
    productIds: string[],
    accessType: EntitlementAccessType = 'FULL_PURCHASE',
  ): Promise<string[]> {
    const granted: string[] = [];
    for (const productId of new Set(productIds)) {
      const row = await tx.entitlement.upsert({
        where: { userId_productId: { userId, productId } },
        update: { accessType },
        create: { userId, productId, accessType },
      });
      granted.push(row.productId);
    }
    await this.redis.del(`cache:entitlements:${userId}`).catch(() => undefined);
    await this.redis
      .publish('stream:entitlement:granted', JSON.stringify({ userId, productIds: granted, at: new Date().toISOString() }))
      .catch(() => undefined);
    return granted;
  }

  /** Gatekeeper read: does the user hold access to this product? */
  async hasAccess(
    prisma: { entitlement: { findUnique: (args: unknown) => Promise<unknown> } },
    userId: string,
    productId: string,
  ): Promise<boolean> {
    const row = await prisma.entitlement
      .findUnique({ where: { userId_productId: { userId, productId } } })
      .catch(() => null);
    return row !== null;
  }
}
