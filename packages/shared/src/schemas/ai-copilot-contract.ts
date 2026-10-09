// SSOT Phase 094 §3.1 — AI Creator Co-Pilot contract
// Canonical: packages/shared/src/schemas/ai-copilot-contract.ts
// - Spec-verbatim: AiJobStatusEnum / CaptionLanguageEnum /
//   CourseOutlinePromptSchema / SubtitleSegmentSchema /
//   AutoCaptionJobPayloadSchema / GeneratedQuizQuestionSchema (§3.1).
// - RISK_CALL (documented): AiJobStatus uses the 4-state core lifecycle
//   (QUEUED/PROCESSING/COMPLETED/FAILED); the spec's EXTRACTING_AUDIO /
//   TRANSCRIBING / GENERATING_OUTLINE phases ride progressPercent bands
//   (0-30/30-80/80-99) instead of extra enum states — fewer states, same
//   observability. STT ships a deterministic local adapter (zero new deps;
//   Whisper-compatible seam via port). Caption languages TH/EN/ZH/JA.
// - Pure helpers: VTT/SRT build+parse, timestamp fmt, progress phase,
//   outline tree, stream. Zod only.
import { z } from 'zod';

export const AiJobTypeEnum = z.enum(['COURSE_OUTLINE_GEN', 'VIDEO_TRANSCRIBE', 'AUTO_QUIZ_GEN', 'CAPTION_TRANSLATION']);
export type AiJobType = z.infer<typeof AiJobTypeEnum>;

export const AiJobStatusEnum = z.enum(['QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED']);
export type AiJobStatus = z.infer<typeof AiJobStatusEnum>;

export const CaptionLanguageEnum = z.enum(['TH', 'EN', 'ZH', 'JA']);
export type CaptionLanguage = z.infer<typeof CaptionLanguageEnum>;

export const DifficultyLevelEnum = z.enum(['BEGINNER', 'INTERMEDIATE', 'ADVANCED']);
export type DifficultyLevel = z.infer<typeof DifficultyLevelEnum>;

export const CourseOutlinePromptSchema = z.object({
  topic: z.string().min(3).max(200),
  targetAudience: z.string().min(3).max(200),
  difficultyLevel: DifficultyLevelEnum,
  numberOfSections: z.number().int().min(1).max(20).default(5),
  sourceDocumentUrl: z.string().url().optional(),
});
export type CourseOutlinePrompt = z.infer<typeof CourseOutlinePromptSchema>;

export const SubtitleSegmentSchema = z.object({
  id: z.string().uuid(),
  startTimeSec: z.number().nonnegative(),
  endTimeSec: z.number().nonnegative(),
  text: z.string(),
  translatedText: z.record(CaptionLanguageEnum, z.string()).optional(),
});
export type SubtitleSegment = z.infer<typeof SubtitleSegmentSchema>;

export const AutoCaptionJobPayloadSchema = z.object({
  jobId: z.string().uuid(),
  lessonId: z.string().uuid(),
  status: AiJobStatusEnum,
  progressPercentage: z.number().min(0).max(100),
  vttUrl: z.string().url().optional(),
  srtUrl: z.string().url().optional(),
  errorMessage: z.string().optional(),
});
export type AutoCaptionJobPayload = z.infer<typeof AutoCaptionJobPayloadSchema>;

export const GeneratedQuizQuestionSchema = z.object({
  question: z.string(),
  options: z.array(z.string()).min(2).max(5),
  correctOptionIndex: z.number().int().min(0).max(4),
  explanation: z.string(),
});
export type GeneratedQuizQuestion = z.infer<typeof GeneratedQuizQuestionSchema>;

export const OutlineSectionSchema = z.object({
  sectionTitle: z.string(),
  lessons: z.array(z.object({ lessonTitle: z.string(), outcome: z.string() })),
});
export type OutlineSection = z.infer<typeof OutlineSectionSchema>;

/** Progress bands mapping to the spec's sub-phases (0-30 extract / 30-80 transcribe / 80-99 format). */
export function jobPhase(progressPercent: number): 'QUEUED' | 'EXTRACTING_AUDIO' | 'TRANSCRIBING' | 'FORMATTING' | 'COMPLETED' {
  if (progressPercent <= 0) return 'QUEUED';
  if (progressPercent < 30) return 'EXTRACTING_AUDIO';
  if (progressPercent < 80) return 'TRANSCRIBING';
  if (progressPercent < 100) return 'FORMATTING';
  return 'COMPLETED';
}

/** Seconds → WebVTT timestamp (HH:MM:SS.mmm). */
export function toCaptionVttTimestamp(sec: number): string {
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const secPart = s % 60;
  const whole = Math.floor(secPart);
  const ms = Math.floor((secPart - whole) * 1000);
  const pad = (n: number, l = 2): string => String(n).padStart(l, '0');
  return `${pad(h)}:${pad(m)}:${pad(whole)}.${pad(ms, 3)}`;
}

/** Seconds → SRT timestamp (HH:MM:SS,mmm). */
export function toSrtTimestamp(sec: number): string {
  return toCaptionVttTimestamp(sec).replace('.', ',');
}

/** Parse a VTT/SRT timestamp back to seconds (accepts . or ,). */
export function parseTimestamp(ts: string): number {
  const m = ts.trim().match(/(\d+):(\d{2}):(\d{2})[.,](\d{3})/);
  if (!m) return NaN;
  const [, h, min, s, ms] = m as unknown as [string, string, string, string, string];
  return Number(h) * 3600 + Number(min) * 60 + Number(s) + Number(ms) / 1000;
}

export interface CaptionCue {
  startTimeSec: number;
  endTimeSec: number;
  text: string;
}

/** Build a WebVTT document from cues. */
export function buildVtt(cues: CaptionCue[]): string {
  const body = cues
    .map((c) => `${toCaptionVttTimestamp(c.startTimeSec)} --> ${toCaptionVttTimestamp(c.endTimeSec)}\n${c.text}`)
    .join('\n\n');
  return `WEBVTT\n\n${body}${cues.length > 0 ? '\n' : ''}`;
}

/** Build an SRT document from cues. */
export function buildSrt(cues: CaptionCue[]): string {
  return cues
    .map((c, i) => `${i + 1}\n${toSrtTimestamp(c.startTimeSec)} --> ${toSrtTimestamp(c.endTimeSec)}\n${c.text}`)
    .join('\n\n')
    .concat(cues.length > 0 ? '\n' : '');
}

/** True when no two cues overlap (timestamp integrity, §10). */
export function cuesOverlap(cues: CaptionCue[]): boolean {
  const sorted = [...cues].sort((a, b) => a.startTimeSec - b.startTimeSec);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    if (prev && cur && cur.startTimeSec < prev.endTimeSec) return true;
  }
  return false;
}

/** Co-pilot event stream (Gate 8). */
export const COPILOT_STREAM = 'stream:ai:copilot';
