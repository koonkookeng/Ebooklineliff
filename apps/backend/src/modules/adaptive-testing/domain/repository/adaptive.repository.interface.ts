// SSOT Phase 093 — Adaptive repository port (DB-free tests)
// Canonical: apps/backend/src/modules/adaptive-testing/domain/repository/adaptive.repository.interface.ts
// - Zero new deps.
export interface AdaptiveItemRow {
  id: string;
  lessonId: string;
  questionText: string;
  optionsJson: Array<{ id: string; text: string }>;
  correctOption: string;
  difficulty: number;
  discrimination: number;
  pseudoGuessing: number;
}

export interface AdaptiveProfileRow {
  userId: string;
  subjectContext: string;
  theta: number;
  standardError: number;
  totalQuestions: number;
}

export interface AdaptiveRepository {
  getItems(lessonId: string): Promise<AdaptiveItemRow[]>;
  getItem(questionId: string): Promise<AdaptiveItemRow | null>;
  getProfile(userId: string, subjectContext: string): Promise<AdaptiveProfileRow>;
  saveProfile(profile: AdaptiveProfileRow): Promise<AdaptiveProfileRow>;
  saveResponse(args: {
    userId: string;
    questionId: string;
    selectedOption: string;
    isCorrect: boolean;
    responseTimeMs: number;
    thetaAfter: number;
  }): Promise<void>;
  getAnsweredIds(userId: string, lessonId: string): Promise<string[]>;
  withTx?(tx: unknown): AdaptiveRepository;
}
