// SSOT Phase 080 §5.1 — Share repository port
// Canonical: apps/backend/src/modules/share/domain/share.repository.ts
// - Port consumed by use-cases (DB-free contract tests); structural Prisma
//   implementation (078/079 precedent) — money math stays in the affiliate
//   module, this repo only aggregates its CommissionLog for estimatedEarnings.
// - Zero new deps.
export interface ShareProductRow {
  id: string;
  tenantId: string | null;
  title: string;
  description: string;
  coverImageUrl: string;
  price: number;
  discountPrice: number | null;
  productType: string;
}

export interface ShareEventRow {
  id: string;
  userId: string;
  productId: string;
  targetType: string;
  refToken: string;
  clickCount: number;
}

export interface ShareUserRow {
  id: string;
  affiliateCode: string;
  lineUserId: string | null;
}

export interface ShareRepository {
  withTx?(tx: unknown): ShareRepository;
  findProduct(productId: string): Promise<ShareProductRow | null>;
  findUser(userId: string): Promise<ShareUserRow | null>;
  createShareEvent(args: {
    userId: string;
    productId: string;
    targetType: string;
    refToken: string;
  }): Promise<ShareEventRow>;
  findShareEventByRefToken(refToken: string): Promise<ShareEventRow | null>;
  recordClick(args: {
    shareEventId: string;
    visitorLineId: string | null;
    ipAddress: string;
    userAgent: string;
  }): Promise<void>;
  shareMetrics(args: { userId: string; productId: string | null }): Promise<{
    totalShares: number;
    totalClicks: number;
    conversions: number;
    estimatedEarnings: number;
  }>;
}
