// SSOT Phase 089 §7 — Gift domain events (stream vocabulary)
// Canonical: apps/backend/src/modules/gift/domain/events/gift-claimed.event.ts
export const GIFT_CLAIMED_EVENT = 'gift.claimed';

export interface GiftClaimedEvent {
  event: typeof GIFT_CLAIMED_EVENT;
  giftId: string;
  claimCode: string;
  senderUserId: string;
  recipientUserId: string;
  productId: string;
  at: number;
}
