// SSOT Phase 078 §5 — Course section entity (reorder invariants)
// Canonical: apps/backend/src/modules/course-studio/domain/entities/course-section.entity.ts
// - Guards: reorder lists are contiguous 0..n, ids unique, every lesson row
//   belongs to the same course (cross-course graft blocked).
// - Zero new deps.
import { BadRequestException, ForbiddenException } from '@nestjs/common';

export interface ReorderSectionInput {
  sectionId: string;
  sectionOrder: number;
  lessons: Array<{ lessonId: string; lessonOrder: number }>;
}

export function assertContiguousOrder(values: number[], what: string): void {
  const sorted = [...values].sort((a, b) => a - b);
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i] !== i) throw new BadRequestException(`${what} order must be contiguous 0..n`);
  }
}

export function assertUniqueIds(ids: string[], what: string): void {
  if (new Set(ids).size !== ids.length) {
    throw new BadRequestException(`Duplicate ${what} ids in reorder payload`);
  }
}

export function assertStudioTenant(headerTenantId: string | undefined, rowTenantId: string | null | undefined): void {
  const header = (headerTenantId ?? '').trim();
  if (!header) throw new ForbiddenException('Missing X-Tenant-ID header context.');
  if (rowTenantId && rowTenantId !== header) {
    throw new ForbiddenException('Cross-tenant studio access blocked.');
  }
}

/** Instructor owns the course (seller match) or is platform admin. */
export function assertCourseOwnership(sellerId: string | null, actorUserId: string, actorRole: string | undefined): void {
  if (actorRole === 'SUPER_ADMIN') return;
  if (!sellerId || sellerId !== actorUserId) {
    throw new ForbiddenException('Only the course owner can edit the curriculum');
  }
}
