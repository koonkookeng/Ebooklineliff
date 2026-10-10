// SSOT Phase 113 §3.1 — dispute transport DTOs (thin; Zod owns validation)
// Canonical: apps/backend/src/modules/dispute/dto/create-dispute.dto.ts
// - Zero new deps.
export interface CreateDisputeDto {
  orderId: string;
  reason: 'PHYSICAL_ITEM_DAMAGED' | 'PHYSICAL_ITEM_NOT_RECEIVED' | 'WRONG_ITEM_SENT' | 'EBOOK_FILE_CORRUPTED' | 'COURSE_CONTENT_MISMATCH' | 'DUPLICATE_PAYMENT' | 'OTHER';
  description: string;
  evidenceImageUrls: string[];
  requestedRefundAmount: number;
}
