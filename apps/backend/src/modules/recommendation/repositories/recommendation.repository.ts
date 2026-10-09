// SSOT Phase 104 §4.1/§5.2 — Recommendation repository port + Prisma adapter
// Canonical: apps/backend/src/modules/recommendation/repositories/recommendation.repository.ts
// - Interaction logs + preference profile + product embeddings + slate ledger.
// - pgvector reads go through $queryRawUnsafe (tenant-isolated, published-only).
// - Port-based for DB-free tests. Zero new deps.
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infra/database/prisma.service';

export interface ProductCard {
  productId: string;
  title: string;
  coverImageUrl: string;
  productType: string;
  price: number;
  discountPrice: number | null;
  soldCount: number;
}

export interface VectorCandidate {
  productId: string;
  similarity: number;
}

export interface CoPurchaseCandidate {
  productId: string;
  score: number;
}

export interface PreferenceProfile {
  userId: string;
  preferredCategories: Record<string, number>;
  priceSensitivity: number;
}

export interface RecommendationRepository {
  countInteractions(userId: string): Promise<number>;
  logInteraction(data: {
    userId: string;
    productId: string;
    eventType: string;
    dwellTimeSec?: number;
    progressPercentage?: number;
  }): Promise<{ id: string }>;
  findRecentProductIds(userId: string, limit: number): Promise<string[]>;
  findProductEmbeddings(productIds: string[]): Promise<Array<{ productId: string; embedding: number[] }>>;
  upsertProductEmbedding(productId: string, embedding: number[], summaryText: string): Promise<void>;
  getProfile(userId: string): Promise<PreferenceProfile | null>;
  upsertProfileWeights(userId: string, weights: Record<string, number>): Promise<void>;
  findPurchasedProductIds(userId: string): Promise<string[]>;
  findBestsellers(tenantId: string, limit: number): Promise<ProductCard[]>;
  findProductCards(productIds: string[], tenantId: string): Promise<ProductCard[]>;
  vectorCandidates(vectorString: string, tenantId: string, limit: number): Promise<VectorCandidate[]>;
  coPurchaseCandidates(purchasedIds: string[], userId: string, limit: number): Promise<CoPurchaseCandidate[]>;
  logSlate(rows: Array<{ userId: string; productId: string; positionIndex: number; reasonType: string }>): Promise<void>;
  markSlateFeedback(userId: string, productId: string, field: 'isClicked' | 'isPurchased'): Promise<void>;
}

type RawDb = {
  $queryRawUnsafe: <T>(sql: string, ...args: unknown[]) => Promise<T>;
};

function parseVector(raw: unknown): number[] {
  if (Array.isArray(raw)) return raw as number[];
  if (typeof raw === 'string') {
    try {
      const v = JSON.parse(raw) as unknown;
      if (Array.isArray(v)) return v as number[];
    } catch { /* fall through */ }
  }
  return [];
}

function toCard(r: Record<string, unknown>): ProductCard {
  return {
    productId: String(r['productId'] ?? r['id'] ?? ''),
    title: String(r['title'] ?? ''),
    coverImageUrl: String(r['coverImageUrl'] ?? ''),
    productType: String(r['productType'] ?? 'EBOOK'),
    price: Number(r['price'] ?? 0),
    discountPrice: r['discountPrice'] == null ? null : Number(r['discountPrice']),
    soldCount: Number(r['soldCount'] ?? 0),
  };
}

function tenantPublished(pos: number): string {
  return `p."isPublished" = true AND p."deletedAt" IS NULL AND (p."tenantId" = $${pos} OR p."tenantId" IS NULL)`;
}

@Injectable()
export class PrismaRecommendationRepository implements RecommendationRepository {
  constructor(private readonly prisma: PrismaService) {}

  private get db(): Record<string, Record<string, (...a: unknown[]) => Promise<unknown>>> {
    return this.prisma as unknown as Record<string, Record<string, (...a: unknown[]) => Promise<unknown>>>;
  }

  private get raw(): RawDb {
    return this.prisma as unknown as RawDb;
  }

  async countInteractions(userId: string): Promise<number> {
    const logs = this.db['userInteractionLog'];
    return (await logs.count({ where: { userId } }).catch(() => 0)) as unknown as number;
  }

  async logInteraction(data: {
    userId: string;
    productId: string;
    eventType: string;
    dwellTimeSec?: number;
    progressPercentage?: number;
  }): Promise<{ id: string }> {
    const logs = this.db['userInteractionLog'];
    const row = (await logs.create({ data })) as unknown as { id: string };
    return { id: row.id };
  }

