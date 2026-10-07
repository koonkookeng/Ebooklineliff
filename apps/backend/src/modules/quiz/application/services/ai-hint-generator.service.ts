// SSOT Phase 047 Task 3/7 — AiHintGeneratorService (escalating hints, no LLM dep)
// Canonical: apps/backend/src/modules/quiz/application/services/ai-hint-generator.service.ts
// (legacy src/backend/modules/quiz/application/services/ai-hint-generator.service.ts)
// - Rule-based adaptive feedback (§7.2 without an LLM dependency):
//   attempt 1 → explanationHint; ≥2 → hint + metaphor scaffold referencing
//   the aiPromptContext; never reveals option text or correctness.
// - Pure + tsx-safe. Zero new deps.
import { Injectable } from '@nestjs/common';

const METAPHORS = [
  'ลองนึกภาพเนื้อหาเป็นแผนที่ — ย้อนกลับไปดูป้ายบอกทางในนาทีที่ผ่านมา',
  'ทบทวนเหมือนครูซ้ำให้ฟังอีกครั้ง: ประเด็นหลักมักอยู่ในประโยคแรกของช่วงนั้น',
  'ตัดตัวเลือกที่ขัดกับสิ่งที่วิดีโอเพิ่งสาธิตออกก่อน แล้วค่อยเลือกใหม่',
];

export function composeHint(explanationHint: string | null, aiPromptContext: string | null, attemptNumber: number): string {
  const base = explanationHint?.trim() || 'ทบทวนเนื้อหาในนาทีที่ผ่านมาก่อนตอบอีกครั้ง';
  if (attemptNumber < 2) return base;
  const metaphor = METAPHORS[(attemptNumber - 2) % METAPHORS.length];
  const context = aiPromptContext?.trim();
  return `${base} ${metaphor}${context ? ` (โฟกัส: ${context.slice(0, 120)})` : ''}`;
}

@Injectable()
export class AiHintGeneratorService {
  hintFor(explanationHint: string | null, aiPromptContext: string | null, attemptNumber: number): string {
    return composeHint(explanationHint, aiPromptContext, attemptNumber);
  }
}
