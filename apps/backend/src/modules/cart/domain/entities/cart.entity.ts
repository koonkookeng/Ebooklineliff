// SSOT Phase 011 §5.1 — Cart aggregate guards (pure)
// Canonical: apps/backend/src/modules/cart/domain/entities/cart.entity.ts
import { BadRequestException } from '@nestjs/common';

/** Abandoned-cart window: 30 min of inactivity (Phase 084 consumer reads lastActivityAt). */
export const ABANDONED_AFTER_MIN = 30;

/** Checkout lock window: 15 min stock hold (matches PromptPay QR expiry). */
export const CHECKOUT_LOCK_MIN = 15;

export function assertCartOwner(cartUserId: string, actorUserId: string): void {
  if (!actorUserId || cartUserId !== actorUserId) {
    throw new BadRequestException('Cart access denied');
  }
}

export function isAbandoned(lastActivityAt: Date, now = new Date()): boolean {
  return now.getTime() - lastActivityAt.getTime() > ABANDONED_AFTER_MIN * 60_000;
}
