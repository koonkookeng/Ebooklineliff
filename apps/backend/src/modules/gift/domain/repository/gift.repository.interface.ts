// SSOT Phase 089 §5.1 — Gift repository port
// Canonical: apps/backend/src/modules/gift/domain/repository/gift.repository.interface.ts
// - Port consumed by services (DB-free contract tests); structural Prisma
//   implementation lives in infrastructure/persistence.
// - Zero new deps.
export interface GiftProductRow {
  id: string;
  title: string;
  coverImageUrl: string;
  productType: string;
}

export interface GiftRow {
  id: string;
  orderId: string | null;
  senderUserId: string;
  recipientUserId: string | null;
  productId: string;
  claimCode: string;
  status: string;
  greetingTheme: string;
  greetingMessage: string;
  senderDisplayName: string;
  isAnonymous: boolean;
  expiresAt: Date;
  claimedAt: Date | null;
}

export interface GiftRepository {
  withTx?(tx: unknown): GiftRepository;
  findProduct(productId: string): Promise<GiftProductRow | null>;
  createGift(args: {
    senderUserId: string;
    productId: string;
    claimCode: string;
    greetingTheme: string;
    greetingMessage: string;
    senderDisplayName: string;
    isAnonymous: boolean;
    expiresAt: Date;
  }): Promise<GiftRow>;
  findByClaimCode(claimCode: string): Promise<(GiftRow & { product: GiftProductRow }) | null>;
  findById(id: string): Promise<GiftRow | null>;
  bindOrder(giftId: string, orderId: string): Promise<void>;
  claimAtomic(args: { giftId: string; recipientUserId: string }): Promise<GiftRow>;
  senderGifts(senderUserId: string): Promise<GiftRow[]>;
  expireDue(now: Date, limit: number): Promise<GiftRow[]>;
  revertToSender(giftId: string): Promise<void>;
}
