// SSOT Phase 054 §3.1 — video resume + throttled progress contracts
// Canonical: packages/shared/src/schemas/zod-stream.ts
// (legacy src/shared/schemas/zod-stream.ts)
// - SyncLessonProgressInputSchema is spec-verbatim (§3.1). LessonStreamPayload
//   / ProgressSyncResponse shapes are owned by stream-contract.ts (Phase 045,
//   no redefinition — zero redundancy); this file adds the resume-toast
//   policy + MM:SS helpers shared by the LIFF player and the web player.
// - Budgets: toast render <300ms, sync every 5s, auto-dismiss 10s,
//   resume window (>10s and <95%), toast RAM <500KB (DOM-only, no media).
import { z } from 'zod';

export const SyncLessonProgressInputSchema = z.object({
  lessonId: z.string().uuid({ message: 'Invalid Lesson UUID' }),
  watchedSec: z.number().int().nonnegative({ message: 'Watched seconds must be >= 0' }),
  isCompleted: z.boolean().default(false),
});

export type SyncLessonProgressInput = z.infer<typeof SyncLessonProgressInputSchema>;

// ---------- §2.2/§10 resume-toast policy (single source) ----------
/** Show the toast only for genuine mid-lesson progress (BDD Scenario 1). */
export const RESUME_MIN_SEC = 10;
/** Past 95% completion counts as finished → restart from 00:00 (§10 edge). */
export const RESUME_MAX_COMPLETION_RATIO = 0.95;
/** Toast auto-dismiss countdown (§2.2 SUCCESS). */
export const RESUME_TOAST_AUTO_DISMISS_SEC = 10;
/** Toast must paint within 300ms of metadata load (§1.1 SLA). */
export const RESUME_TOAST_RENDER_BUDGET_MS = 300;
/** Throttled persistence cadence (§1.3 Scenario 4). */
export const RESUME_SYNC_EVERY_SEC = 5;

/** BDD Scenario 1 + §10 edge: saved > 10s and < 95% of duration. */
export function shouldShowResumeToast(lastWatchedSec: number, durationSec: number): boolean {
  if (!Number.isFinite(lastWatchedSec) || !Number.isFinite(durationSec)) return false;
  if (durationSec <= 0 || lastWatchedSec <= RESUME_MIN_SEC) return false;
  return lastWatchedSec < durationSec * RESUME_MAX_COMPLETION_RATIO;
}

/** Format seconds as MM:SS for the toast label (02:25). */
export function formatResumeMMSS(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  return `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;
}
