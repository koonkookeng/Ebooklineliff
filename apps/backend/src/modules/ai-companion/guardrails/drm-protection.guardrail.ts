// SSOT Phase 092 §5.1/§8 — DRM protection guardrail (pure, zero-dep)
// Canonical: apps/backend/src/modules/ai-companion/guardrails/drm-protection.guardrail.ts
// - Caps retrieved context at 3 chunks (§8), enforces the system guardrail
//   prompt, and flags answers that leak verbatim long passages.
// - Pure functions (testable without Nest). Zero new deps.

export const DRM_SYSTEM_PROMPT =
  'ห้ามพิมพ์หรือลอกเลียนเนื้อหาหนังสือเต็มเล่ม ให้ใช้ข้อมูลที่ให้ไปเพื่อวิเคราะห์ สรุป และตอบคำถามผู้เรียนเท่านั้น';

export const DRM_MAX_CHUNKS = 3;
export const DRM_MAX_VERBATIM_RUN = 300;

export function capContextChunks<T>(chunks: T[], max = DRM_MAX_CHUNKS): T[] {
  return chunks.slice(0, Math.max(0, max));
}

/** True when the answer contains a suspicious verbatim run (>300 chars of one chunk). */
export function hasVerbatimLeak(answer: string, chunks: string[]): boolean {
  const normalized = answer.replace(/\s+/g, ' ');
  return chunks.some((c) => {
    const run = c.replace(/\s+/g, ' ').slice(0, DRM_MAX_VERBATIM_RUN + 1);
    return run.length > DRM_MAX_VERBATIM_RUN && normalized.includes(run);
  });
}
