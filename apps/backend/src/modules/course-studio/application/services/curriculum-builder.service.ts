// SSOT Phase 078 BDD-1/Task 3 — Curriculum reorder service (atomic)
// Canonical: apps/backend/src/modules/course-studio/application/services/curriculum-builder.service.ts
// - reorderCurriculum: Zod gate -> course ownership -> same-course check ->
//   one $transaction (sections + cross-section lesson moves) -> Redis
//   structure invalidate + studio event (Gate 7/8).
// - Port-based (repo/tx/cache/bus) for DB-free tests. Zero new deps.
import { BadRequestException, Injectable } from '@nestjs/common';
import { STUDIO_EVENT_STREAM, StudioCurriculumReorderPayloadSchema, studioStructureKey } from '@repo/shared';
import {
  assertContiguousOrder,
  assertCourseOwnership,
  assertStudioTenant,
  assertUniqueIds,
} from '../../domain/entities/course-section.entity';
import type { CourseStudioRepository } from '../../domain/repositories/course-studio.repository.interface';

export interface StudioTx {
  run<T>(fn: (tx: unknown) => Promise<T>): Promise<T>;
}

export interface StudioCache {
  del(key: string): Promise<unknown>;
}

export interface StudioBus {
  xadd(stream: string, fields: Record<string, string | number>): Promise<unknown>;
}

@Injectable()
export class CurriculumBuilderService {
  constructor(
    private readonly repo: CourseStudioRepository,
    private readonly tx: StudioTx,
    private readonly cache: StudioCache,
    private readonly bus: StudioBus,
  ) {}

  async reorderCurriculum(
    headerTenantId: string | undefined,
    actor: { userId: string; role: string | undefined },
    body: unknown,
  ): Promise<boolean> {
    const parsed = StudioCurriculumReorderPayloadSchema.safeParse({
      ...((body ?? {}) as Record<string, unknown>),
      tenantId: (headerTenantId ?? '').trim(),
    });
    if (!parsed.success) throw new BadRequestException('Invalid curriculum reorder payload');
    const { tenantId, courseId, sections } = parsed.data;

    const course = await this.repo.findCourse(courseId);
    if (!course) throw new BadRequestException('Course not found');
    assertStudioTenant(tenantId, course.tenantId);
    assertCourseOwnership(course.sellerId, actor.userId, actor.role);

    assertUniqueIds(sections.map((s) => s.sectionId), 'section');
    assertContiguousOrder(sections.map((s) => s.sectionOrder), 'section');
    const lessonIds = sections.flatMap((s) => s.lessons.map((l) => l.lessonId));
    assertUniqueIds(lessonIds, 'lesson');
    for (const s of sections) {
      assertContiguousOrder(s.lessons.map((l) => l.lessonOrder), 'lesson');
    }

    const current = await this.repo.loadStructure(courseId);
    const knownSections = new Set(current.sections.map((s) => s.id));
    const knownLessons = new Set(current.sections.flatMap((s) => s.lessons.map((l) => l.id)));
    for (const s of sections) {
      if (!knownSections.has(s.sectionId)) throw new BadRequestException(`Unknown section ${s.sectionId}`);
      for (const l of s.lessons) {
        if (!knownLessons.has(l.lessonId)) throw new BadRequestException(`Unknown lesson ${l.lessonId}`);
      }
    }

    await this.tx.run(async (tx) => {
      const repo = this.repo.withTx ? this.repo.withTx(tx) : this.repo;
      for (const s of sections) {
        await repo.applySectionOrder(s.sectionId, s.sectionOrder);
        for (const l of s.lessons) {
          await repo.applyLessonOrder(l.lessonId, s.sectionId, l.lessonOrder);
        }
      }
    });

    await this.cache.del(studioStructureKey(courseId)).catch(() => undefined);
    await this.bus.xadd(STUDIO_EVENT_STREAM, {
      event: 'studio.curriculum.reordered',
      tenantId,
      courseId,
      sections: sections.length,
      at: Date.now(),
    }).catch(() => undefined);
    return true;
  }
}
