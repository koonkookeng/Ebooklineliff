// SSOT Phase 016 §5.1 — Slip picker DTOs (thin: Zod SSOT is the single source)
// Canonical: apps/backend/src/modules/payment/dto/slip-picker.dto.ts
// (legacy src/backend/modules/payment/dto/slip-picker.dto.ts)
// Zero-redundant policy: no duplicated shapes — infer from @repo/shared.
import type { SlipPickerSource, SlipPickerAnalyticsEvent } from '@repo/shared';

export type { SlipPickerSource, SlipPickerAnalyticsEvent };
export type SlipAnalyticsBody = SlipPickerAnalyticsEvent;
