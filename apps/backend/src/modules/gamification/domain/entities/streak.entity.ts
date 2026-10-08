// SSOT Phase 083 §5.1 — Streak entity guards (UTC day math)
// Canonical: apps/backend/src/modules/gamification/domain/entities/streak.entity.ts
// - Server-enforced UTC day keys (§8.1 — client time is never trusted).
// - Guards: duplicate check-in (gap 0), midnight-boundary gaps.
// - Zero new deps.
import { BadRequestException, ConflictException } from '@nestjs/common';
import { dayGap } from '@repo/shared';

/** Reject a same-day repeat check-in (BDD-1 idempotency). */
export function assertNotCheckedInToday(gapDays: number): void {
  if (gapDays === 0) {
    throw new BadRequestException('คุณได้ทำการเช็กอินประจำวันเรียบร้อยแล้ว');
  }
}

/** Reject concurrent double-taps (Redis mutex lost the race). */
export function assertCheckinLock(acquired: boolean): void {
  if (!acquired) {
    throw new ConflictException('Concurrent check-in attempt detected. Please wait.');
  }
}

export { dayGap };
