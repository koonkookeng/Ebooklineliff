// SSOT Phase 112 Task 3 §7 — NSFW / toxicity text classifier + frame-score seam
// Canonical: apps/backend/src/modules/moderation/services/nsfw-detector.service.ts
// (legacy src/backend/modules/moderation/.../nsfw-detector.service.ts)
// - Text lane (real, sync, <1.5s): minimal profanity/toxicity lexicon over
//   title+description with word-boundary matching; any hit scores ≥0.85 and
//   flags NUDITY_EXPLICIT-adjacent HATE_SPEECH_PROFANITY per §1.3 taxonomy.
//   The lexicon is intentionally minimal and tenant-extensible (a future
//   ModerationRuleConfig row overrides these weights — §7.2 learning loop
//   consumes admin overrules, it does not live here).
// - Vision lane (staged seam, documented RISK_CALL): no vision-model dep is
//   configured in this repo, so frame verdicts arrive as provider-scored
//   manifests from the R2 stream worker (scanFrames); the service never
//   fabricates pixel verdicts. Frames scoring ≥0.85 flag NUDITY_EXPLICIT.
// - Zero new deps.
import { Injectable } from '@nestjs/common';
import { NSFW_FLAG_THRESHOLD } from '@repo/shared';

export interface NsfwTextHit {
  term: string;
  location: string;
}

export interface NsfwScanResult {
  isFlagged: boolean;
  score: number;
  categories: Array<'NUDITY_EXPLICIT' | 'HATE_SPEECH_PROFANITY' | 'VIOLENCE_GORE' | 'SCAM_FRAUD'>;
  violatingLocations: string[];
  aiExplanation?: string;
}

/** Minimal seed lexicon (word-boundary matched, case-insensitive). */
const PROFANITY_TERMS = [
  'เหี้ย', 'สัส', 'ควย', 'หี', 'เย็ด',
  'fuck', 'shit', 'bitch', 'bastard', 'porn', 'xxx', 'nsfw',
];

const VIOLENCE_TERMS = ['ฆ่า', 'ฆาตกรรม', 'เลือดสาด', 'behead', 'gore'];

const SCAM_TERMS = ['รวยทางลัด', 'ลงทุน 100 ได้ 10000', 'โอนก่อน', 'get rich quick', 'double your money'];

export function scanTextSignals(text: string, location: string): NsfwTextHit[] {
  const hits: NsfwTextHit[] = [];
  const hay = ` ${text.toLowerCase()} `;
  const check = (terms: string[]): void => {
    for (const t of terms) {
      const needle = t.toLowerCase();
      if (/[\u0E00-\u0E7F]/.test(needle)) {
        if (hay.includes(needle)) hits.push({ term: t, location });
      } else if (new RegExp(`[^\\p{L}\\p{N}]${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^\\p{L}\\p{N}]`, 'u').test(hay)) {
        hits.push({ term: t, location });
      }
    }
  };
  check(PROFANITY_TERMS);
  check(VIOLENCE_TERMS);
  check(SCAM_TERMS);
  return hits;
}

@Injectable()
export class NsfwDetectorService {
  /** Pure text scan over title + description (sync, deterministic). */
  scanText(args: { title: string; description: string }): NsfwScanResult {
    const titleHits = scanTextSignals(args.title, 'title');
    const descHits = scanTextSignals(args.description, 'description');
    const hits = [...titleHits, ...descHits];
    if (hits.length === 0) {
      return { isFlagged: false, score: 0, categories: [], violatingLocations: [] };
    }
    const categories = new Set<NsfwScanResult['categories'][number]>();
    for (const h of hits) {
      if (VIOLENCE_TERMS.includes(h.term)) categories.add('VIOLENCE_GORE');
      else if (SCAM_TERMS.includes(h.term)) categories.add('SCAM_FRAUD');
      else categories.add('HATE_SPEECH_PROFANITY');
    }
    return {
      isFlagged: true,
      score: NSFW_FLAG_THRESHOLD,
      categories: [...categories],
      violatingLocations: [...new Set(hits.map((h) => h.location))],
      aiExplanation: `lexicon hits: ${hits.map((h) => `${h.term}@${h.location}`).join(', ')}`,
    };
  }

  /**
   * Provider-scored frame manifest from the R2 stream worker
   * ([{ key, nsfwScore }]). Any frame ≥0.85 flags NUDITY_EXPLICIT.
   */
  scanFrames(frames: Array<{ key: string; nsfwScore?: number }>): NsfwScanResult {
    const flagged = frames.filter((f) => (f.nsfwScore ?? 0) >= NSFW_FLAG_THRESHOLD);
    if (flagged.length === 0) {
      return { isFlagged: false, score: 0, categories: [], violatingLocations: [] };
    }
    return {
      isFlagged: true,
      score: Math.max(...flagged.map((f) => f.nsfwScore ?? 0)),
      categories: ['NUDITY_EXPLICIT'],
      violatingLocations: flagged.map((f) => f.key),
      aiExplanation: `${flagged.length} frame(s) above ${NSFW_FLAG_THRESHOLD}`,
    };
  }

  /** Combined product scan (text always runs; frames when manifested). */
  async scanProductContent(
    product: { title: string; description: string },
    opts?: { frames?: Array<{ key: string; nsfwScore?: number }> },
  ): Promise<NsfwScanResult> {
    const text = this.scanText(product);
    const frames = this.scanFrames(opts?.frames ?? []);
    return {
      isFlagged: text.isFlagged || frames.isFlagged,
      score: Math.max(text.score, frames.score),
      categories: [...new Set([...text.categories, ...frames.categories])],
      violatingLocations: [...text.violatingLocations, ...frames.violatingLocations],
      aiExplanation: [text.aiExplanation, frames.aiExplanation].filter(Boolean).join(' | ') || undefined,
    };
  }
}
