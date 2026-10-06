// SSOT Phase 015 §5.1 — Entitlement read service (grant-result details)
// Canonical: apps/backend/src/modules/entitlement/services/entitlement.service.ts
// Complements EntitlementGrantService (write path) with the enriched grant
// rows the GraphQL layer returns (spec §3.2 EntitlementGrantResult).
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infra/database/prisma.service';

export interface EntitlementGrantResult {
  entitlementId: string;
  productId: string;
  productTitle: string;
  productType: string;
  grantedAt: string;
}

type PrismaLike = {
  entitlement: {
    findMany: (args: unknown) => Promise<Array<{ id: string; productId: string; createdAt: Date }>>;
  };
  product: {
    findMany: (args: unknown) => Promise<Array<{ id: string; title: string; productType: string }>>;
  };
};

@Injectable()
export class EntitlementService {
  constructor(private readonly prisma: PrismaService) {}

  /** Returns enriched grant rows for a user's products (empty when none). */
  async listGrantResults(userId: string, productIds: string[]): Promise<EntitlementGrantResult[]> {
    if (!userId || productIds.length === 0) return [];
    const db = this.prisma as unknown as PrismaLike;
    const unique = [...new Set(productIds)];
    const [rows, products] = await Promise.all([
      db.entitlement.findMany({ where: { userId, productId: { in: unique } } }).catch(() => []),
      db.product.findMany({ where: { id: { in: unique } }, select: { id: true, title: true, productType: true } }).catch(() => []),
    ]);
    const titles = new Map(products.map((p) => [p.id, p]));
    return rows.map((r) => ({
      entitlementId: r.id,
      productId: r.productId,
      productTitle: titles.get(r.productId)?.title ?? r.productId,
      productType: titles.get(r.productId)?.productType ?? 'UNKNOWN',
      grantedAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
    }));
  }
}
