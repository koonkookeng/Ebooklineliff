// SSOT Phase 102 Task 4 — FFmpeg ladder adapter (pure planner + exec port)
// Canonical: apps/backend/src/modules/stream/infrastructure/ffmpeg-transcoder.adapter.ts
// - Pure ladder planning (1080p/720p/480p bitrates + segment math) and the
//   exec delegate port. The heavy binary runs through the injected exec
//   (043 doctrine); byte-transcode itself reuses FFmpegTranscoderService.
// - Zero new deps.
import { Injectable } from '@nestjs/common';
import { VOD_LADDER } from '@repo/shared';

export interface LadderRung {
  resolution: '1080p' | '720p' | '480p';
  width: number;
  height: number;
  videoKbps: number;
  audioKbps: number;
}

const RUNGS: LadderRung[] = [
  { resolution: '1080p', width: 1920, height: 1080, videoKbps: 4500, audioKbps: 128 },
  { resolution: '720p', width: 1280, height: 720, videoKbps: 2500, audioKbps: 128 },
  { resolution: '480p', width: 854, height: 480, videoKbps: 1200, audioKbps: 96 },
];

export interface ExecPort {
  exec(cmd: string): Promise<void>;
}

@Injectable()
export class FfmpegTranscoderAdapter {
  constructor(private readonly execPort: ExecPort = { exec: async () => undefined }) {}

  ladder(): LadderRung[] {
    return [...RUNGS].filter((r) => (VOD_LADDER as readonly string[]).includes(r.resolution));
  }

  segmentPlan(durationSec: number, segmentSec = 4): { segments: number; targetDuration: number } {
    const segments = Math.max(1, Math.ceil(Math.max(0, durationSec) / segmentSec));
    return { segments, targetDuration: segmentSec };
  }

  async probe(cmd: string): Promise<void> {
    await this.execPort.exec(cmd);
  }
}
