// SSOT Phase 094 §5.1 — Whisper STT adapter (port + deterministic local engine)
// Canonical: apps/backend/src/modules/ai-copilot/adapters/openai-whisper.adapter.ts
// - RISK_CALL: ships a deterministic local adapter (word-timed cue slicing,
//   zero new deps, offline). Whisper-compatible seam via SttPort — swap to
//   the Whisper API without touching callers (spec §5.1 adapter intent).
// - Pure cue slicer is exported for tests.
import { Injectable } from '@nestjs/common';

export interface RawSttSegment {
  startTimeSec: number;
  endTimeSec: number;
  text: string;
}

export interface SttPort {
  transcribe(args: { transcriptText: string; durationSec: number; language: string }): Promise<RawSttSegment[]>;
}

/** Slice a transcript into ~6s word-boundary cues (deterministic). */
export function sliceTranscript(transcript: string, durationSec: number, cueSec = 6): RawSttSegment[] {
  const words = transcript.split(/\s+/).filter(Boolean);
  if (words.length === 0 || durationSec <= 0) return [];
  const perWord = durationSec / words.length;
  const perCue = Math.max(1, Math.round(cueSec / Math.max(0.01, perWord)));
  const out: RawSttSegment[] = [];
  for (let i = 0; i < words.length; i += perCue) {
    const slice = words.slice(i, i + perCue);
    out.push({
      startTimeSec: Math.round(i * perWord * 100) / 100,
      endTimeSec: Math.round(Math.min(durationSec, (i + slice.length) * perWord) * 100) / 100,
      text: slice.join(' '),
    });
  }
  return out;
}

@Injectable()
export class DeterministicSttAdapter implements SttPort {
  async transcribe(args: { transcriptText: string; durationSec: number; language: string }): Promise<RawSttSegment[]> {
    void args.language;
    return sliceTranscript(args.transcriptText, args.durationSec);
  }
}
