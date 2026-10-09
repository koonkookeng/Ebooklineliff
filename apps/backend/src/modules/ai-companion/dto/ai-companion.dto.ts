// SSOT Phase 092 §5.1 — AI companion DTOs (legacy path re-exports SSOT)
// Canonical: apps/backend/src/modules/ai-companion/dto/ai-companion.dto.ts
// - Single source stays in @repo/shared; this file only re-exports.
export {
  AiContextSourceEnum,
  AiSummaryRequestSchema,
  AiChatQuerySchema,
  AiChatResponseSchema,
  AdaptiveQuizSchema,
  QuizLevelEnum,
} from '@repo/shared';
