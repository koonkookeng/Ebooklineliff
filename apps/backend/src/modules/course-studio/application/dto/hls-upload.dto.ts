// SSOT Phase 078 §5.1 — HLS upload DTO (Zod-gated at the service)
// Canonical: apps/backend/src/modules/course-studio/application/dto/hls-upload.dto.ts
// - Thin transport type; validation lives in course-studio-contract.ts.
// - Zero new deps.
export interface HlsUploadDto {
  lessonId: string;
  fileName: string;
  fileSizeBytes: number;
  contentType: string;
}
