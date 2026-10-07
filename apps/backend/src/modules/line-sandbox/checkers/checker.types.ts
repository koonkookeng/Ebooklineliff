// SSOT Phase 035 §5.1 — Sandbox checker shared types (pure, framework-free)
// Canonical: apps/backend/src/modules/line-sandbox/checkers/checker.types.ts
// (legacy src/backend/modules/line-sandbox/checkers/checker.types.ts)
// - Every checker is a pure function of SandboxSignals → CheckerResult[]
//   (deterministic, unit-tested without Nest; the runner only measures time).
// - Zero new deps.
import type { LineReviewCategory, SandboxSignals } from '@repo/shared';

export interface CheckerResult {
  category: LineReviewCategory;
  checkPointName: string;
  isPassed: boolean;
  memoryUsageMB: number;
  diagnosticMessage?: string;
}

export type SandboxChecker = (signals: SandboxSignals) => CheckerResult[];
