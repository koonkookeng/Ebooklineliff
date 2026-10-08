// SSOT Phase 078 §5.1 — Course studio repository port
// Canonical: apps/backend/src/modules/course-studio/domain/repositories/course-studio.repository.interface.ts
// - Port consumed by services (DB-free contract tests); structural Prisma
//   implementation lives in infrastructure/repositories/.
// - Zero new deps.
export interface StudioCourseRow {
  courseId: string;
  sellerId: string | null;
  tenantId: string | null;
}

export interface StudioStructureRow {
  sections: Array<{
    id: string;
    courseId: string;
    sectionOrder: number;
    title: string;
    lessons: Array<{
      id: string;
      sectionId: string;
      lessonOrder: number;
      title: string;
      videoHlsUrl: string | null;
      durationSec: number;
      isPreview: boolean;
      transcodeStatus: string;
    }>;
  }>;
}

export interface CourseStudioRepository {
  /** Tx-bound view — reorders stay inside one atomic transaction. */
  withTx?(tx: unknown): CourseStudioRepository;
  findCourse(courseId: string): Promise<StudioCourseRow | null>;
  findLessonOwner(lessonId: string): Promise<{ courseId: string; sellerId: string | null; tenantId: string | null } | null>;
  loadStructure(courseId: string): Promise<StudioStructureRow>;
  applySectionOrder(sectionId: string, sectionOrder: number): Promise<void>;
  applyLessonOrder(lessonId: string, sectionId: string, lessonOrder: number): Promise<void>;
  transcodeOf(lessonId: string): Promise<string | null>;
  markTranscoding(lessonId: string, rawStorageKey: string): Promise<void>;
  applyHlsCompletion(lessonId: string, videoHlsUrl: string, durationSec: number): Promise<void>;
  markTranscodeFailed(lessonId: string, errorMessage: string): Promise<void>;
  saveQuiz(args: {
    id: string | undefined;
    lessonId: string;
    question: string;
    explanation: string | undefined;
    points: number;
    options: Array<{ id: string; optionText: string; isCorrect: boolean }>;
  }): Promise<{ id: string }>;
  deleteQuiz(quizId: string): Promise<void>;
  findQuizOwner(quizId: string): Promise<{ courseId: string; sellerId: string | null; tenantId: string | null } | null>;
}
