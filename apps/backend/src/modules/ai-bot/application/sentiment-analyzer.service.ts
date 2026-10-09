// SSOT Phase 103 §7.1 — Sentiment Analyzer (deterministic, no LLM deps)
// Canonical: apps/backend/src/modules/ai-bot/application/sentiment-analyzer.service.ts
// - Thai/English keyword heuristic + punctuation/exclamation scoring.
//   Returns 'positive' | 'negative' | 'neutral'. Zero new deps.
import { Injectable } from '@nestjs/common';

export type Sentiment = 'positive' | 'negative' | 'neutral';

const NEGATIVE_KEYWORDS = [
  // Thai
  'ไม่ได้', 'ล้มเหลว', 'ผิดพลาด', 'แย่', 'ช้า', 'ค้าง', 'ล่ม', 'บั๊ก', 'อะไรก็ไม่ได้',
  'หงุดหงิด', 'โกรธ', 'ผิดหวัง', 'แจ้งเตือน', 'เตือน', 'ปัญหา', 'คำร้อง',
  // English
  'fail', 'error', 'bug', 'slow', 'crash', 'broken', 'wrong', 'bad',
  'angry', 'frustrated', 'disappointed', 'complaint', 'refund',
];

const POSITIVE_KEYWORDS = [
  // Thai (multi-char only — bare 'ดี' matches 'สวัสดี' false-positive)
  'ขอบคุณ', 'ดีมาก', 'ดีเยี่ยม', 'ดีที่สุด', 'เยี่ยม', 'รวดเร็ว', 'ได้แล้ว', 'แก้แล้ว', 'พอใจ',
  'เก่ง', 'ประทับใจ', 'ช่วยได้', 'เข้าใจ',
  // English
  'thanks', 'thank you', 'good', 'great', 'fast', 'fixed', 'works',
  'happy', 'satisfied', 'helpful', 'awesome',
];

const NEGATIVE_PUNCTUATION = ['!!', '??', '!?', '?!'];
const POSITIVE_PUNCTUATION: string[] = ['...'];

@Injectable()
export class SentimentAnalyzerService {
  analyze(text: string): Sentiment {
    const lower = text.toLowerCase();
    let score = 0;

    // Keyword scoring
    for (const kw of NEGATIVE_KEYWORDS) {
      if (lower.includes(kw)) score -= 2;
    }
    for (const kw of POSITIVE_KEYWORDS) {
      if (lower.includes(kw)) score += 1;
    }

    // Punctuation scoring
    for (const p of NEGATIVE_PUNCTUATION) {
      if (text.includes(p)) score -= 1;
    }
    for (const p of POSITIVE_PUNCTUATION) {
      if (text.includes(p)) score += 0.5;
    }

    // Exclamation/Question marks in Thai context
    const thaiExclaim = (text.match(/[!！]/g) || []).length;
    score -= thaiExclaim * 0.5;

    if (score <= -2) return 'negative';
    if (score >= 1) return 'positive';
    return 'neutral';
  }
}