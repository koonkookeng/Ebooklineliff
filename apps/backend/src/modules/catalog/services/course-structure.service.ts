// SSOT Phase 037 Task 5/§5.2 — Course structure service (lesson ordering engine)
// Canonical: apps/backend/src/modules/catalog/services/course-structure.service.ts
// (legacy src/backend/modules/catalog/services/course-structure.service.ts)
// - createLesson (§5.2 verbatim): section must exist → order = count + 1.
// - reorderLessons: atomic multi-update (Gate 7 — no half-reordered sections);
//   duplicate/missing orders rejected before touching the DB.
// - curriculumByProduct: ordered tree + rolled-up totalHours (Gate 5 —
//   stripped rows, no transcripts/blobs).
// - Zero new deps.
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../infra/database/prisma.service';
import { CreateCourseLessonSchema, totalHoursOf, type CreateCourseLesson } from '@repo/shared';
import { CourseDetailRepository } from '../repositories/course-detail.repository';

@Injectable()
export class CourseStructureService {
  constructor(
    private readonly repo: CourseDetailRepository,
    private readonly prisma: PrismaService,
  ) {}

  async createLesson(body: unknown) {
    const parsed = CreateCourseLessonSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid lesson input');
    const input: CreateCourseLesson = parsed.data;
    const lessonOrder = await this.repo.nextLessonOrder(input.sectionId);
    try {
      return await this.repo.createLesson({ ...input, lessonOrder });
    } catch (err) {
      if (typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002') {
        throw new ConflictException('Lesson order taken — retry append');
      }
      if (typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2003') {
        throw new NotFoundException('Course Section not found');
      }
      throw err;
    }
  }

  async reorderLessons(sectionId: string, orders: unknown) {
    if (!sectionId) throw new BadRequestException('Missing section id');
    if (!Array.isArray(orders) || orders.length === 0) throw new BadRequestException('Invalid reorder payload');
    const pairs = orders.map((o) => {
      const row = o as { id?: unknown; newOrder?: unknown };
      if (typeof row.id !== 'string' || !row.id || !Number.isInteger(row.newOrder) || (row.newOrder as number) <= 0) {
        throw new BadRequestException('Invalid reorder entry');
      }
      return { id: row.id, newOrder: row.newOrder as number };
    });
    const ids = new Set(pairs.map((p) => p.id));
    const ranks = new Set(pairs.map((p) => p.newOrder));
    if (ids.size !== pairs.length || ranks.size !== pairs.length) {
      throw new BadRequestException('Duplicate lesson id or order');
    }
    // Ownership gate: every lesson must belong to the target section.
    const owned = await (this.prisma as unknown as {
      courseLesson: { findMany: (a: unknown) => Promise<Array<{ id: string }>> };
    }).courseLesson.findMany({ where: { sectionId } }).catch(() => []);
    const ownedIds = new Set(owned.map((l) => l.id));
    if (!pairs.every((p) => ownedIds.has(p.id))) {
      throw new BadRequestException('Lesson does not belong to section');
    }
    return (this.prisma as unknown as { $transaction: (ops: unknown[]) => Promise<unknown> }).$transaction(
      pairs.map(({ id, newOrder }) =>
        (this.prisma as unknown as { courseLesson: { update: (a: unknown) => unknown } }).courseLesson.update({
          where: { id },
          data: { lessonOrder: newOrder },
        }),
      ),
    );
  }

  async curriculumByProduct(productId: string) {
    if (!productId) throw new BadRequestException('Missing product id');
    const sections = await this.repo.curriculumByProduct(productId);
    const durations = sections.flatMap((s) => s.lessons.map((l) => l.durationSec));
    return { productId, totalHours: totalHoursOf(durations), sections };
  }
}
