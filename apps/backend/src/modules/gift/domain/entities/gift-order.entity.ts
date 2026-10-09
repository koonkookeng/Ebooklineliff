// SSOT Phase 089 §5.1 — Gift order entity guards (state machine)
// Canonical: apps/backend/src/modules/gift/domain/entities/gift-order.entity.ts
// - Legal transitions: PENDING_PAYMENT → READY_TO_CLAIM → CLAIMED;
//   READY_TO_CLAIM → EXPIRED_REVERTED (30d sweep); any → CANCELLED_REFUNDED
//   pre-claim. Claim requires READY + window (canClaim).
// - Zero new deps.
import { BadRequestException, ConflictException } from '@nestjs/common';
import { canClaim } from '@repo/shared';

export function assertClaimable(gift: { status: string; expiresAt: number; claimCode: string }, now = Date.now()): void {
  if (gift.status === 'CLAIMED') {
    throw new ConflictException('ของขวัญชิ้นนี้ถูกรับไปแล้ว');
  }
  if (!canClaim(gift, now)) {
    throw new BadRequestException('ของขวัญหมดอายุหรือไม่พร้อมรับ');
  }
}

export function assertBindable(status: string): void {
  if (status !== 'PENDING_PAYMENT') {
    throw new BadRequestException(`Gift in status ${status} cannot bind payment`);
  }
}
