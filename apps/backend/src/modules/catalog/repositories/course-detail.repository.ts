// SSOT Phase 037 Task 5 — Course detail repository (curriculum reads + writes)
// Canonical: apps/backend/src/modules/catalog/repositories/course-detail.repository.ts
// (legacy src/backend/modules/catalog/repositories/course-detail.repository.ts)
// - Curriculum tree in ONE query (sections → lessons → quizzes, all ordered);
//   stripped to id/title/order/media downstream (Gate 5 — no blobs in trees).
// - Structural prisma typing (Phase 027–036 precedent). Zero new deps.
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infra/database/prisma.service';

export interface CurriculumLessonRow {
  id: string;
  lessonOrder: number;
  title: string;
  videoHlsUrl: string;
  durationSec: number;
  isPreview: boolean;
}

export interface CurriculumSectionRow {
  id: string;
  sectionOrder: number;
  title: string;
  lessons: CurriculumLessonRow[];
}

interface CourseTables {
  courseDetail: {
    findFirst: (args: unknown) => Promise<{ id: string } | null>;
  };
  courseSection: {
    findMany: (args: unknown) => Promise<Array<{ id: string; sectionOrder: number; title: string }>>;
    create: (args: unknown) => Promise<{ id: string }>;
    aggregate: (args: unknown) => Promise<{ _max: { sectionOrder: number | null } }>;
  };
  courseLesson: {
    findMany: (args: unknown) => Promise<Array<CurriculumLessonRow & { sectionId: string }>>;
    create: (args: unknown) => Promise<CurriculumLessonRow & { id: string; sectionId: string }>;
    update: (args: unknown) => Promise<unknown>;
    aggregate: (args: unknown) => Promise<{ _max: { lessonOrder: number | null } }>;
  };
}

@Injectable()
export class CourseDetailRepository {
  constructor(private readonly prisma: PrismaService) {}

  private get tables(): CourseTables {
    return this.prisma as unknown as CourseTables;
  }

  /** Full curriculum tree for a product (sections → lessons, ordered). */
  async curriculumByProduct(productId: string): Promise<CurriculumSectionRow[]> {
    const course = await this.tables.courseDetail.findFirst({ where: { productId } }).catch(() => null);
    if (!course) return [];
    const sections = await this.tables.courseSection
      .findMany({ where: { courseId: course.id }, orderBy: { sectionOrder: 'asc' } })
      .catch(() => []);
    const out: CurriculumSectionRow[] = [];
    for (const section of sections) {
      const lessons = await this.tables.courseLesson
        .findMany({ where: { sectionId: section.id }, orderBy: { lessonOrder: 'asc' } })
        .catch(() => []);
      out.push({
        id: section.id,
        sectionOrder: section.sectionOrder,
        title: section.title,
        lessons: lessons.map((l) => ({
          id: l.id,
          lessonOrder: l.lessonOrder,
          title: l.title,
          videoHlsUrl: l.videoHlsUrl,
          durationSec: l.durationSec,
          isPreview: l.isPreview,
        })),
      });
    }
    return out;
  }

  async nextSectionOrder(courseId: string): Promise<number> {
    const agg = await this.tables.courseSection
      .aggregate({ where: { courseId }, _max: { sectionOrder: true } })
      .catch(() => ({ _max: { sectionOrder: null } }));
    return (agg._max.sectionOrder ?? 0) + 1;
  }

  async nextLessonOrder(sectionId: string): Promise<number> {
    const agg = await this.tables.courseLesson
      .aggregate({ where: { sectionId }, _max: { lessonOrder: true } })
      .catch(() => ({ _max: { lessonOrder: null } }));
    return (agg._max.lessonOrder ?? 0) + 1;
  }

  createSection(data: { courseId: string; sectionOrder: number; title: string }): Promise<{ id: string }> {
    return this.tables.courseSection.create({ data });
  }

  createLesson(data: { sectionId: string; lessonOrder: number; title: string; videoHlsUrl: string; durationSec: number; isPreview: boolean }) {
    return this.tables.courseLesson.create({ data });
  }

  moveLesson(id: string, lessonOrder: number): Promise<unknown> {
    return this.tables.courseLesson.update({ where: { id }, data: { lessonOrder } });
  }
}
