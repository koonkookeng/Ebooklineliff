// SSOT Phase 016 §3.1 — LIFF photo-picker domain contract
// Canonical: packages/shared/src/schemas/slip-picker.schema.ts
// (legacy src/shared/schemas/slip-picker.zod.ts — repo uses .schema.ts)
// Reconciled (zero-redundant): verify/provider/response shapes stay in
// slip-verification.schema.ts + payment-slip.schema.ts; no presigned-URL
// endpoint exists (server-side SigV4 upload keeps R2 secrets server-side —
// see ADR-016), so this file owns the picker source + analytics events,
// which have real producers (SlipPhotoPicker) and a real consumer
// (SlipPickerAnalyticsService → stream:analytics:payments).
import { z } from 'zod';

/** How the slip image entered the flow (spec BDD: native vs fallback). */
export const SlipPickerSourceEnum = z.enum(['liff-native', 'file-album', 'camera-capture']);
export type SlipPickerSource = z.infer<typeof SlipPickerSourceEnum>;

/** Client-observed picker analytics (spec §7.1, all best-effort). */
export const SlipPickerAnalyticsEventSchema = z.object({
  event: z.enum([
    'checkout_slip_selected',
    'checkout_slip_compressed',
    'checkout_slip_uploaded',
  ]),
  orderId: z.string().uuid(),
  tenantId: z.string().min(1).max(100).optional(),
  source: SlipPickerSourceEnum.optional(),
  fileSizeKbBefore: z.number().nonnegative().optional(),
  fileSizeKbAfter: z.number().nonnegative().optional(),
  uploadLatencyMs: z.number().nonnegative().optional(),
  at: z.string().datetime().optional(),
});
export type SlipPickerAnalyticsEvent = z.infer<typeof SlipPickerAnalyticsEventSchema>;

/** Original-file guardrail: refuse originals over 10MB before decode (spec §3.1). */
export const SLIP_PICKER_MAX_SOURCE_BYTES = 10 * 1024 * 1024;

/** Compression target stays the Phase-014 ceiling (stricter than spec 1MB). */
export const SLIP_PICKER_TARGET_KB = 300;
