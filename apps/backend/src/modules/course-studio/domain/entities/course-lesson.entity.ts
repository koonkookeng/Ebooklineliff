// SSOT Phase 078 §5 — Course lesson entity (HLS lifecycle)
// Canonical: apps/backend/src/modules/course-studio/domain/entities/course-lesson.entity.ts
// - Guards: transcode transitions move forward only; webhook completion
//   requires the playlist URL + non-negative duration.
// - Zero new deps.
import { BadRequestException } from '@nestjs/common';

const TRANSCODE_FLOW = ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'] as const;

export function assertTranscodeTransition(from: string, to: string): void {
  if (to === 'FAILED') return;
  const a = (TRANSCODE_FLOW as readonly string[]).indexOf(from);
  const b = (TRANSCODE_FLOW as readonly string[]).indexOf(to);
  if (a === -1 || b === -1 || b < a) {
    throw new BadRequestException(`Illegal transcode transition ${from} -> ${to}`);
  }
}

export function assertHlsCompletion(videoHlsUrl: string | undefined, durationSec: number | undefined): void {
  if (!videoHlsUrl) throw new BadRequestException('COMPLETED webhook requires videoHlsUrl');
  if (durationSec === undefined || durationSec < 0) {
    throw new BadRequestException('COMPLETED webhook requires durationSec >= 0');
  }
}
