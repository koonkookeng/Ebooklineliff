// SSOT Phase 065 Task 6 — Note AI summarizer (deterministic extractive)
// Canonical: apps/backend/src/modules/note/services/note-ai-summarizer.service.ts
// (legacy src/backend/modules/note/services/note-ai-summarizer.service.ts)
// - RISK_CALL deviation: no external LLM call (zero-new-dep LIFF policy +
//   <100ms budget). Deterministic extractive summary: keyword-density ranked
//   sentences → key takeaways; action-keyword sentences → action items.
//   An async LLM adapter seam (summarizeViaLlm) is kept for future wiring.
// - Pure + tsx-safe. Zero new deps.
import { Injectable } from '@nestjs/common';
import type { AiNoteSummary } from '@repo/shared';

const ACTION_HINTS = ['ควร', 'ต้อง', 'ทำ', 'ฝึก', 'ทบทวน', 'จำ', 'ลอง', 'สร้าง', 'ตรวจสอบ', 'should', 'must', 'todo', 'try'];

function sentencesOf(text: string): string[] {
  return text
    .split(/(?<=[.!?।…])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 1)
    .slice(0, 60);
}

function termFreq(sentences: string[]): Map<string, number> {
  const freq = new Map<string, number>();
  for (const s of sentences) {
    for (const w of s.split(/\s+/).filter((w) => w.length > 2)) {
      const k = w.toLowerCase();
      freq.set(k, (freq.get(k) ?? 0) + 1);
    }
  }
  return freq;
}

@Injectable()
export class NoteAiSummarizerService {
  summarize(contents: string[]): AiNoteSummary {
    const sentences = contents.flatMap(sentencesOf);
    if (sentences.length === 0) {
      return { summaryText: 'ยังไม่มีโน้ตให้สรุป', keyTakeaways: [], suggestedActionItems: [] };
    }
    const freq = termFreq(sentences);
    const scored = sentences.map((s) => ({
      s,
      score: s.split(/\s+/).reduce((acc, w) => acc + (freq.get(w.toLowerCase()) ?? 0), 0) / Math.max(1, s.split(/\s+/).length),
    }));
    scored.sort((a, b) => b.score - a.score);
    const keyTakeaways = scored.slice(0, 3).map((x) => x.s.slice(0, 200));
    const summaryText = keyTakeaways.join(' ').slice(0, 500) || sentences[0].slice(0, 200);
    const suggestedActionItems = sentences
      .filter((s) => ACTION_HINTS.some((h) => s.includes(h)))
      .slice(0, 3)
      .map((s) => s.slice(0, 200));
    return { summaryText, keyTakeaways, suggestedActionItems };
  }

  /** Future seam: swap body with an LLM call; contract stays identical. */
  async summarizeViaLlm(contents: string[]): Promise<AiNoteSummary> {
    return this.summarize(contents);
  }
}
