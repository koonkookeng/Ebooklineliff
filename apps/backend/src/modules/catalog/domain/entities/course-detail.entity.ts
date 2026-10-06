// SSOT Phase 008 §5.1 — Course detail entity (lesson/section ordering guards for drip content)
// Canonical: apps/backend/src/modules/catalog/domain/entities/course-detail.entity.ts
import { BadRequestException } from '@nestjs/common';

/** Section/lesson orders are 1-based and gapless per parent (stable drip sequencing). */
export function assertGaplessOrder(label: string, orders: number[]): void {
  const sorted = [...orders].sort((a, b) => a - b);
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i] !== i + 1) throw new BadRequestException(`Non-gapless ${label} order`);
  }
}
