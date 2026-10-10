// SSOT Phase 112 §3.1 — moderation transport DTOs (thin; Zod owns validation)
// Canonical: apps/backend/src/modules/moderation/dto/moderation-request.dto.ts
// - Zero new deps.
export interface ModerationRequestDto {
  productId: string;
  contentType: 'EBOOK' | 'COURSE_VIDEO' | 'PHYSICAL_COVER' | 'BANNER_IMAGE';
  frameManifest?: Array<{ key: string; nsfwScore?: number }>;
  binaryDigests?: Array<{ digest: string; location: string }>;
}

export interface ModerationRescanDto {
  productId: string;
}