  async findRecentProductIds(userId: string, limit: number): Promise<string[]> {
    const logs = this.db['userInteractionLog'];
    const rows = (await logs
      .findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: limit, select: { productId: true } })
      .catch(() => [])) as unknown as Array<{ productId: string }>;
    return [...new Set(rows.map((r) => r.productId))];
  }

  async findProductEmbeddings(productIds: string[]): Promise<Array<{ productId: string; embedding: number[] }>> {
    if (productIds.length === 0) return [];
    const rows = await this.raw
      .$queryRawUnsafe<Array<{ productId: string; embedding: unknown }>>(
        `SELECT "productId", "embedding"::text AS "embedding" FROM "ProductEmbedding" WHERE "productId" = ANY($1)`,
        productIds,
      )
      .catch(() => []);
    return rows.map((r) => ({ productId: r.productId, embedding: parseVector(r.embedding) }));
  }

  async upsertProductEmbedding(productId: string, embedding: number[], summaryText: string): Promise<void> {
    const vectorString = `[${embedding.join(',')}]`;
    await this.raw
      .$queryRawUnsafe(
        `INSERT INTO "ProductEmbedding" ("id", "productId", "embedding", "summaryText", "updatedAt")
         VALUES (gen_random_uuid(), $1, $2::vector, $3, NOW())
         ON CONFLICT ("productId") DO UPDATE SET "embedding" = EXCLUDED."embedding", "summaryText" = EXCLUDED."summaryText", "updatedAt" = NOW()`,
        productId,
        vectorString,
        summaryText,
      )
      .catch(() => undefined);
  }

  async getProfile(userId: string): Promise<PreferenceProfile | null> {
    const profiles = this.db['userPreferenceProfile'];
    const row = (await profiles.findUnique({ where: { userId } }).catch(() => null)) as unknown as {
      userId: string;
      preferredCategories: unknown;
      priceSensitivity: number;
    } | null;
    if (!row) return null;
    return {
      userId: row.userId,
      preferredCategories: (row.preferredCategories ?? {}) as Record<string, number>,
      priceSensitivity: Number(row.priceSensitivity ?? 0.5),
    };
  }

  async upsertProfileWeights(userId: string, weights: Record<string, number>): Promise<void> {
    const profiles = this.db['userPreferenceProfile'];
    const existing = await this.getProfile(userId).catch(() => null);
    const merged = { ...(existing?.preferredCategories ?? {}), ...weights };
    await profiles
      .upsert({
        where: { userId },
        create: { userId, preferredCategories: merged },
        update: { preferredCategories: merged },
      })
      .catch(() => null);
  }

  async findPurchasedProductIds(userId: string): Promise<string[]> {
    const entitlements = this.db['entitlement'];
    const rows = (await entitlements
      .findMany({ where: { userId }, select: { productId: true } })
      .catch(() => [])) as unknown as Array<{ productId: string }>;
    return rows.map((r) => r.productId);
  }

  async findBestsellers(tenantId: string, limit: number): Promise<ProductCard[]> {
    const rows = await this.raw
      .$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT p."id" AS "productId", p."title", p."coverImageUrl", p."productType", p."price", p."discountPrice", p."soldCount"
         FROM "Product" p
         WHERE ${tenantPublished(1)}
         ORDER BY p."soldCount" DESC LIMIT $2`,
        tenantId,
        limit,
      )
      .catch(() => []);
    return rows.map(toCard);
  }

  async findProductCards(productIds: string[], tenantId: string): Promise<ProductCard[]> {
    if (productIds.length === 0) return [];
    const rows = await this.raw
      .$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT p."id" AS "productId", p."title", p."coverImageUrl", p."productType", p."price", p."discountPrice", p."soldCount"
         FROM "Product" p
         WHERE p."id" = ANY($1) AND ${tenantPublished(2)}`,
        productIds,
        tenantId,
      )
      .catch(() => []);
    const order = new Map(productIds.map((id, i) => [id, i]));
    return rows
      .map(toCard)
      .sort((a, b) => (order.get(a.productId) ?? 0) - (order.get(b.productId) ?? 0));
  }

  async vectorCandidates(vectorString: string, tenantId: string, limit: number): Promise<VectorCandidate[]> {
    const rows = await this.raw
      .$queryRawUnsafe<Array<{ productId: string; similarity: number }>>(
        `SELECT pe."productId" AS "productId", 1 - (pe."embedding" <=> $1::vector) AS "similarity"
         FROM "ProductEmbedding" pe JOIN "Product" p ON p."id" = pe."productId"
         WHERE ${tenantPublished(2)}
         ORDER BY pe."embedding" <=> $1::vector LIMIT $3`,
        vectorString,
        tenantId,
        limit,
      )
      .catch(() => []);
    return rows.map((r) => ({ productId: r.productId, similarity: Number(r.similarity) }));
  }

  async coPurchaseCandidates(purchasedIds: string[], userId: string, limit: number): Promise<CoPurchaseCandidate[]> {
    if (purchasedIds.length === 0) return [];
    const rows = await this.raw
      .$queryRawUnsafe<Array<{ productId: string; score: number }>>(
        `SELECT e2."productId" AS "productId", COUNT(*)::int AS "score"
         FROM "Entitlement" e1 JOIN "Entitlement" e2 ON e2."userId" = e1."userId"
         WHERE e1."productId" = ANY($1) AND e1."userId" <> $2 AND NOT (e2."productId" = ANY($1))
         GROUP BY e2."productId" ORDER BY "score" DESC LIMIT $3`,
        purchasedIds,
        userId,
        limit,
      )
      .catch(() => []);
    return rows.map((r) => ({ productId: r.productId, score: Number(r.score) }));
  }

  async logSlate(
    rows: Array<{ userId: string; productId: string; positionIndex: number; reasonType: string }>,
  ): Promise<void> {
    if (rows.length === 0) return;
    const logs = this.db['recommendationSlateLog'];
    await logs.createMany({ data: rows }).catch(() => null);
  }

  async markSlateFeedback(userId: string, productId: string, field: 'isClicked' | 'isPurchased'): Promise<void> {
    const logs = this.db['recommendationSlateLog'];
    await logs
      .updateMany({ where: { userId, productId }, data: { [field]: true } })
      .catch(() => null);
  }
}
