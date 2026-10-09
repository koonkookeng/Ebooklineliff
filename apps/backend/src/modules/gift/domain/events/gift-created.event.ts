// SSOT Phase 089 §7 — Gift domain events (stream vocabulary)
// Canonical: apps/backend/src/modules/gift/domain/events/gift-created.event.ts
export const GIFT_CREATED_EVENT = 'gift.created';

export interface GiftCreatedEvent {
  event: typeof GIFT_CREATED_EVENT;
  giftId: string;
  claimCode: string;
  senderUserId: string;
  productId: string;
  at: number;
}
