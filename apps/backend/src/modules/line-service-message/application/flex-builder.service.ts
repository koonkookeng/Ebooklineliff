// SSOT Phase 024 §5.2 — Flex template compiler ({{var}} interpolation, zero-dep)
// Canonical: apps/backend/src/modules/line-service-message/application/flex-builder.service.ts
// - Pure string interpolation over the JSON envelope: unknown keys pass through,
//   missing params leave the placeholder (preview-safe, never throws on data gaps).
// - Sanitizes interpolated values to primitives (string/number/boolean) so objects
//   can never inject nested Flex structure (anti-spoof, §8.1 adjacent).
import { Injectable } from '@nestjs/common';
import { FlexCompileInputSchema, type FlexCompileInput } from '@repo/shared';
import { guardFlexContainer } from '../domain/value-objects/flex-container.vo';

export interface CompiledFlex {
  altText: string;
  flex: Record<string, unknown>;
  oversizedImages: string[];
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

@Injectable()
export class FlexBuilderService {
  compile(input: FlexCompileInput, altText: string): CompiledFlex {
    const parsed = FlexCompileInputSchema.safeParse(input);
    if (!parsed.success) throw new Error('Invalid flex compile input');
    const { templateJson, parameters } = parsed.data;

    let raw = JSON.stringify(templateJson);
    for (const [key, value] of Object.entries(parameters)) {
      raw = raw.replace(new RegExp(`\\{\\{${escapeRegExp(key)}\\}\\}`, 'g'), String(value));
    }
    const flex = JSON.parse(raw) as Record<string, unknown>;
    const guard = guardFlexContainer(flex);
    if (!guard.ok) throw new Error(guard.errors[0]);
    return { altText, flex, oversizedImages: guard.oversizedImages };
  }
}
