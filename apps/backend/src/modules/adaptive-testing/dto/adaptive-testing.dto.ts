// SSOT Phase 093 — Adaptive testing DTOs (legacy path re-exports SSOT)
// Canonical: apps/backend/src/modules/adaptive-testing/dto/adaptive-testing.dto.ts
// - Single source stays in @repo/shared; this file only re-exports.
export {
  AdaptiveSubmitAnswerSchema,
  AdaptiveNextQuestionSchema,
  ADAPTIVE_MAX_ITEMS,
  ADAPTIVE_SE_THRESHOLD,
} from '@repo/shared';
