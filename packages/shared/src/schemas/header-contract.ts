// SSOT Phase 023 §3.1 — Dynamic Header Title Integrator Zod SSOT Contract
// Canonical: packages/shared/src/schemas/header-contract.ts
// (legacy src/shared/schemas/header-contract.ts)
// NOTE (RISK_CALL deviations, see ADR-023):
// - tenantId is z.string().min(1), not uuid: Product.tenantId/sellerId and middleware
//   tenant hints use opaque slugs ('default'), consistent with liff-auth/environment contracts.
// - displayMode mapping extends spec: LIVE_CLASS → LIVE_STREAM, other types → DEFAULT_STORE.
import { z } from 'zod';

export const HeaderDisplayModeEnum = z.enum([
  'DEFAULT_STORE',
  'EBOOK_READER',
  'ELEARNING_LESSON',
  'LIVE_STREAM',
  'CHECKOUT_FLOW',
]);

export const HeaderActionIconSchema = z.object({
  id: z.string(),
  iconName: z.string(),
  actionIntent: z.string(),
});

export const DynamicHeaderPayloadSchema = z.object({
  tenantId: z.string().min(1),
  displayMode: HeaderDisplayModeEnum,
  mainTitle: z.string().min(1).max(120),
  subtitle: z.string().max(100).optional(),
  progressPercentage: z.number().min(0).max(100).optional(),
  brandColor: z
    .string()
    .regex(/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/)
    .default('#000000'),
  logoUrl: z.string().url().optional(),
  showBackButton: z.boolean().default(true),
  backToUrl: z.string().optional(),
  actionIcons: z.array(HeaderActionIconSchema).default([]),
});

export const DynamicHeaderInputSchema = z.object({
  productId: z.string().min(1),
  chapterOrLessonId: z.string().optional(),
  customTitle: z.string().max(120).optional(),
});

export type DynamicHeaderPayload = z.infer<typeof DynamicHeaderPayloadSchema>;
export type DynamicHeaderInput = z.infer<typeof DynamicHeaderInputSchema>;
export type HeaderDisplayMode = z.infer<typeof HeaderDisplayModeEnum>;
export type HeaderActionIcon = z.infer<typeof HeaderActionIconSchema>;
