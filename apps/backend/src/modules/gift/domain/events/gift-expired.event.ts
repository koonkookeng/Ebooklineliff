// SSOT Phase 089 §7 — Gift domain events (stream vocabulary)
// Canonical: apps/backend/src/modules/gift/domain/events/gift-expired.event.ts
export const GIFT_EXPIRED_EVENT = 'gift.expired';

export interface GiftExpiredEvent {
  event: typeof GIFT_EXPIRED_EVENT;
  giftId: string;
  senderUserId: string;
  productId: string;
  at: number;
}
