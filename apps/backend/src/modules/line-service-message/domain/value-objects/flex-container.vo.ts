// SSOT Phase 024 — Value object: Flex container guard (structure + R2 asset budget)
// Canonical: apps/backend/src/modules/line-service-message/domain/value-objects/flex-container.vo.ts
// - Rejects non-bubble/carousel roots and oversized image URLs stay flagged for the
//   caller (images must be R2-hosted WebP/PNG ≤500KB, §2.1 constraint).
// - Pure function: no I/O, fully unit-testable.
import { z } from 'zod';
import { FLEX_IMAGE_MAX_BYTES } from '@repo/shared';

const FlexContainerSchema = z.object({
  type: z.enum(['bubble', 'carousel']),
  body: z.record(z.string(), z.unknown()).optional(),
  header: z.record(z.string(), z.unknown()).optional(),
  hero: z.record(z.string(), z.unknown()).optional(),
  footer: z.record(z.string(), z.unknown()).optional(),
});

export type FlexContainer = z.infer<typeof FlexContainerSchema>;

export interface FlexGuardResult {
  ok: boolean;
  errors: string[];
  oversizedImages: string[];
  container: FlexContainer | null;
}

function collectStrings(node: unknown, out: string[]): void {
  if (typeof node === 'string') {
    out.push(node);
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) collectStrings(item, out);
    return;
  }
  if (node && typeof node === 'object') {
    for (const value of Object.values(node as Record<string, unknown>)) collectStrings(value, out);
  }
}

export function guardFlexContainer(templateJson: unknown): FlexGuardResult {
  const parsed = FlexContainerSchema.safeParse(templateJson);
  if (!parsed.success) {
    return { ok: false, errors: ['Flex root must be a bubble or carousel container'], oversizedImages: [], container: null };
  }
  // Heuristic size audit: flag http(s) image URLs carrying an explicit byte hint
  // (?bytes=N) above budget so callers compress before LINE delivery.
  const strings: string[] = [];
  collectStrings(templateJson, strings);
  const oversizedImages = strings.filter((s) => {
    const match = /^https?:\S+[?&]bytes=(\d+)\S*$/.exec(s);
    return match ? Number(match[1]) > FLEX_IMAGE_MAX_BYTES : false;
  });
  return { ok: true, errors: [], oversizedImages, container: parsed.data };
}
