// SSOT Phase 095 §5.1 — Social note entity guards (bounds + privacy rules)
// Canonical: apps/backend/src/modules/social-reading/domain/social-note.entity.ts
// - STUDY_GROUP notes require a studyGroupId; AUTHOR_OFFICIAL is reserved
//   for verified creators (enforced upstream by role check).
// - Zero new deps.
import { BadRequestException } from '@nestjs/common';

export function assertNoteCreatable(input: {
  positionX: number;
  positionY: number;
  content: string;
  visibility: string;
  studyGroupId?: string;
}): void {
  if (input.positionX < 0 || input.positionX > 100 || input.positionY < 0 || input.positionY > 100) {
    throw new BadRequestException('Note position out of canvas bounds');
  }
  if (input.content.trim().length === 0 || input.content.length > 1000) {
    throw new BadRequestException('Note content must be 1-1000 chars');
  }
  if (input.visibility === 'STUDY_GROUP' && !input.studyGroupId) {
    throw new BadRequestException('STUDY_GROUP notes require studyGroupId');
  }
}
