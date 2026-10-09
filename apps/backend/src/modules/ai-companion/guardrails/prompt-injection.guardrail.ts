// SSOT Phase 092 §5.1 — Prompt-injection guardrail (pure, zero-dep)
// Canonical: apps/backend/src/modules/ai-companion/guardrails/prompt-injection.guardrail.ts
// - Detects classic injection directives (Thai + English) and strips them
//   before the question reaches retrieval/LLM.
// - Pure functions (testable without Nest). Zero new deps.

const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+)?previous\s+instructions?/i,
  /disregard\s+(all\s+)?(prior|previous|above)/i,
  /system\s*prompt/i,
  /reveal\s+(your|the)\s+(system|initial|hidden)\s+(prompt|instructions?)/i,
  /jailbreak/i,
  /do\s+anything\s+now/i,
  /ลืมคำสั่ง.*ก่อน/i,
  /เปิดเผย\s*(system|prompt|คำสั่ง)/i,
  /ข้าม\s*guardrail/i,
  /ปิด\s*ระบบ\s*ป้องกัน/i,
];

export function detectPromptInjection(question: string): boolean {
  return INJECTION_PATTERNS.some((re) => re.test(question));
}

export function sanitizeQuestion(question: string): string {
  let out = question;
  for (const re of INJECTION_PATTERNS) {
    out = out.replace(new RegExp(re.source, `${re.flags.includes('g') ? re.flags : `${re.flags}g`}`), '[redacted]');
  }
  return out.trim().slice(0, 1000);
}
