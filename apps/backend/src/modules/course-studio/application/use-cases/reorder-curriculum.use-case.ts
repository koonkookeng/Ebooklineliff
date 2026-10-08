// SSOT Phase 078 §5.1 — Reorder curriculum use-case (intent entry)
// Canonical: apps/backend/src/modules/course-studio/application/use-cases/reorder-curriculum.use-case.ts
// - Intent entry point for the reorder flow; orchestration lives in
//   CurriculumBuilderService (single SSOT, Zero Redundant).
// - Zero new deps.
import { Injectable } from '@nestjs/common';
import { CurriculumBuilderService } from '../services/curriculum-builder.service';

@Injectable()
export class ReorderCurriculumUseCase {
  constructor(private readonly curriculum: CurriculumBuilderService) {}

  execute(
    headerTenantId: string | undefined,
    actor: { userId: string; role: string | undefined },
    body: unknown,
  ): Promise<boolean> {
    return this.curriculum.reorderCurriculum(headerTenantId, actor, body);
  }
}
