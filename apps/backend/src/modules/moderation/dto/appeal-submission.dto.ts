// SSOT Phase 112 §3.1 — appeal transport DTOs (thin; Zod owns validation)
// Canonical: apps/backend/src/modules/moderation/dto/appeal-submission.dto.ts
// - Zero new deps.
export interface AppealSubmissionDto {
  productId: string;
  appealReason: string;
  proofDocumentUrls: string[];
}

export interface AppealDecisionDto {
  productId: string;
  approve: boolean;
  adminNotes: string;
}
