// SSOT Phase 102 Task 6 — VOD summary baseline (deterministic, no LLM)
// Canonical: apps/backend/src/modules/stream/application/vod-summary.service.ts
// - RISK_CALL: full Whisper/Gemini transcription needs external creds —
//   this deterministic baseline (duration-aware chapter framing from lesson
//   metadata) ships the aiSummaryText contract today; the 094 AI pipeline
//   owns future enrichment. Zero new deps.
import { Injectable } from '@nestjs/common';

@Injectable()
export class VodSummaryService {
  async summarize(args: { lessonId: string; title: string; durationSec: number }): Promise<string> {
    const mins = Math.max(1, Math.round(args.durationSec / 60));
    const chapters = Math.min(8, Math.max(2, Math.round(mins / 10)));
    const lines = [
      `สรุปบทเรียน: ${args.title}`,
      `ความยาวประมาณ ${mins} นาที แบ่งเป็น ${chapters} ช่วงเนื้อหาหลัก`,
      ...Array.from({ length: chapters }, (_, i) => `ช่วงที่ ${i + 1}: เนื้อหาสำคัญและประเด็นทบทวน (${Math.round(((i + 1) / chapters) * mins)} นาที)`),
      'หมายเหตุ: บทสรุปอัตโนมัติฉบับร่าง — รอการถอดเสียงฉบับเต็มจาก AI pipeline',
    ];
    return lines.join('\n');
  }
}
