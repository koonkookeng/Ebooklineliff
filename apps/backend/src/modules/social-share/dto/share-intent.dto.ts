// SSOT Phase 026 Task 2 — Social share DTOs (thin re-export over Zod SSOT)
// Canonical: apps/backend/src/modules/social-share/dto/share-intent.dto.ts
// (legacy src/backend/modules/social-share/dto/share-intent.dto.ts)
import {
  DynamicFlexShareInputSchema,
  FlexMessagePayloadSchema,
  GenerateFlexShareResponseSchema,
  RecordShareLogInputSchema,
  ShareTargetPickerResultSchema,
  type DynamicFlexShareInput,
  type FlexMessagePayload,
  type GenerateFlexShareResponse,
  type RecordShareLogInput,
  type ShareTargetPickerResult,
} from '@repo/shared';

export {
  DynamicFlexShareInputSchema,
  FlexMessagePayloadSchema,
  GenerateFlexShareResponseSchema,
  RecordShareLogInputSchema,
  ShareTargetPickerResultSchema,
};
export type {
  DynamicFlexShareInput,
  FlexMessagePayload,
  GenerateFlexShareResponse,
  RecordShareLogInput,
  ShareTargetPickerResult,
};
