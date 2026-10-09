// SSOT Phase 093 Task 9 — IRT engine (injectable pure-math facade)
// Canonical: apps/backend/src/modules/adaptive-testing/application/services/irt-engine.service.ts
// - Thin @Injectable over the SSOT pure helpers (Single Source §9 — the
//   math lives in @repo/shared, this facade only shapes service calls).
// - Zero new deps.
import { Injectable } from '@nestjs/common';
import {
  irtInformation,
  irtProbability,
  masteryPercent,
  selectNextItem,
  thetaStandardError,
  thetaStep,
  type ItemParams,
} from '@repo/shared';

@Injectable()
export class IrtEngineService {
  probability(theta: number, item: ItemParams): number {
    return irtProbability(theta, item);
  }

  information(theta: number, item: ItemParams): number {
    return irtInformation(theta, item);
  }

  step(theta: number, item: ItemParams, isCorrect: boolean): number {
    return thetaStep(theta, item, isCorrect);
  }

  standardError(answered: ItemParams[], theta: number): number {
    const total = answered.reduce((n, item) => n + irtInformation(theta, item), 0);
    return thetaStandardError(total);
  }

  mastery(theta: number): number {
    return masteryPercent(theta);
  }

  next<T extends ItemParams & { id: string }>(theta: number, items: T[], answeredIds: string[]): T | null {
    return selectNextItem(theta, items, answeredIds);
  }
}
