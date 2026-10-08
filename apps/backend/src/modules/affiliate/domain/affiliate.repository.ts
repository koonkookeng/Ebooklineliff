// SSOT Phase 079 §5.1 — Affiliate repository port
// Canonical: apps/backend/src/modules/affiliate/domain/affiliate.repository.ts
// - Port consumed by services (DB-free contract tests); structural Prisma
//   implementation lives in infrastructure/prisma-affiliate.repository.ts.
// - Zero new deps.
export interface AffiliateUserRow {
  id: string;
  tenantId: string | null;
  affiliateCode: string;
  referredById: string | null;
  lineUserId: string | null;
  walletBalance: number;
}

export interface AffiliateOrderRow {
  orderId: string;
  orderNumber: string;
  tenantId: string | null;
  buyerId: string;
  buyerLineUserId: string | null;
  paymentStatus: string;
  netAmount: number;
}

export interface AffiliateRepository {
  /** Tx-bound view — commission writes stay inside one atomic transaction. */
  withTx?(tx: unknown): AffiliateRepository;
  findUser(userId: string): Promise<AffiliateUserRow | null>;
  findUserByCode(affiliateCode: string): Promise<AffiliateUserRow | null>;
  findOrder(orderId: string): Promise<AffiliateOrderRow | null>;
  tierConfig(productId: string | null): Promise<{ t1: number; t2: number; t3: number }>;
  hasCommissionForOrder(orderId: string): Promise<boolean>;
  createCommission(args: {
    orderId: string;
    beneficiaryId: string;
    originBuyerId: string;
    tierLevel: string;
    orderAmount: number;
    commissionRate: number;
    commissionAmount: number;
    status: string;
    fraudReason?: string | null;
  }): Promise<void>;
  creditWallet(userId: string, amount: number): Promise<void>;
  approvedEarnings(userId: string): Promise<number>;
  createPayout(args: {
    payoutNo: string;
    userId: string;
    requestedAmount: number;
    taxWithheldAmount: number;
    netPayoutAmount: number;
    bankName: string;
    bankAccountNumber: string;
    bankAccountName: string;
  }): Promise<{ id: string }>;
  createShareEvent(args: { userId: string; productId: string; refToken: string }): Promise<{ id: string }>;
  dashboard(userId: string): Promise<{
    totalEarnings: number;
    pendingEarnings: number;
    tier1Count: number;
    tier2Count: number;
    affiliateCode: string;
  }>;
}
