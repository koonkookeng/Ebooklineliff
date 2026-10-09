// SSOT Phase 094 §5.1 — LLM orchestrator adapter (outline chain + fallback)
// Canonical: apps/backend/src/modules/ai-copilot/adapters/llm-orchestrator.adapter.ts
// - Deterministic template outline engine (zero new deps, <30s) with an
//   LlmPort seam for managed models (Claude/GPT-4 per spec §10 fallback).
// - Pure outline builder is exported for tests.
import { Injectable } from '@nestjs/common';
import type { OutlineSection } from '@repo/shared';

export interface OutlineLlmPort {
  completeOutline(args: { topic: string; targetAudience: string; difficultyLevel: string; numberOfSections: number }): Promise<OutlineSection[]>;
}

const LESSON_SLOTS = ['พื้นฐานและคำศัพท์สำคัญ', 'แนวคิดหลักและตัวอย่าง', 'เวิร์กช็อปลงมือทำ', 'กรณีศึกษาและข้อผิดพลาดที่พบบ่อย', 'สรุปและแบบทดสอบท้ายบท'];

export function templateOutline(topic: string, targetAudience: string, difficultyLevel: string, numberOfSections: number): OutlineSection[] {
  const out: OutlineSection[] = [];
  for (let s = 0; s < numberOfSections; s++) {
    const lessons = LESSON_SLOTS.slice(0, 3).map((slot, i) => ({
      lessonTitle: `${topic} บทที่ ${s + 1}.${i + 1}: ${slot}`,
      outcome: `ผู้เรียนกลุ่ม${targetAudience}ระดับ${difficultyLevel}สามารถอธิบาย${slot}ได้`,
    }));
    out.push({ sectionTitle: `ส่วนที่ ${s + 1}: ${topic} — ภาพรวมขั้น${difficultyLevel}`, lessons });
  }
  return out;
}

@Injectable()
export class DeterministicOutlineAdapter implements OutlineLlmPort {
  async completeOutline(args: { topic: string; targetAudience: string; difficultyLevel: string; numberOfSections: number }): Promise<OutlineSection[]> {
    try {
      return templateOutline(args.topic, args.targetAudience, args.difficultyLevel, args.numberOfSections);
    } catch {
      return templateOutline('เนื้อหาทั่วไป', 'ทั่วไป', 'BEGINNER', 1);
    }
  }
}
